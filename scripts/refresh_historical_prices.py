"""Explicit, bounded correction review for retained public-download sources.

Reparse the retained before bytes, re-fetch their known URLs, and write a separate
unapproved window plus a provenance-rich diff. Never edits the approved fixture
or publishes a release. No API credentials, scheduler, or 1.2 GB fixture parse.
"""

import argparse
import hashlib
import json
import re
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import import_recent_prices as importer
from scripts.acquire_early_tokyo_food import read_tokyo_food
from scripts.acquire_supplementary_food import read_supplementary_food
from scripts.legacy_geography import resolve_legacy_city
from scripts.stage_food_history import merge_price_rows

import xlrd

FOOD_AND_PILOT_CODES = {str(code) for code in range(1000, 2100)} | importer.REVIEW_CODES
MONTH = re.compile(r"20\d{2}-(0[1-9]|1[0-2])")
PARSER_FILES = [Path(__file__), ROOT / "scripts/import_recent_prices.py",
                ROOT / "scripts/legacy_prices.py", ROOT / "scripts/legacy_geography.py",
                ROOT / "scripts/acquire_early_tokyo_food.py",
                ROOT / "scripts/acquire_supplementary_food.py", ROOT / "scripts/stage_food_history.py",
                ROOT / "data/legacy-geography-review.json"]


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def source_identity(source):
    return {key: source.get(key) for key in ["id", "url", "sha256", "bytes", "category",
                                           "scope", "publicationMonth", "observationMonth"]}


def checked_snapshot(snapshot):
    """Validate native cell identities before any comparison or staging merge."""
    if not MONTH.fullmatch(snapshot["month"]):
        raise ValueError("Invalid snapshot month")
    cities = {city["id"]: city for city in snapshot["cities"]}
    if len(cities) != len(snapshot["cities"]):
        raise ValueError("Duplicate city identity")
    sources = {source["id"]: source for source in snapshot["sources"]}
    if len(sources) != len(snapshot["sources"]):
        raise ValueError("Duplicate source identity")
    for source in [*sources.values(), snapshot["specSource"]]:
        if not re.fullmatch(r"[a-f0-9]{64}", source["sha256"]):
            raise ValueError("Invalid source hash")
        url = urlsplit(source["url"])
        if (url.scheme != "https" or url.hostname not in {
                "www.e-stat.go.jp", "e-stat.go.jp", "www.stat.go.jp", "stat.go.jp"}
                or url.username or url.password or url.port not in {None, 443}
                or {key.lower() for key in parse_qs(url.query)} & {"appid", "token", "apikey", "api_key"}):
            raise ValueError("Correction URL must be a public official download without credentials")
    rows = {}
    for row in snapshot["prices"]:
        if row["code"] in rows:
            raise ValueError("Duplicate source product identity")
        if row["sourceId"] not in sources:
            raise ValueError("Price references an unknown source")
        if set(row["locations"]) != set(row["values"]) or not set(row["values"]) <= set(cities):
            raise ValueError("Price lacks an actual city or cell locator")
        if not row.get("sheet"):
            raise ValueError("Price lacks a source sheet")
        for locator in row["locations"].values():
            if any(type(locator.get(key)) is not int or locator[key] <= 0 for key in ["row", "column"]):
                raise ValueError("Invalid original cell locator")
        rows[row["code"]] = row
    return cities, sources, rows


def snapshot_fingerprint(snapshot):
    cities, sources, rows = checked_snapshot(snapshot)
    # Ignore staging parser bookkeeping and receipt check times, but bind native
    # values, all parsed row metadata, city definitions, specifications and bytes.
    return digest({"month": snapshot["month"], "cities": cities, "prices": rows,
                   "specs": snapshot["specs"], "specSource": source_identity(snapshot["specSource"]),
                   "sources": {key: source_identity(value) for key, value in sources.items()}})


def provenance(row, city, sources):
    if row is None or city not in row["values"]:
        return None
    source = sources[row["sourceId"]]
    return {"raw": row["values"][city], "source": source_identity(source),
            "sheet": row["sheet"], **row["locations"][city],
            "sourceUnit": row["unit"], "sourceRevision": row.get("revision")}


