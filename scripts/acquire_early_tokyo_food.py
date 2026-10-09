"""Stage actual January–August 2000 Tokyo-only other-food observations.

Early Table 3 has Tokyo scope and current, prior-month and prior-year columns.
It is unrelated to modern nationwide Table 3. January comes from February's
explicit January column; metadata equivalence is checked before using its unit.
Other cities receive no invented source values or locators.
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

from scripts.acquire_supplementary_food import FOOD_CODES, evidence
from scripts.import_recent_prices import BASE, download, read_specs
from scripts import import_recent_prices as importer
from scripts.legacy_prices import integer_code, normalized, period_value
from scripts.review_recent_prices import specification_hash


def discover_tokyo_source(record, cache):
    page = evidence(record["listing"], cache).decode("utf-8")
    urls = []
    for article in re.findall(r"<article\b.*?</article>", page, re.S):
        if "その他の品目の東京都区部小売価格" not in article:
            continue
        link = re.search(r'href="([^"<>]+file-download\?[^"<>]+fileKind=0)"', article)
        if link:
            urls.append(urllib.request.urljoin(BASE, unescape(link[1])))
    if len(urls) != 1:
        raise ValueError(f"Unreviewed early Tokyo part count: {record['month']}/{len(urls)}")
    return urls[0]


def read_tokyo_food(sheet, observed_month, publication_month):
    rows = [sheet.row_values(index) for index in range(sheet.nrows)]
    if not any("その他の品目の東京都区部小売価格" in str(value) for row in rows[:8] for value in row):
        raise ValueError("Source does not explicitly identify Tokyo other-item scope")
    header_index = next((index for index, row in enumerate(rows[:18]) if "銘柄符号" in row), None)
    if header_index is None:
        raise ValueError("Unreviewed Tokyo code header")
    code_column = rows[header_index].index("銘柄符号")
    unit_columns = [column for column, value in enumerate(rows[header_index]) if normalized(value) == "単位"]
    if len(unit_columns) != 1 or unit_columns[0] - code_column not in {3, 4}:
        raise ValueError("Unreviewed Tokyo quote-unit column")
    unit_column = unit_columns[0]
    dated = [(index, column, period_value(value), str(value))
             for index, row in enumerate(rows[:18]) for column, value in enumerate(row)
             if period_value(value)]
    if not dated or dated[0][2] != publication_month:
        raise ValueError("Tokyo publication month differs from source header")
    selected = [cell for cell in dated if cell[2] == observed_month]
    if len(selected) != 1 or selected[0][1] <= unit_column:
        raise ValueError(f"No unique explicit Tokyo observation column: {observed_month}")
    period_row, value_column, _, period_text = selected[0]
    result, seen = [], set()
    for index, row in enumerate(rows):
        code = integer_code(row[code_column])
        if code not in FOOD_CODES:
            continue
        if unit_column == code_column + 4 and str(row[code_column + 3]).strip():
            raise ValueError("Unreviewed populated Tokyo header spacer")
        if code in seen:
            raise ValueError(f"Duplicate Tokyo food row: {code}/{observed_month}")
        seen.add(code)
        unit = row[unit_column]
        if not str(unit).strip():
            raise ValueError(f"Missing native Tokyo food unit: {code}/{observed_month}")
        result.append({"code": code, "name": row[code_column + 1], "unit": unit,
                       "revision": None, "row": index + 1, "sheet": sheet.name,
                       "format": "tokyo-comparison-xls", "scope": "tokyo-special-wards",
                       "periodEvidence": [period_text],
                       "periodLocation": {"row": period_row + 1, "column": value_column + 1},
                       "unitLocations": [{"row": index + 1, "column": unit_column + 1}],
                       "values": {"13100": row[value_column]},
                       "locations": {"13100": {"row": index + 1, "column": value_column + 1}}})
    if not result:
        raise ValueError("No actual Tokyo food rows")
    return result


def acquire(manifest_path, output, cache, workers=2):
    importer.CACHE = cache
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    records = {record["month"]: record for record in manifest["months"]}
    by_publication = {}

    def read_one(publication):
        record = records[publication]
        data, source = download(discover_tokyo_source(record, cache))
        book = xlrd.open_workbook(file_contents=data)
        try:
            if book.nsheets != 1:
                raise ValueError("Unreviewed early Tokyo sheet count")
            sheet = book.sheet_by_index(0)
            months = ["2000-01", publication] if publication == "2000-02" else [publication]
            snapshots = []
            published_specs = read_specs(evidence(record["specSource"], cache), FOOD_CODES)
            for month in months:
                rows = read_tokyo_food(sheet, month, publication)
                specs = read_specs(evidence(records[month]["specSource"], cache), FOOD_CODES)
                if any(row["code"] not in specs for row in rows):
                    raise ValueError(f"Tokyo food lacks dated definition: {month}")
                if month != publication:
                    for row in rows:
                        if specification_hash(specs[row["code"]]) != specification_hash(published_specs[row["code"]]):
                            raise ValueError(f"Prior-column unit/specification ambiguity: {month}/{row['code']}")
                receipt = {**source, "id": month + "-early-tokyo-food", "category": "early-tokyo-food",
                           "scope": "tokyo-special-wards", "publicationMonth": publication,
                           "observationMonth": month}
                snapshots.append({"month": month, "cities": [{"id": "13100"}],
                                  "listing": record["listing"], "sources": [receipt],
                                  "specSource": records[month]["specSource"],
                                  "specs": {row["code"]: specs[row["code"]] for row in rows},
                                  "prices": [{**row, "sourceId": receipt["id"]} for row in rows]})
            return publication, snapshots
        finally:
            book.release_resources()

    publications = [f"2000-{month:02}" for month in range(2, 9)]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for month, snapshots in pool.map(read_one, publications):
            by_publication[month] = snapshots
            print(f"Early Tokyo food: {month}, {len(snapshots)} observation months", flush=True)
    snapshots = [snapshot for month in publications for snapshot in by_publication[month]]
    payload = {"scope": "tokyo-special-wards", "cities": [{"id": "13100"}], "snapshots": snapshots}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8", newline="\n")
    summary = {"start": snapshots[0]["month"], "end": snapshots[-1]["month"], "months": len(snapshots),
               "workbooks": len(publications), "sourceCodes": sorted({row["code"] for snapshot in snapshots for row in snapshot["prices"]}),
               "cellCount": sum(len(snapshot["prices"]) for snapshot in snapshots),
               "stagingSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
               "limitation": "Actual Tokyo observations only; no early other-city source cells."}
    output.with_suffix(".summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
                                                 encoding="utf-8", newline="\n")
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return payload


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/staging/history-source-manifest.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/staging/early-tokyo-food-history.json")
    parser.add_argument("--cache", type=Path, default=ROOT / "data/raw/recent")
    parser.add_argument("--workers", type=int, default=2, choices=range(1, 5))
    args = parser.parse_args()
    acquire(args.manifest, args.output, args.cache, args.workers)
