"""Merge separate food acquisitions into a new offline staging file.

Primary staging bytes and publication fixtures remain unchanged. A duplicate
code/month is a review conflict, never an automatic overwrite. Tokyo-only early
rows retain only Tokyo values; absent other-city cells stay absent.
"""

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def merge_snapshot(target, addition):
    if target["month"] != addition["month"]:
        raise ValueError("Source observation month differs from target snapshot")
    target_cities = {city["id"] for city in target["cities"]}
    added_cities = {city["id"] for city in addition["cities"]}
    if not added_cities <= target_cities:
        raise ValueError(f"Supplementary geography outside actual monthly roster: {target['month']}")
    if target["specSource"]["sha256"] != addition["specSource"]["sha256"]:
        raise ValueError(f"Different dated specification evidence: {target['month']}")
    existing_codes = {row["code"] for row in target["prices"]}
    added_codes = [row["code"] for row in addition["prices"]]
    collisions = existing_codes & set(added_codes)
    if collisions or len(added_codes) != len(set(added_codes)):
        raise ValueError(f"Supplementary code/month conflict: {target['month']}/{sorted(collisions)}")
    existing_ids = {source["id"] for source in target["sources"]}
    added_ids = {source["id"] for source in addition["sources"]}
    if existing_ids & added_ids:
        raise ValueError(f"Duplicate source identity: {target['month']}")
    for row in addition["prices"]:
        if row["sourceId"] not in added_ids or set(row["values"]) != added_cities:
            raise ValueError(f"Supplementary source/city coverage differs: {target['month']}/{row['code']}")
        if set(row["locations"]) != set(row["values"]):
            raise ValueError(f"Supplementary price lacks original cell locator: {target['month']}/{row['code']}")
    for code, spec in addition["specs"].items():
        if code in target["specs"] and target["specs"][code] != spec:
            raise ValueError(f"Dated specification conflict: {target['month']}/{code}")
    target["sources"].extend(addition["sources"])
    target["prices"].extend(addition["prices"])
    target["specs"].update(addition["specs"])
    missing = addition.get("codesWithoutBasicDefinition", [])
    if missing:
        target["codesWithoutBasicDefinition"] = sorted(set(target.get("codesWithoutBasicDefinition", [])) | set(missing))


def stage(primary, supplemental, early_tokyo, output):
    payload = json.loads(primary.read_text(encoding="utf-8"))
    snapshots = {snapshot["month"]: snapshot for snapshot in payload["snapshots"]}
    inputs = [primary, supplemental, early_tokyo]
    additions, added_cells = 0, 0
    for path in inputs[1:]:
        incoming = json.loads(path.read_text(encoding="utf-8"))
        for addition in incoming["snapshots"]:
            if addition["month"] not in snapshots:
                raise ValueError(f"Supplemental month outside primary acquisition: {addition['month']}")
            merge_snapshot(snapshots[addition["month"]], addition)
            additions += len(addition["prices"])
            added_cells += sum(len(row["values"]) for row in addition["prices"])
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp.json")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8", newline="\n")
    temporary.replace(output)
    summary = {"start": payload["snapshots"][0]["month"], "end": payload["snapshots"][-1]["month"],
               "months": len(snapshots), "cityScopes": len(payload["cities"]),
               "sourceCodes": len({row["code"] for snapshot in snapshots.values() for row in snapshot["prices"]}),
               "addedCodeMonthRows": additions, "addedNativeCells": added_cells,
               "inputs": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs},
               "stagingSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
               "limitation": "January–August 2000 supplemental rows have actual Tokyo values only."}
    output.with_suffix(".summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
                                                 encoding="utf-8", newline="\n")
    manifest = {"start": summary["start"], "end": summary["end"], "months": [
        {"month": snapshot["month"], "listing": snapshot["listing"], "sources": snapshot["sources"],
         "specSource": snapshot["specSource"], "cityIds": [city["id"] for city in snapshot["cities"]],
         "priceCodes": [row["code"] for row in snapshot["prices"]],
         "formats": sorted({row["format"] for row in snapshot["prices"]})}
        for snapshot in payload["snapshots"]]}
    output.with_suffix(".sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                                 encoding="utf-8", newline="\n")
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--primary", type=Path, default=ROOT / "data/staging/food-history.json")
    parser.add_argument("--supplemental", type=Path, default=ROOT / "data/staging/supplementary-food-history.json")
    parser.add_argument("--early-tokyo", type=Path, default=ROOT / "data/staging/early-tokyo-food-history.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/staging/food-history-complete.json")
    args = parser.parse_args()
    stage(args.primary, args.supplemental, args.early_tokyo, args.output)