def numeric(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = Decimal(str(value))
        return result if result.is_finite() and result > 0 else None
    except InvalidOperation:
        return None


def correction_report(before, after, large_change_percent=30):
    threshold = numeric(large_change_percent)
    if threshold is None:
        raise ValueError("Large change threshold must be positive and finite")
    before_months = {s["month"]: s for s in before["snapshots"]}
    after_months = {s["month"]: s for s in after["snapshots"]}
    if (not before_months or set(before_months) != set(after_months)
            or len(before_months) != len(before["snapshots"])
            or len(after_months) != len(after["snapshots"])):
        raise ValueError("Correction windows differ or contain duplicate months")
    report = {"schemaVersion": 1, "reviewStatus": "unapproved-candidate",
              "start": min(before_months), "end": max(before_months),
              "largeChangePercent": str(threshold), "months": [],
              "priceChanges": [], "metadataChanges": [], "sourceChanges": []}
    for month in sorted(before_months):
        old, new = before_months[month], after_months[month]
        old_cities, old_sources, old_rows = checked_snapshot(old)
        new_cities, new_sources, new_rows = checked_snapshot(new)
        old_hash, new_hash = snapshot_fingerprint(old), snapshot_fingerprint(new)
        report["months"].append({"month": month, "before": old_hash, "after": new_hash,
                                 "changed": old_hash != new_hash})
        for source_id in sorted(set(old_sources) | set(new_sources) | {"specifications"}):
            previous = old["specSource"] if source_id == "specifications" else old_sources.get(source_id)
            current = new["specSource"] if source_id == "specifications" else new_sources.get(source_id)
            previous = source_identity(previous) if previous else None
            current = source_identity(current) if current else None
            if previous != current:
                report["sourceChanges"].append({"month": month, "sourceId": source_id,
                                                 "before": previous, "after": current})
        for city in sorted(set(old_cities) | set(new_cities)):
            if old_cities.get(city) != new_cities.get(city):
                report["metadataChanges"].append({"month": month, "kind": "city", "cityId": city,
                                                   "before": old_cities.get(city), "after": new_cities.get(city)})
        for code in sorted(set(old["specs"]) | set(new["specs"])):
            if old["specs"].get(code) != new["specs"].get(code):
                report["metadataChanges"].append({"month": month, "kind": "specification", "code": code,
                                                   "before": old["specs"].get(code), "after": new["specs"].get(code)})
        for code in sorted(set(old_rows) | set(new_rows)):
            previous, current = old_rows.get(code), new_rows.get(code)
            old_meta = {k: v for k, v in previous.items() if k not in {"values", "locations"}} if previous else None
            new_meta = {k: v for k, v in current.items() if k not in {"values", "locations"}} if current else None
            if old_meta != new_meta:
                report["metadataChanges"].append({"month": month, "kind": "price-row", "code": code,
                                                   "before": old_meta, "after": new_meta})
            city_ids = set(previous["values"] if previous else {}) | set(current["values"] if current else {})
            for city in sorted(city_ids):
                old_cell = provenance(previous, city, old_sources)
                new_cell = provenance(current, city, new_sources)
                old_raw = (city in previous["values"], previous["values"].get(city)) if previous else (False, None)
                new_raw = (city in current["values"], current["values"].get(city)) if current else (False, None)
                if canonical(old_raw) != canonical(new_raw):
                    old_value = numeric(old_cell["raw"]) if old_cell else None
                    new_value = numeric(new_cell["raw"]) if new_cell else None
                    same_unit = old_cell and new_cell and old_cell["sourceUnit"] == new_cell["sourceUnit"]
                    percent = (new_value / old_value - 1) * 100 if old_value and new_value and same_unit else None
                    report["priceChanges"].append({"month": month, "code": code, "cityId": city,
                        "before": old_cell, "after": new_cell,
                        "percentChange": str(percent) if percent is not None else None,
                        "largeMovementReview": percent is not None and abs(percent) >= threshold})
                elif old_cell and new_cell and (
                        old_cell["sheet"], old_cell["row"], old_cell["column"]) != (
                        new_cell["sheet"], new_cell["row"], new_cell["column"]):
                    report["metadataChanges"].append({"month": month, "kind": "cell-locator", "code": code,
                                                       "cityId": city, "before": old_cell, "after": new_cell})
    report["counts"] = {"changedMonths": sum(row["changed"] for row in report["months"]),
                       "changedPrices": len(report["priceChanges"]),
                       "metadataChanges": len(report["metadataChanges"]),
                       "sourceChanges": len(report["sourceChanges"]),
                       "largeMovements": sum(row["largeMovementReview"] for row in report["priceChanges"])}
    return report


def evidence(source, cache):
    data = (cache / source["sha256"]).read_bytes()
    if len(data) != source["bytes"] or hashlib.sha256(data).hexdigest() != source["sha256"]:
        raise ValueError("Retained source evidence failed checksum")
    return data


def reparse(record, cache, refreshed=None):
    def supplied(source):
        if refreshed is None:
            return evidence(source, cache), source
        data, receipt = refreshed[source["url"]]
        # An unchanged check does not rewrite acquisition dates in the candidate.
        return data, source if receipt["sha256"] == source["sha256"] else {**source, **receipt}

    spec_data, spec_source = supplied(record["specSource"])
    specs = importer.read_specs(spec_data, FOOD_AND_PILOT_CODES)
    prices, roster, sources = {}, None, []
    for original in record["sources"]:
        data, source = supplied(original)
        category = source.get("category")
        if category == "early-tokyo-food":
            book = xlrd.open_workbook(file_contents=data)
            try:
                if book.nsheets != 1:
                    raise ValueError("Unreviewed Tokyo sheet count")
                rows = read_tokyo_food(book.sheet_by_index(0), record["month"], source["publicationMonth"])
                cities = [{"id": "13100"}]
            finally:
                book.release_resources()
        elif category == "supplementary-food":
            cities, rows = read_supplementary_food(data, record["month"])
        elif category in {"food", "household"}:
            cities, rows = importer.read_prices(data, record["month"], resolve_legacy_city, FOOD_AND_PILOT_CODES)
        else:
            raise ValueError(f"Unreviewed source category: {category}")
        if category != "early-tokyo-food":
            if roster is not None and [c["id"] for c in cities] != [c["id"] for c in roster]:
                raise ValueError("Correction source rosters disagree")
            roster = cities
        merge_price_rows(prices, rows, source["id"])
        sources.append(source)
    if roster is None:
        raise ValueError("Correction lacks a complete city source")
    snapshot = {"month": record["month"], "cities": roster, "sources": sources,
                "listing": record["listing"], "specSource": spec_source, "specs": specs,
                "prices": list(prices.values())}
    checked_snapshot(snapshot)
    return snapshot


def refresh_window(manifest_path, start, end, output, cache, large_change_percent=30):
    if not MONTH.fullmatch(start) or not MONTH.fullmatch(end) or start > end:
        raise ValueError("Invalid correction window")
    months = importer.month_range(start, end)
    if len(months) > 24:
        raise ValueError("Correction window exceeds 24 months; use bounded batches")
    if output.exists():
        raise ValueError("Correction output already exists; choose a new review directory")
    parser_hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in PARSER_FILES}
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    records = [r for r in manifest["months"] if start <= r["month"] <= end]
    if [r["month"] for r in records] != months:
        raise ValueError("Missing, duplicate, or unordered source months")
    before = {"cities": [], "snapshots": [reparse(record, cache) for record in records]}
    unique_sources = {}
    for record in records:
        for source in [*record["sources"], record["specSource"]]:
            unique_sources[source["url"]] = source
    previous_cache = importer.CACHE
    importer.CACHE = cache
    try:
        refreshed = {url: importer.download(url, refresh=True) for url in unique_sources}
    finally:
        importer.CACHE = previous_cache
    after = {"reviewStatus": "unapproved-candidate", "cities": [],
             "snapshots": [reparse(record, cache, refreshed) for record in records]}
    for payload in [before, after]:
        payload["cities"] = list({city["id"]: city for snapshot in payload["snapshots"]
                                  for city in snapshot["cities"]}.values())
    report = correction_report(before, after, large_change_percent)
    if any(hashlib.sha256(path.read_bytes()).hexdigest() != parser_hashes[str(path.relative_to(ROOT))]
           for path in PARSER_FILES):
        raise ValueError("Parser/geography review changed during correction staging; repeat the bounded review")
    report["parserHashes"] = parser_hashes
    report["sourceManifestSha256"] = hashlib.sha256(manifest_bytes).hexdigest()
    report["refreshReceipts"] = [receipt for _, receipt in refreshed.values()]
    report["beforeStagingSha256"], report["afterStagingSha256"] = digest(before), digest(after)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    temporary.mkdir()
    for name, payload in [("before.json", before), ("candidate.json", after), ("report.json", report)]:
        (temporary / name).write_bytes(canonical(payload) + b"\n")
    temporary.rename(output)
    print(json.dumps(report["counts"]), flush=True)
    return report


