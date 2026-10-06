"""Operator-only acquisition of full monthly e-Stat tables. Never runs in a browser.

Downloaded bytes are immutable content-addressed evidence; caches and generated
releases are ignored. A fixed source manifest allows offline, reproducible rebuilds.
This adapter supports the recent wide XLSX format only, not the 2000 archive.
"""

import argparse
import hashlib
import io
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/raw/recent"
BASE = "https://www.e-stat.go.jp"


def download(url):
    key = hashlib.sha256(url.encode()).hexdigest()
    receipt = CACHE / f"{key}.json"
    if receipt.exists():
        info = json.loads(receipt.read_text(encoding="utf-8"))
        data = (CACHE / info["sha256"]).read_bytes()
        if hashlib.sha256(data).hexdigest() != info["sha256"]:
            raise ValueError("Cached source checksum mismatch")
        return data, info
    request = urllib.request.Request(url, headers={"User-Agent": "JapanInflationPrototype/0.1"})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read(20 * 1024 * 1024 + 1)
        if len(data) > 20 * 1024 * 1024:
            raise ValueError("Source exceeds 20 MiB")
        info = {"url": url, "sha256": hashlib.sha256(data).hexdigest(),
                "retrievedAt": datetime.now(timezone.utc).isoformat(), "bytes": len(data)}
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / info["sha256"]).write_bytes(data)
    receipt.write_text(json.dumps(info, indent=2), encoding="utf-8")
    return data, info


def read_prices(data, month):
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
        if row[8] != f"{int(month[:4])}年{int(month[5:])}月":
            raise ValueError(f"Unexpected period at row {row_number}: {row[8]}")
        result.append({"code": str(c), "name": row[10], "unit": row[11],
                       "revision": row[12], "row": row_number, "sheet": sheet.title,
                       "values": {city: row[i] for i, city, _ in positions}})
    book.close()
    if not result:
        raise ValueError("No monthly price rows")
    return [{"id": c, "ja": n} for _, c, n in positions], result


def read_specs(data):
    book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    result = {}
    for row in book.worksheets[0].values:
        code = str(row[0]) if row and row[0] is not None else ""
        if re.fullmatch(r"\d{4}", code):
            result[code] = {"name": row[1], "definition": row[2], "detail": row[3],
                            "months": row[4], "unit": row[5]}
    book.close()
    if not result:
        raise ValueError("No specification rows")
    return result


def acquire(start, end):
    months = []
    y, m = map(int, start.split("-"))
    while f"{y:04}-{m:02}" <= end:
        months.append(f"{y:04}-{m:02}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    spec_index_url = "https://www.stat.go.jp/data/kouri/doukou/3.html"
    spec_page, _ = download(spec_index_url)
    spec_links = {}
    # The Statistics Bureau archive page declares Shift_JIS; e-Stat is UTF-8.
    for tr in re.findall(r"<tr\b.*?</tr>", spec_page.decode("cp932"), re.S):
        year_match = re.search(r"(20\d{2})年", tr)
        if not year_match:
            continue
        for href, text in re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', tr, re.S):
            label = unescape(re.sub(r"<[^>]+>", "", text))
            match = re.search(r"(\d+)(?:～(\d+))?月", label)
            if match and href.endswith(".xlsx"):
                for number in range(int(match[1]), int(match[2] or match[1]) + 1):
                    spec_links[f"{year_match[1]}-{number:02}"] = urllib.request.urljoin(spec_index_url, href)
    snapshots, roster = [], None
    for month in months:
        year, number = month.split("-")
        index_url = (BASE + "/stat-search/files?cycle=1&layout=datalist&tclass1val=0"
                     f"&toukei=00200571&tstat=000000680001&year={year}0")
        yearly, _ = download(index_url)
        links = re.findall(r'href="([^"<>]+)"[^>]*>\s*' + str(int(number)) + r"月\s*</a>",
                           yearly.decode("utf-8"))
        links = [unescape(x) for x in links if "month=" in x]
        if len(set(links)) != 1:
            raise ValueError(f"Cannot discover a unique month link for {month}")
        url = urllib.request.urljoin(BASE, links[0])
        page, listing = download(url)
        articles = re.findall(r"<article\b.*?</article>", page.decode("utf-8"), re.S)
        sources, prices = [], []
        for category, marker in [("food", "1001"), ("household", "3001")]:
            found = [a for a in articles if "主要品目の都市別小売価格" in a and marker in a]
            if len(found) != 1:
                raise ValueError(f"Ambiguous {category} full-city table for {month}")
            href = re.search(r'href="([^"<>]+file-download\?[^"<>]+fileKind=0)"', found[0])
            if not href:
                raise ValueError("Missing Excel download")
            source_url = urllib.request.urljoin(BASE, unescape(href.group(1)))
            raw, info = download(source_url)
            cities, values = read_prices(raw, month)
            if roster is not None and cities != roster:
                old, new = {c["id"]: c["ja"] for c in roster}, {c["id"]: c["ja"] for c in cities}
                # Verified January 2025 sample rotation. Never join replacement
                # cities to their predecessors; pre-entry months remain absent.
                added, removed = set(new) - set(old), set(old) - set(new)
                if not (month == "2025-01" and added == {"12217", "14205", "23201"}
                        and removed == {"12212", "14201", "23202"}
                        and all(old[c] == new[c] for c in set(old) & set(new))):
                    raise ValueError("Unreviewed city roster change")
            roster = cities
            info = {**info, "category": category, "id": month + "-" + category}
            sources.append(info)
            prices.extend([{**v, "sourceId": info["id"]} for v in values])
        spec_url = spec_links[month]
        raw, spec_info = download(spec_url)
        specs = read_specs(raw)
        snapshots.append({"month": month, "cities": roster, "listing": listing, "sources": sources,
                          "specSource": spec_info, "specs": specs, "prices": prices})
        print(f"{month}: {len(prices)} item rows, {len(roster)} cities", flush=True)
    staging = ROOT / "data/staging"
    staging.mkdir(parents=True, exist_ok=True)
    (staging / "recent.json").write_text(json.dumps({"cities": roster, "snapshots": snapshots},
                                                 ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2024-09")
    parser.add_argument("--end", default="2026-08")
    args = parser.parse_args()
    for date in [args.start, args.end]:
        if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", date):
            parser.error("Dates must be YYYY-MM")
    if args.start > args.end:
        parser.error("Start must precede end")
    acquire(args.start, args.end)
