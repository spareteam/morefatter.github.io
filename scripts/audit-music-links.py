"""Check release links against official sources and report live-network limitations.

Run manually with network access: python3 scripts/audit-music-links.py
Exit 0 means live checks completed, 1 means invalid/broken links, and 2 means
network restrictions or service responses prevented a complete live audit.
"""

import base64
import concurrent.futures
import datetime
from html.parser import HTMLParser
import json
import pathlib
import re
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = pathlib.Path('/tmp/morefatter-music-link-audit.json')
PROVIDERS = {
    'Spotify': {'open.spotify.com'},
    'Apple Music': {'music.apple.com', 'geo.music.apple.com'},
    'TIDAL': {'tidal.com', 'www.tidal.com', 'listen.tidal.com'},
    'Deezer': {'www.deezer.com', 'deezer.com'},
    'Amazon': {'www.amazon.com'},
    'Amazon Music': {'music.amazon.com'},
    'YouTube': {'www.youtube.com'},
    'YouTube Music': {'music.youtube.com'},
}


def fetch(url):
    result = {'url': url}
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read(2 * 1024 * 1024).decode(errors='replace')
            result.update(state='reachable', status=response.status, final=response.url)
            return result, body
    except urllib.error.HTTPError as error:
        state = 'broken' if error.code in (404, 410) else 'unconfirmed'
        result.update(state=state, status=error.code, reason=str(error))
    except Exception as error:
        state = 'blocked' if 'Tunnel connection failed: 403' in str(error) else 'unconfirmed'
        result.update(state=state, reason=str(error))
    return result, ''


def canonical(url):
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parsed.query)
    identifiers = sorted((key, value) for key, value in query if key in ('list', 'app', 'i'))
    return urllib.parse.urlunsplit(('https', parsed.netloc.lower(), parsed.path.rstrip('/'),
                                  urllib.parse.urlencode(identifiers), ''))


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()

    def handle_starttag(self, tag, attrs):
        href = dict(attrs).get('href', '')
        if tag == 'a' and href.startswith(('http://', 'https://')):
            self.urls.add(canonical(href))


def source_destinations(body):
    parsed = Links()
    parsed.feed(body)
    # Feature.fm supplies the real destination in each button's encoded data.
    normalized = body.replace('\\u002F', '/').replace('\\/', '/')
    for token in re.findall(r'https://api\.ffm\.to/[^"\s]+\?cd=([A-Za-z0-9_-]+)', normalized):
        try:
            payload = json.loads(base64.urlsafe_b64decode(token + '=' * (-len(token) % 4)))
            parsed.urls.add(canonical(payload['destUrl']))
        except (ValueError, KeyError):
            continue
    # Official public catalog APIs return the provider's canonical release URL.
    try:
        document = json.loads(body)
    except ValueError:
        document = None
    def visit(value):
        if isinstance(value, dict):
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, str) and value.startswith('https://'):
            parsed.urls.add(canonical(value))
    visit(document)
    return parsed.urls


def search_matches(release, service):
    parsed = urllib.parse.urlsplit(service['url'])
    query = urllib.parse.parse_qs(parsed.query)
    text = urllib.parse.unquote(' '.join([parsed.path, *query.get('q', []), *query.get('term', [])]))
    words = lambda value: re.findall(r'[a-z0-9]+', value.lower())
    expected = words('More Fatter ' + release['title'].removesuffix(' EP'))
    return all(word in words(text) for word in expected)


def main():
    music = json.loads((ROOT / 'content.json').read_text())['music']
    provenance = json.loads((ROOT / 'assets/music/sources.json').read_text())['entries']
    recorded = {canonical(entry['url']): entry for entry in provenance}
    sources = {'https://www.morefatter.band/'}
    sources.update(release['url'] for release in music
                   if urllib.parse.urlsplit(release['url']).hostname in ('ffm.to', 'distrokid.com'))
    sources.update(entry['source'] for entry in provenance if entry['source'].startswith('https://'))
    destinations = {service['url'] for release in music for service in release['services']}
    urls = sorted(sources | destinations)
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        fetched = dict(zip(urls, pool.map(fetch, urls)))
    official = set()
    for url in sources:
        official.update(source_destinations(fetched[url][1]))
    records = []
    for release in music:
        for service in release['services']:
            url = service['url']
            parsed = urllib.parse.urlsplit(url)
            provider_ok = parsed.scheme == 'https' and parsed.hostname in PROVIDERS[service['name']]
            search = bool(service.get('search'))
            records.append({
                'release': release['title'], 'service': service['name'], 'url': url,
                'kind': 'search' if search else 'release', 'correct_provider': provider_ok,
                'source_match': canonical(url) in official if not search else None,
                'recorded_source': recorded.get(canonical(url)),
                'search_matches_release': search_matches(release, service) if search else None,
                'live': fetched[url][0],
            })
    invalid = [row for row in records if not row['correct_provider'] or
               row['search_matches_release'] is False or row['live']['state'] == 'broken']
    direct = [row for row in records if row['kind'] == 'release']
    summary = {
        'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'options': len(records), 'direct_links': len(direct),
        'direct_links_matching_official_sources': sum(row['source_match'] for row in direct),
        'direct_links_without_source_confirmation': sum(not row['source_match'] for row in direct),
        'clearly_marked_search_links': sum(row['kind'] == 'search' for row in records),
        'reachable_destinations': sum(row['live']['state'] == 'reachable' for row in records),
        'blocked_destinations': sum(row['live']['state'] == 'blocked' for row in records),
        'invalid_or_broken_links': len(invalid),
    }
    REPORT.write_text(json.dumps({'summary': summary, 'sources': [fetched[url][0] for url in sorted(sources)],
                                  'links': records}, indent=2) + '\n')
    print(json.dumps(summary, indent=2))
    print('Detailed report:', REPORT)
    if invalid:
        return 1
    if any(not row['source_match'] for row in direct) or any(row['live']['state'] != 'reachable' for row in records):
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
