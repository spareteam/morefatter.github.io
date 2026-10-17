"""Read-only public catalog discovery; no login, tokens, or challenge bypasses."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
import json
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request


REPORT = {"generated_at": datetime.now(timezone.utc).isoformat(), "results": []}
UA = "MoreFatter-PublicCatalogAudit/1.0 (band website link maintenance)"


def fetch(url, json_response=False):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            raw = response.read(3_000_000).decode("utf-8", "replace")
            if json_response:
                return {"source": url, "status": response.status,
                        "data": json.loads(raw)}
            # Read only what the normal public page exposes. Never work around
            # anti-bot screens, authentication requirements, or TLS failures.
            title = re.search(r"<title[^>]*>(.*?)</title>", raw, re.I | re.S)
            urls = sorted(set(unescape(value).replace("\\/", "/") for value in
                              re.findall(r'https?(?::|%3A)(?://|%2F%2F)[^\s<>"\x27]+', raw)))
            ids = sorted(set(re.findall(
                r'(?:album|track|playlist|artist)[/\\]+[A-Za-z0-9_-]+', raw)))
            return {"source": url, "status": response.status,
                    "title": unescape(title.group(1)) if title else "",
                    "urls": urls[:250], "catalog_paths": ids[:250],
                    "excerpt": re.sub(r"<[^>]+>", " ", raw)[:12000]}
    except Exception as error:
        return {"source": url, "error": str(error)}


def deezer():
    output = []
    search = fetch("https://api.deezer.com/search/artist?q=More%20Fatter", True)
    output.append(search)
    artists = [row for row in search.get("data", {}).get("data", [])
               if row.get("name", "").lower() == "more fatter"]
    for artist in artists:
        url = "https://api.deezer.com/artist/%s/albums?limit=100" % artist["id"]
        albums = fetch(url, True)
        output.append(albums)
        for album in albums.get("data", {}).get("data", []):
            if re.search(r"weirdo|yeah you|fat haus|museum", album.get("title", ""), re.I):
                output.append(fetch("https://api.deezer.com/album/%s" % album["id"], True))
    return {"kind": "deezer", "queries": output}


def youtube():
    from ytmusicapi import YTMusic
    client = YTMusic(requests_session=True)
    output = []
    for release in ("Weirdo", "Yeah You", "fat haus", "Livin' in a Museum"):
        try:
            matches = client.search("More Fatter " + release, filter="albums", limit=8)
            entries = []
            for match in matches:
                entry = {"search_match": match}
                artist_names = [a.get("name", "").lower() for a in match.get("artists", [])]
                if "more fatter" in artist_names and match.get("browseId"):
                    entry["album"] = client.get_album(match["browseId"])
                entries.append(entry)
            output.append({"release": release, "matches": entries})
        except Exception as error:
            output.append({"release": release, "error": str(error)})
    try:
        artist = client.get_artist("UCeFARnwdOKoHg7Pwwdo4CWg")
        output.append({"artist_catalog": artist})
        for key in ("albums", "singles"):
            section = artist.get(key, {})
            if section.get("browseId") and section.get("params"):
                output.append({"artist_section": key, "releases": client.get_artist_albums(
                    section["browseId"], section["params"], limit=100)})
    except Exception as error:
        output.append({"artist_catalog_error": str(error)})
    for query, kind in (("fat haus", "albums"), ("More Fatter Fat Haus EP", "albums"),
                        ("More Fatter fat haus", "playlists")):
        try:
            output.append({"refined_query": query, "filter": kind,
                           "matches": client.search(query, filter=kind, limit=12)})
        except Exception as error:
            output.append({"refined_query": query, "error": str(error)})
    return {"kind": "youtube_music", "queries": output}


def browser_catalogs():
    script = r'''
const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext();
  const results = [];
  for (const url of [
    'https://tidal.com/artist/7977491',
    'https://tidal.com/artist/ARTIST_TOP_SINGLES/view-all?artistId=7977491',
    'https://tidal.com/album/152166572',
    'https://tidal.com/album/305619972',
    'https://music.amazon.com/search/More%20Fatter%20Weirdo',
    'https://music.amazon.com/search/More%20Fatter%20fat%20haus',
    'https://music.amazon.com/albums/B08FZK5KJ1',
    'https://music.amazon.com/albums/B0CC8Q9HNM',
    'https://music.amazon.com/search/More%20Fatter%20Yeah%20You',
    'https://music.amazon.com/search/More%20Fatter%20Livin%20in%20a%20Museum',
  ]) {
    const page = await context.newPage();
    const result = {source:url, publicMetadata:[]};
    page.on('response', async response => {
      if (!response.headers()['content-type']?.includes('json')) return;
      try {
        const data = await response.json();
        const walk = value => {
          if (!value || typeof value !== 'object') return;
          if (Array.isArray(value)) {value.forEach(walk);return;}
          const name = value.title || value.name || '';
          if (typeof name === 'string' && /more fatter|weirdo|fat haus|museum/i.test(name)) {
            const safe = {};
            for (const key of ['id','title','name','type','url','shareUrl','link','upc','isrc','asin','releaseDate']) {
              if (typeof value[key] === 'string' || typeof value[key] === 'number') safe[key] = value[key];
            }
            if (result.publicMetadata.length < 100) result.publicMetadata.push({source:response.url().split('?')[0],data:safe});
          }
          Object.values(value).forEach(walk);
        };
        walk(data);
      } catch {}
    });
    try {
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForTimeout(6000);
      const body = await page.locator('body').innerText();
      result.title = await page.title();
      if (/captcha|robot check|verify (you are|that you are) human|access denied/i.test(body)) {
        result.accessChallenge = true;
        result.excerpt = body.slice(0,1200);
      } else {
        result.excerpt = body.slice(0,25000);
        result.links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(a => ({text:a.innerText,href:a.href})).filter(a => /(?:tidal\.com\/(?:browse\/)?(?:album|track|artist)|(?:music\.)?amazon\.com\/(?:albums|tracks|artists|dp|gp\/product))/i.test(a.href)).slice(0,250));
      }
    } catch (error) {result.error = String(error);}
    results.push(result);
    await page.close();
  }
  await browser.close();
  process.stdout.write(JSON.stringify(results));
})();
'''
    result = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=220)
    if result.returncode:
        return {"kind": "browser_catalogs", "error": result.stderr[-2000:]}
    return {"kind": "browser_catalogs", "pages": json.loads(result.stdout)}


def page(url, kind):
    return {"kind": kind, **fetch(url)}


def main():
    tasks = [(deezer, ()), (youtube, ()), (browser_catalogs, ())]
    for url in (
        "https://tidal.com/browse/artist/7977491",
        "https://tidal.com/artist/7977491",
        "https://embed.tidal.com/artists/7977491",
        "https://embed.tidal.com/artists/7977491?layout=gridify",
    ):
        tasks.append((page, (url, "tidal_public_artist")))
    queries = [
        'site:tidal.com "More Fatter" "Weirdo"',
        'site:tidal.com "More Fatter" "fat haus"',
        'site:tidal.com "More Fatter" "Livin" "Museum"',
        'site:music.amazon.com "More Fatter" "Weirdo"',
        'site:music.amazon.com "More Fatter" "fat haus"',
    ]
    for query in queries:
        url = "https://www.bing.com/search?format=rss&q=" + urllib.parse.quote(query)
        tasks.append((page, (url, "public_search")))
    for release in ("Weirdo", "fat haus"):
        url = "https://music.amazon.com/search/" + urllib.parse.quote("More Fatter " + release, safe="")
        tasks.append((page, (url, "amazon_public_search")))
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending = {pool.submit(function, *arguments): (function, arguments)
                   for function, arguments in tasks}
        for future in as_completed(pending):
            try:
                result = future.result()
            except Exception as error:
                result = {"kind": pending[future][0].__name__, "error": str(error)}
            REPORT["results"].append(result)
            print("Finished:", result.get("kind"), result.get("source", ""), flush=True)
    Path("catalog-audit-report.json").write_text(json.dumps(REPORT, indent=2) + "\n")


if __name__ == "__main__":
    main()
