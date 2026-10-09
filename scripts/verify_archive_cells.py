"""Reconcile every admitted observation with its original workbook cell offline.

This operator check needs the ignored content-addressed raw cache. Routine CI
builds use the approved fixture and do not acquire or distribute that cache.
The check reads native workbook cells independently of the acquisition adapters.
"""

import argparse
import gzip
import hashlib
import io
import json
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path

import openpyxl
import xlrd

ROOT = Path(__file__).resolve().parents[1]


def workbook_cells(data):
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        book = xlrd.open_workbook(file_contents=data)
        sheets = {sheet.name: [sheet.row_values(row) for row in range(sheet.nrows)]
                  for sheet in book.sheets()}
        book.release_resources()
        return sheets
    if data.startswith(b"PK\x03\x04"):
        book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        sheets = {sheet.title: list(sheet.values) for sheet in book.worksheets}
        book.close()
        return sheets
    raise ValueError("Unrecognized original workbook format")


def verify(fixture_path, approval_path, cache, report_path):
    payload = fixture_path.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    approval = json.loads(approval_path.read_text(encoding="utf-8"))
    if digest != approval["sha256"]:
        raise ValueError("Approved fixture checksum failed")
    fixture = json.loads(gzip.decompress(payload))
    sources = {source["id"]: source for source in fixture["sources"]}
    grouped = defaultdict(list)
    seen = set()
    for city, products in fixture["series"].items():
        for product, rows in products.items():
            for row in rows:
                if row["status"] != "observed":
                    continue
                key = (row["sourceId"], row["sourceSheet"], row["sourceRow"], row.get("sourceColumn"))
                if key[-1] is None or key in seen:
                    raise ValueError(f"Missing or duplicated actual cell: {city}, {product}, {row['month']}")
                seen.add(key)
                grouped[row["sourceId"]].append((city, product, row))

    def reconcile(source_id):
        source = sources[source_id]
        evidence = (cache / source["sha256"]).read_bytes()
        if hashlib.sha256(evidence).hexdigest() != source["sha256"]:
            raise ValueError(f"Original evidence checksum failed: {source_id}")
        sheets = workbook_cells(evidence)
        for city, product, row in grouped[source_id]:
            raw = sheets[row["sourceSheet"]][row["sourceRow"] - 1][row["sourceColumn"] - 1]
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                raise ValueError(f"Observed price refers to a non-numeric cell: {city}, {product}, {row['month']}")
            if Decimal(str(raw)) != Decimal(row["price"]) or Decimal(str(raw)) != Decimal(str(row["raw"])):
                raise ValueError(f"Original cell differs: {city}, {product}, {row['month']}")
        return source_id, len(grouped[source_id])

    results = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        for source_id, count in pool.map(reconcile, sorted(grouped)):
            results[source_id] = count
    report = {"fixtureSha256": digest, "start": fixture["start"], "end": fixture["end"],
              "workbooks": len(results), "observations": sum(results.values()),
              "allActualCellsMatch": True, "sourceObservationCounts": results}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Matched {report['observations']:,} actual cells in {report['workbooks']} source workbooks")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=ROOT / "data/fixtures/recent-approved.json.gz")
    parser.add_argument("--approval", type=Path, default=ROOT / "data/fixtures/recent-approved.manifest.json")
    parser.add_argument("--cache", type=Path, default=ROOT / "data/raw/recent")
    parser.add_argument("--report", type=Path, default=ROOT / "data/staging/full-cell-verification.json")
    args = parser.parse_args()
    verify(args.fixture, args.approval, args.cache, args.report)
