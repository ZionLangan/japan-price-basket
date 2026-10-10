"""Operator-only acquisition of full monthly e-Stat tables. Never runs in a browser.

Downloaded bytes are immutable content-addressed evidence; caches and generated
releases are ignored. A fixed source manifest allows offline, reproducible rebuilds.
Reviewed adapters cover printed-block XLS, legacy wide XLS, coded wide XLSX,
dated XLS/XLSX specifications, and explicitly reviewed historical city scopes.
"""

import argparse
import hashlib
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from threading import Lock

import openpyxl
import xlrd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
CACHE = ROOT / "data/raw/recent"
BASE = "https://www.e-stat.go.jp"
REVIEW_CODES = {"1001", "1021", "1303", "1341", "1632", "1401", "1407", "1409",
                "1411", "1412", "1414", "1415", "1417", "1436", "1434", "1511",
                "1572", "4401", "4431", "4441"}
DOWNLOAD_LOCKS = {}
DOWNLOAD_LOCKS_GUARD = Lock()


def download(url, refresh=False):
    """Read cached evidence, or explicitly recheck an existing public URL.

    Refresh preserves content-addressed bytes and prior receipts. It changes the
    current URL receipt only after a successful fetch and evidence write; it
    never approves or publishes corrected data.
    """
    key = hashlib.sha256(url.encode()).hexdigest()
    with DOWNLOAD_LOCKS_GUARD:
        lock = DOWNLOAD_LOCKS.setdefault(key, Lock())
    with lock:
        return _download(url, key, refresh)