def combine_staging(baseline, candidate, report):
    """Replace only exactly matched before-months, retaining every other month."""
    if report.get("reviewStatus") != "unapproved-candidate" or digest(candidate) != report["afterStagingSha256"]:
        raise ValueError("Candidate does not match the correction report")
    snapshots = {snapshot["month"]: snapshot for snapshot in baseline["snapshots"]}
    if len(snapshots) != len(baseline["snapshots"]):
        raise ValueError("Duplicate baseline month")
    replacements = {snapshot["month"]: snapshot for snapshot in candidate["snapshots"]}
    reviews = {row["month"]: row for row in report["months"]}
    if (set(replacements) != set(reviews) or len(replacements) != len(candidate["snapshots"])
            or len(reviews) != len(report["months"])):
        raise ValueError("Candidate and report months disagree")
    for month, review in reviews.items():
        if type(review.get("changed")) is not bool or review["changed"] != (review["before"] != review["after"]):
            raise ValueError("Report change flag disagrees with its fingerprints")
        if month not in snapshots or snapshot_fingerprint(snapshots[month]) != review["before"]:
            raise ValueError(f"Baseline month differs from the reviewed before evidence: {month}")
        if snapshot_fingerprint(replacements[month]) != review["after"]:
            raise ValueError("Candidate month differs from report")
    result = dict(baseline)
    result["reviewStatus"] = "unapproved-candidate"
    result["snapshots"] = [replacements[s["month"]] if reviews.get(s["month"], {}).get("changed")
                           else s for s in baseline["snapshots"]]
    result["cities"] = list({city["id"]: city for snapshot in result["snapshots"]
                             for city in snapshot["cities"]}.values())
    return result


