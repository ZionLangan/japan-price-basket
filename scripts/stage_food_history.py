"""Reparse retained monthly evidence for the whole retail-food catalog offline.

This expands acquisition, not catalog approval. Missing source rows stay absent;
dated definitions, raw cells and geographic scopes are retained for review.
The original bounded importer and its staging remain reproducible.
"""

import argparse
import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_recent_prices import REVIEW_CODES, read_prices, read_specs
from scripts.legacy_geography import resolve_legacy_city


def evidence(source, cache):
    data = (cache / source["sha256"]).read_bytes()
    if len(data) != source["bytes"] or hashlib.sha256(data).hexdigest() != source["sha256"]:
        raise ValueError(f"Retained evidence failed checksum: {source['url']}")
    return data


def merge_price_rows(target, rows, source_id):
    """Do not let duplicate files silently overwrite a source observation."""
    for row in rows:
        if row["code"] in target:
            raise ValueError(f"Duplicate source item in monthly city tables: {row['code']}")
        target[row["code"]] = {**row, "sourceId": source_id}


def stage(manifest_path, output, cache, workers=2):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    selected = {str(code) for code in range(1000, 2100)} | REVIEW_CODES
    spec_cache = {}
    for record in manifest["months"]:
        source = record["specSource"]
        if source["sha256"] not in spec_cache:
            spec_cache[source["sha256"]] = read_specs(evidence(source, cache), selected)

    def read_month(record):
        month = record["month"]
        prices, roster = {}, None
        for source in record["sources"]:
            cities, rows = read_prices(evidence(source, cache), month,
                                       resolve_legacy_city, selected)
            if roster is not None and [c["id"] for c in cities] != [c["id"] for c in roster]:
                raise ValueError(f"Source city rosters differ in {month}")
            roster = cities
            merge_price_rows(prices, rows, source["id"])
        if [c["id"] for c in roster] != record["cityIds"]:
            raise ValueError(f"Geographic review differs from retained acquisition: {month}")
        snapshot = {"month": month, "cities": roster, "listing": record["listing"],
                    "sources": record["sources"], "specSource": record["specSource"],
                    "specs": spec_cache[record["specSource"]["sha256"]],
                    "prices": list(prices.values())}
        return snapshot

    snapshots = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for snapshot in pool.map(read_month, manifest["months"]):
            snapshots.append(snapshot)
            if len(snapshots) % 20 == 0 or len(snapshots) == len(manifest["months"]):
                print(f"{len(snapshots)}/{len(manifest['months'])}: {snapshot['month']}", flush=True)
    union = {city["id"]: city for snapshot in snapshots for city in snapshot["cities"]}
    payload = {"cities": list(union.values()), "snapshots": snapshots}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp.json")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8", newline="\n")
    temporary.replace(output)
    counts = {code: sum(any(r["code"] == code for r in s["prices"]) for s in snapshots)
              for code in sorted({r["code"] for s in snapshots for r in s["prices"]})}
    summary = {"start": snapshots[0]["month"], "end": snapshots[-1]["month"],
               "months": len(snapshots), "cityScopes": len(union),
               "sourceCodes": len(counts), "codeMonthCounts": counts,
               "limitation": "Retained primary city tables only; supplementary tables require acquisition."}
    output.with_suffix(".summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({key: value for key, value in summary.items() if key != "codeMonthCounts"}))
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/staging/history-source-manifest.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/staging/food-history.json")
    parser.add_argument("--cache", type=Path, default=ROOT / "data/raw/recent")
    parser.add_argument("--workers", type=int, default=2, choices=range(1, 5))
    args = parser.parse_args()
    stage(args.manifest, args.output, args.cache, args.workers)