def _download(url, key, refresh=False):
    receipt = CACHE / f"{key}.json"
    previous = None
    previous_bytes = None
    if receipt.exists():
        previous_bytes = receipt.read_bytes()
        previous = json.loads(previous_bytes)
        data = (CACHE / previous["sha256"]).read_bytes()
        if (previous["url"] != url or len(data) != previous["bytes"]
                or hashlib.sha256(data).hexdigest() != previous["sha256"]):
            raise ValueError("Cached source checksum mismatch")
        if not refresh:
            return data, previous
    request = urllib.request.Request(url, headers={"User-Agent": "JapanInflationPrototype/0.1"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                data = response.read(20 * 1024 * 1024 + 1)
                if len(data) > 20 * 1024 * 1024:
                    raise ValueError("Source exceeds 20 MiB")
                info = {"url": url, "sha256": hashlib.sha256(data).hexdigest(),
                        "retrievedAt": datetime.now(timezone.utc).isoformat(), "bytes": len(data)}
            break
        except urllib.error.HTTPError as exc:
            if attempt == 3 or exc.code not in {429, 500, 502, 503, 504}:
                raise
            time.sleep(2 ** attempt)
        except urllib.error.URLError:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    CACHE.mkdir(parents=True, exist_ok=True)
    if refresh:
        info["refreshStatus"] = ("new" if previous is None else
                                 "unchanged" if info["sha256"] == previous["sha256"] else "changed")
        if previous is not None:
            info["previousSha256"] = previous["sha256"]
            info["previousReceiptSha256"] = hashlib.sha256(previous_bytes).hexdigest()
    evidence = CACHE / info["sha256"]
    if evidence.exists():
        if hashlib.sha256(evidence.read_bytes()).hexdigest() != info["sha256"]:
            raise ValueError("Existing immutable source checksum mismatch")
    else:
        temporary = CACHE / f"{key}.download.tmp"
        temporary.write_bytes(data)
        temporary.replace(evidence)
    current_bytes = json.dumps(info, indent=2).encode("utf-8")
    history = CACHE / "receipts" / key
    history.mkdir(parents=True, exist_ok=True)
    for preserved in [previous_bytes, current_bytes]:
        if preserved is None:
            continue
        archived = history / f"{hashlib.sha256(preserved).hexdigest()}.json"
        if archived.exists() and archived.read_bytes() != preserved:
            raise ValueError("Immutable receipt checksum mismatch")
        if not archived.exists():
            archived.write_bytes(preserved)
    temporary = CACHE / f"{key}.receipt.tmp"
    temporary.write_bytes(current_bytes)
    temporary.replace(receipt)
    return data, info


def read_prices(data, month, city_resolver=None, selected_codes=None):
    if not data.startswith(b"PK\x03\x04"):
        if not data.startswith(b"\xd0\xcf\x11\xe0") or city_resolver is None:
            raise ValueError(f"Unsupported legacy price workbook for {month}; city-code/layout review required")
        from scripts.legacy_prices import read_legacy_prices
        cities, prices = read_legacy_prices(
            data, month, REVIEW_CODES if selected_codes is None else selected_codes)
        return resolve_city_rows(cities, prices, month, city_resolver)
    book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    sheet = book.worksheets[0]
    rows = list(sheet.values)
    code_row = next(r for r in rows if "地域コード" in r)
    header = next(r for r in rows if "銘柄符号" in r and "時間軸（月）" in r)
    positions = [(i, str(c), str(header[i])) for i, c in enumerate(code_row)
                 if isinstance(c, str) and re.fullmatch(r"\d{5}", c)]
    if len(positions) != 81:
        raise ValueError(f"Unreviewed city roster: {len(positions)}")
    result = []
    for row_number, row in enumerate(rows, 1):
        c = row[9] if len(row) > 9 else None
        if not isinstance(c, (str, int)) or not re.fullmatch(r"\d{4}", str(c)):
            continue
        if selected_codes is not None and str(c) not in selected_codes:
            continue
        if row[8] != f"{int(month[:4])}年{int(month[5:])}月":
            raise ValueError(f"Unexpected period at row {row_number}: {row[8]}")
        result.append({"code": str(c), "name": row[10], "unit": row[11],
                       "revision": row[12], "row": row_number, "sheet": sheet.title,
                       "format": "coded-wide-xlsx",
                       "values": {city: row[i] for i, city, _ in positions},
                       "locations": {city: {"row": row_number, "column": i + 1}
                                     for i, city, _ in positions}})
    book.close()
    if not result:
        raise ValueError("No monthly price rows")
    cities = [{"id": c, "ja": n} for _, c, n in positions]
    if city_resolver is not None:
        raw_cities = [{"rawLabel": c["ja"], "sourceCode": c["id"]} for c in cities]
        raw_rows = [{**row,
                     "values": {c["ja"]: row["values"][c["id"]] for c in cities},
                     "locations": {c["ja"]: row["locations"][c["id"]] for c in cities}}
                    for row in result]
        return resolve_city_rows(raw_cities, raw_rows, month, city_resolver)
    return cities, result


def resolve_city_rows(cities, rows, month, resolver):
    mapped = [{**resolver(city["rawLabel"], month), "rawLabel": city["rawLabel"]}
              for city in cities]
    if len({city["id"] for city in mapped}) != len(mapped):
        raise ValueError(f"Legacy geography merges distinct source columns for {month}")
    for raw, city in zip(cities, mapped, strict=True):
        if raw.get("sourceCode") and raw["sourceCode"] not in city.get("sourceCodes", [city.get("sourceCode")]):
            raise ValueError(f"Source city code differs from dated geography review: {raw}")
    prices = [{**row,
               "values": {city["id"]: row["values"][city["rawLabel"]] for city in mapped},
               "locations": {city["id"]: row["locations"][city["rawLabel"]] for city in mapped}}
              for row in rows]
    return mapped, prices


def read_specs(data, selected_codes=None):
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        book = xlrd.open_workbook(file_contents=data)
        sheet = book.sheet_by_index(0)
        rows = [sheet.row_values(i) for i in range(sheet.nrows)]
        book.release_resources()
    elif data.startswith(b"PK\x03\x04"):
        book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        rows = list(book.worksheets[0].values)
        book.close()
    else:
        raise ValueError("Unsupported specification workbook format")
    # The original 2000 specification sheet has no detail column. Determine
    # its quote-unit column from the published header rather than shifting
    # fields silently into the wrong meanings.
    header = next((r for r in rows[:8] if r and r[0] in {"符号", "銘柄符号"}
                   and "単位" in r), None)
    if header is None or header.index("単位") not in {4, 5}:
        raise ValueError("Unreviewed specification column layout")
    unit_column = header.index("単位")
    result = {}
    for row in rows:
        raw = row[0] if row else None
        code = str(int(raw)) if isinstance(raw, (int, float)) and raw == int(raw) else str(raw or "")
        if re.fullmatch(r"\d{4}", code):
            if selected_codes is not None and code not in selected_codes:
                continue
            if code in result:
                raise ValueError(f"Duplicate specification code {code}")
            if len(row) <= unit_column:
                raise ValueError(f"Incomplete specification row {code}")
            result[code] = {"name": row[1], "definition": row[2],
                            "detail": row[3] if unit_column == 5 else "",
                            "months": row[unit_column - 1], "unit": row[unit_column]}
    if not result:
        raise ValueError("No specification rows")
    return result


def month_range(start, end):
    months = []
    y, m = map(int, start.split("-"))
    while f"{y:04}-{m:02}" <= end:
        months.append(f"{y:04}-{m:02}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return months


def discover_specification_links(refresh=False):
    spec_index_url = "https://www.stat.go.jp/data/kouri/doukou/3.html"
    spec_page, _ = download(spec_index_url, refresh)
    spec_links = {}
    # The Statistics Bureau archive page declares Shift_JIS; e-Stat is UTF-8.
    for tr in re.findall(r"<tr\b.*?</tr>", spec_page.decode("cp932"), re.S):
        year_match = re.search(r"(20\d{2})年", tr)
        if not year_match:
            continue
        for href, text in re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', tr, re.S):
            label = unescape(re.sub(r"<[^>]+>", "", text))
            match = re.search(r"(\d+)(?:月)?(?:[～〜－-](\d+))?月", label)
            if match and href.endswith((".xlsx", ".xls")):
                for number in range(int(match[1]), int(match[2] or match[1]) + 1):
                    spec_links[f"{year_match[1]}-{number:02}"] = urllib.request.urljoin(spec_index_url, href)
    return spec_links


def acquire_specifications(start, end, workers=3, refresh=False):
    """Stage all dated definitions before prices; preserve every original file."""
    months = month_range(start, end)
    links = discover_specification_links(refresh)
    missing = [month for month in months if month not in links]
    if missing:
        raise ValueError(f"No dated specification workbooks discovered: {missing}")
    urls = list(dict.fromkeys(links[month] for month in months))

    def read_one(url):
        data, info = download(url, refresh)
        return url, info, read_specs(data, REVIEW_CODES)

    specifications = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for url, info, specs in pool.map(read_one, urls):
            specifications[url] = (info, specs)
            print(f"Specifications: {len(specifications)}/{len(urls)} files", flush=True)
    folder = ROOT / "data/staging"
    folder.mkdir(parents=True, exist_ok=True)
    payload = {"start": start, "end": end, "snapshots": [
        {"month": month, "specSource": specifications[links[month]][0],
         "specs": specifications[links[month]][1]} for month in months]}
    (folder / "history-specifications.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return payload


def discover_month_listing(month, refresh=False):
    year, number = month.split("-")
    index_url = (BASE + "/stat-search/files?cycle=1&layout=datalist&tclass1val=0"
                 f"&toukei=00200571&tstat=000000680001&year={year}0")
    yearly, _ = download(index_url, refresh)
    links = re.findall(r'href="([^"<>]+)"[^>]*>\s*' + str(int(number)) + r"月\s*</a>",
                       yearly.decode("utf-8"))
    links = [unescape(x) for x in links if "month=" in x]
    if len(set(links)) != 1:
        raise ValueError(f"Cannot discover a unique month link for {month}")
    return urllib.request.urljoin(BASE, links[0])


def discover_price_sources(page, month):
    articles = re.findall(r"<article\b.*?</article>", page.decode("utf-8"), re.S)
    candidates = []
    for article in articles:
        if "主要品目の都市別小売価格" not in article:
            continue
        plain = unescape(re.sub(r"<[^>]+>", " ", article))
        # The first endpoint can contain nested quotation marks, e.g. the
        # March 2013 rice name includes 「コシヒカリ」 inside its outer title.
        # The range separator identifies the endpoint's actual closing quote.
        ranges = re.findall(r"「\s*(\d{4}).*?」\s*[～〜]\s*「\s*(\d{4})", plain, re.S)
        if len(ranges) != 1:
            continue
        href = re.search(r'href="([^"<>]+file-download\?[^"<>]+fileKind=0)"', article)
        if href:
            candidates.append((int(ranges[0][0]), int(ranges[0][1]),
                               urllib.request.urljoin(BASE, unescape(href.group(1))), plain))
    sources = {}
    for category, representative in [("food", 1001), ("household", 4431)]:
        found = [c for c in candidates if c[0] <= representative <= c[1]]
        if len(found) != 1:
            raise ValueError(f"Ambiguous {category} full-city source for {month}: {len(found)}")
        low, high, url, title = found[0]
        sources[category] = {"url": url, "firstCode": str(low), "lastCode": str(high), "title": title.strip()}
    return sources


def acquire_history(start, end, workers=3, refresh=False):
    """Checkpoint every complete month; publish staging only after all verify."""
    from scripts.legacy_geography import resolve_legacy_city
    parser_files = [Path(__file__), ROOT / "scripts/legacy_prices.py",
                    ROOT / "scripts/legacy_geography.py",
                    ROOT / "data/legacy-geography-review.json"]
    parser_hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in parser_files}
    folder = ROOT / "data/staging"
    checkpoints = folder / "history-months"
    checkpoints.mkdir(parents=True, exist_ok=True)
    specs_path = folder / "history-specifications.json"
    if specs_path.exists() and not refresh:
        specifications = json.loads(specs_path.read_text(encoding="utf-8"))
    else:
        specifications = acquire_specifications(start, end, workers, refresh)
    if specifications["start"] != start or specifications["end"] != end:
        specifications = acquire_specifications(start, end, workers, refresh)
    by_month = {s["month"]: s for s in specifications["snapshots"]}
    months = month_range(start, end)

    def read_month(month):
        url = discover_month_listing(month, refresh)
        page, listing = download(url, refresh)
        source_links = discover_price_sources(page, month)
        sources, prices, roster = [], [], None
        for category, locator in source_links.items():
            raw, info = download(locator["url"], refresh)
            cities, values = read_prices(raw, month, resolve_legacy_city)
            if roster is not None and [c["id"] for c in cities] != [c["id"] for c in roster]:
                raise ValueError(f"Food/household city rosters differ in {month}")
            roster = cities
            info = {**info, "category": category, "id": month + "-" + category,
                    "firstCode": locator["firstCode"], "lastCode": locator["lastCode"]}
            sources.append(info)
            # Printed publication parts split at different codes over time;
            # e.g. January 2002 puts cling film in the first part and detergents
            # in the second. Preserve the actual file containing each cell.
            prices.extend([{**v, "sourceId": info["id"]} for v in values if v["code"] in REVIEW_CODES])
        if len({p["code"] for p in prices}) != len(prices):
            raise ValueError(f"Duplicate selected product rows in {month}")
        if {p["code"] for p in prices} != REVIEW_CODES:
            missing = REVIEW_CODES - {p["code"] for p in prices}
            raise ValueError(f"Unaccounted selected source products in {month}: {sorted(missing)}")
        if set(by_month[month]["specs"]) != REVIEW_CODES:
            raise ValueError(f"Incomplete dated specification catalog for {month}")
        snapshot = {"month": month, "cities": roster, "listing": listing,
                    "parserHashes": parser_hashes,
                    "sources": sources, "specSource": by_month[month]["specSource"],
                    "specs": by_month[month]["specs"], "prices": prices}
        (checkpoints / f"{month}.json").write_text(
            json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
        return snapshot

    snapshots = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for snapshot in pool.map(read_month, months):
            snapshots.append(snapshot)
            print(f"{snapshot['month']}: {len(snapshot['prices'])} selected rows, "
                  f"{len(snapshot['cities'])} reviewed city scopes", flush=True)
    if any(hashlib.sha256(path.read_bytes()).hexdigest() != parser_hashes[str(path.relative_to(ROOT))]
           for path in parser_files):
        raise ValueError("Parser/geography review changed during acquisition; reparse all cached originals")
    union = {}
    for snapshot in snapshots:
        for city in snapshot["cities"]:
            if city["id"] in union and city["names"] != union[city["id"]]["names"]:
                raise ValueError(f"Changed names inside reviewed city identity {city['id']}")
            union[city["id"]] = city
    payload = {"cities": list(union.values()), "snapshots": snapshots}
    temporary = folder / "history-complete.tmp.json"
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(folder / "recent.json")
    manifest = {"start": start, "end": end, "monthCount": len(snapshots),
                "parserHashes": parser_hashes,
                "cityScopeCount": len(union), "months": [{
                    "month": s["month"], "listing": s["listing"], "sources": s["sources"],
                    "specSource": s["specSource"], "cityIds": [c["id"] for c in s["cities"]],
                    "priceCodes": [p["code"] for p in s["prices"]],
                    "formats": sorted({p["format"] for p in s["prices"]})}
                    for s in snapshots]}
    (folder / "history-source-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def acquire(start, end, workers=3, refresh=False):
    """Compatibility name for the one reviewed monthly acquisition path."""
    return acquire_history(start, end, workers, refresh)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2000-01")
    parser.add_argument("--end", default="2026-08")
    parser.add_argument("--history", action="store_true", help="Accepted for compatibility; reviewed history is always used")
    parser.add_argument("--workers", type=int, default=3, choices=range(1, 5))
    parser.add_argument("--refresh", action="store_true",
                        help="Recheck known URLs, preserving original bytes and receipt history; never publishes")
    args = parser.parse_args()
    for date in [args.start, args.end]:
        if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", date):
            parser.error("Dates must be YYYY-MM")
    if args.start > args.end:
        parser.error("Start must precede end")
    acquire(args.start, args.end, args.workers, args.refresh)