def staging_manifest(payload):
    return {"start": payload["snapshots"][0]["month"], "end": payload["snapshots"][-1]["month"],
            "reviewStatus": "unapproved-candidate", "months": [
                {"month": snapshot["month"], "listing": snapshot["listing"],
                 "sources": snapshot["sources"], "specSource": snapshot["specSource"],
                 "cityIds": [city["id"] for city in snapshot["cities"]],
                 "priceCodes": [row["code"] for row in snapshot["prices"]],
                 "formats": sorted({row.get("format", "unknown") for row in snapshot["prices"]})}
                for snapshot in payload["snapshots"]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    refresh = commands.add_parser("refresh", help="Re-fetch a bounded retained source window")
    refresh.add_argument("--manifest", type=Path, default=ROOT / "data/staging/food-history-complete.sources.json")
    refresh.add_argument("--start", required=True)
    refresh.add_argument("--end", required=True)
    refresh.add_argument("--output", required=True, type=Path)
    refresh.add_argument("--cache", type=Path, default=importer.CACHE)
    refresh.add_argument("--large-change-percent", type=Decimal, default=Decimal("30"))
    refresh.add_argument("--refresh", required=True, action="store_true", help="Explicitly re-fetch public sources")
    combine = commands.add_parser("combine", help="Write a separate full candidate after inspecting the report")
    combine.add_argument("--baseline", required=True, type=Path)
    combine.add_argument("--candidate", required=True, type=Path)
    combine.add_argument("--report", required=True, type=Path)
    combine.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.command == "refresh":
        refresh_window(args.manifest, args.start, args.end, args.output, args.cache, args.large_change_percent)
    else:
        sources_path = args.output.with_suffix(".sources.json")
        inputs = {args.baseline.resolve(), args.candidate.resolve(), args.report.resolve()}
        if (args.output.exists() or sources_path.exists()
                or args.output.resolve() in inputs or sources_path.resolve() in inputs):
            parser.error("Output must be a new file, separate from all review inputs")
        # The operator staging archive is ~340 MB. This reads it once, never the
        # much larger normalized fixture. Run on the development/import machine.
        baseline = json.loads(args.baseline.read_bytes())
        candidate = json.loads(args.candidate.read_bytes())
        report = json.loads(args.report.read_bytes())
        result = combine_staging(baseline, candidate, report)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".tmp")
        with temporary.open("w", encoding="utf-8", newline="\n") as stream:
            json.dump(result, stream, ensure_ascii=False, allow_nan=False)
            stream.write("\n")
        sources_temp = sources_path.with_suffix(sources_path.suffix + ".tmp")
        sources_temp.write_bytes(canonical(staging_manifest(result)) + b"\n")
        temporary.replace(args.output)
        sources_temp.replace(sources_path)
        print(f"Wrote unapproved candidate: {args.output}", flush=True)


if __name__ == "__main__":
    main()
