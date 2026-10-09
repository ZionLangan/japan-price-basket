"""Acquire and stage omitted 2000–2009 all-city food tables separately.

The historical Table 1 "monthly report unpublished" part contains real city
observations omitted by the original two-file acquisition. No existing manifest,
staging file, review mapping or published fixture is replaced by this command.
Raw downloads use the importer's immutable content-addressed evidence cache.
"""

import argparse
import hashlib
import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_recent_prices import BASE, download, read_specs, resolve_city_rows
from scripts import import_recent_prices as importer
from scripts.legacy_geography import resolve_legacy_city
from scripts.legacy_prices import parse_printed

FOOD_CODES = {str(code) for code in range(1000, 2100)}


def evidence(source, cache):
    data = (cache / source["sha256"]).read_bytes()
    if len(data) != source["bytes"] or hashlib.sha256(data).hexdigest() != source["sha256"]:
        raise ValueError(f"Retained evidence checksum failure: {source['url']}")
    return data


def discover_supplementary_sources(manifest, cache):
    sources = []
    for record in manifest["months"]:
        if not "2000-01" <= record["month"] <= "2009-12":
            continue
        page = evidence(record["listing"], cache).decode("utf-8")
        matches = []
        for article in re.findall(r"<article\b.*?</article>", page, re.S):
            if "主要品目の都市別小売価格" not in article or "月報非掲載表" not in article:
                continue
            link = re.search(r'href="([^"<>]+file-download\?[^"<>]+fileKind=0)"', article)
            if link is None:
                raise ValueError(f"Supplementary city article has no Excel link: {record['month']}")
            matches.append(urllib.request.urljoin(BASE, unescape(link[1])))
        if len(matches) > 1:
            raise ValueError(f"Ambiguous supplementary city part: {record['month']}")
        if matches:
            sources.append({"month": record["month"], "url": matches[0],
                            "listing": record["listing"], "specSource": record["specSource"],
                            "cityIds": record["cityIds"]})
    return sources


class FoodSheetPrefix:
    """Expose an audited food prefix while retaining original row/column indexes.

    Later unrelated printed blocks use Excel numeric parenthesis formatting for
    some non-food item codes. They need their own adapter review; a food parse
    must not treat their repeated city rows as part of the last food block.
    """

    def __init__(self, sheet):
        self.sheet = sheet
        self.name = sheet.name
        self.nrows = sheet.nrows
        food_seen = False
        for index in range(sheet.nrows):
            values = sheet.row_values(index)
            if any(re.fullmatch(r"\s*\d{1,3}\s+.*[一-龯ぁ-んァ-ヶ].*", str(value)) for value in values):
                # A numbered city row contains prices, never item headings.
                # In particular, do not mistake negative prices for codes.
                continue
            codes = []
            for value in values:
                match = re.fullmatch(r"\((\d{4})\)", str(value).strip())
                if match:
                    codes.append(match[1])
                elif isinstance(value, (int, float)) and value == int(value) and -9999 <= value <= -1000:
                    # Negative numeric cells are used by later non-food blocks.
                    # Detect the boundary only; do not reinterpret food prices.
                    code = str(-int(value))
                    if code in FOOD_CODES:
                        raise ValueError(f"Unreviewed numeric food-code header at row {index + 1}")
                    codes.append(code)
            if not codes:
                continue
            foods = [code for code in codes if code in FOOD_CODES]
            if foods and len(foods) != len(codes):
                # A final mixed food/non-food block is safe to include because
                # parse_printed selects food codes while checking its real roster.
                food_seen = True
            elif foods:
                food_seen = True
            elif food_seen:
                self.nrows = index
                break
        if not food_seen:
            raise ValueError("Supplementary workbook has no food item blocks")
        # All food blocks must be inside this prefix; an unexpected later food
        # definition cannot be silently excluded.
        for index in range(self.nrows, sheet.nrows):
            for value in sheet.row_values(index):
                match = re.fullmatch(r"\((\d{4})\)", str(value).strip())
                if match and match[1] in FOOD_CODES:
                    raise ValueError(f"Food code appears after non-food boundary at row {index + 1}")

    def row_values(self, index):
        return self.sheet.row_values(index)


