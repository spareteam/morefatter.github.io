"""Read-only public catalog discovery; no login, tokens, or challenge bypasses."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
import json
import re
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
    return {"kind": "youtube_music", "queries": output}


def page(url, kind):
    return {"kind": kind, **fetch(url)}


def main():
    tasks = [(deezer, ()), (youtube, ())]
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