def read_supplementary_food(data, month):
    if not data.startswith(b"\xd0\xcf\x11\xe0"):
        raise ValueError("Unreviewed supplementary workbook format")
    book = xlrd.open_workbook(file_contents=data)
    try:
        if book.nsheets != 1:
            raise ValueError("Unreviewed supplementary sheet count")
        sheet = book.sheet_by_index(0)
        if sheet.ncols > 50:
            raise ValueError("Unreviewed supplementary wide layout")
        cities, rows = parse_printed(FoodSheetPrefix(sheet), month, FOOD_CODES)
        # Independently dereference every returned original source cell.
        for row in rows:
            for city, location in row["locations"].items():
                actual = sheet.cell_value(location["row"] - 1, location["column"] - 1)
                if actual != row["values"][city]:
                    raise ValueError(f"Supplementary source locator mismatch: {month}/{row['code']}/{city}")
        return resolve_city_rows(cities, rows, month, resolve_legacy_city)
    finally:
        book.release_resources()


def acquire(manifest_path, output, cache, workers=2):
    # This operator command has its own process; respect the supplied evidence
    # cache for downloads as well as reads without changing importer source.
    importer.CACHE = cache
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    locators = discover_supplementary_sources(manifest, cache)
    if [entry["month"] for entry in locators] != [
        f"{year:04}-{month:02}" for year in range(2000, 2010)
        for month in range(1, 13) if (year, month) >= (2000, 9)
    ]:
        raise ValueError("Expected exactly September 2000–December 2009 supplementary city releases")

    def read_one(entry):
        data, source = download(entry["url"])
        cities, prices = read_supplementary_food(data, entry["month"])
        if [city["id"] for city in cities] != entry["cityIds"]:
            raise ValueError(f"Supplementary/primary city rosters differ: {entry['month']}")
        specs = read_specs(evidence(entry["specSource"], cache), FOOD_CODES)
        # Okinawa-specific codes have no row in the retained national basic
        # definition workbook. Retain their actual source cells for subsequent
        # local-specification review rather than inventing a definition.
        missing = sorted({row["code"] for row in prices} - set(specs))
        source = {**source, "id": entry["month"] + "-supplementary-food",
                  "category": "supplementary-food", "scope": "published-city-columns"}
        return {"month": entry["month"], "cities": cities, "listing": entry["listing"],
                "sources": [source], "specSource": entry["specSource"],
                "specs": {row["code"]: specs[row["code"]] for row in prices if row["code"] in specs},
                "codesWithoutBasicDefinition": missing,
                "prices": [{**row, "sourceId": source["id"]} for row in prices]}

    snapshots = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for snapshot in pool.map(read_one, locators):
            snapshots.append(snapshot)
            if len(snapshots) % 8 == 0 or len(snapshots) == len(locators):
                print(f"Supplementary food: {len(snapshots)}/{len(locators)} {snapshot['month']}", flush=True)
    union = {city["id"]: city for snapshot in snapshots for city in snapshot["cities"]}
    payload = {"cities": list(union.values()), "snapshots": snapshots}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp.json")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8", newline="\n")
    temporary.replace(output)
    codes = sorted({row["code"] for snapshot in snapshots for row in snapshot["prices"]})
    summary = {"start": snapshots[0]["month"], "end": snapshots[-1]["month"],
               "months": len(snapshots), "cityScopes": len(union), "sourceCodes": len(codes),
               "codeMonthCounts": {code: sum(any(row["code"] == code for row in snapshot["prices"])
                                            for snapshot in snapshots) for code in codes},
               "cellCount": sum(len(row["values"]) for snapshot in snapshots for row in snapshot["prices"]),
               "sourceManifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
               "stagingSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
               "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               "limitation": "Separate supplemental staging; January–August 2000 all-city releases absent."}
    output.with_suffix(".summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
                                                 encoding="utf-8", newline="\n")
    output.with_suffix(".sources.json").write_text(json.dumps({"months": [
        {"month": snapshot["month"], "sources": snapshot["sources"], "listing": snapshot["listing"],
         "specSource": snapshot["specSource"], "cityIds": [city["id"] for city in snapshot["cities"]]}
        for snapshot in snapshots]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return payload


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/staging/history-source-manifest.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/staging/supplementary-food-history.json")
    parser.add_argument("--cache", type=Path, default=ROOT / "data/raw/recent")
    parser.add_argument("--workers", type=int, default=2, choices=range(1, 5))
    args = parser.parse_args()
    acquire(args.manifest, args.output, args.cache, args.workers)
