"""Read-only historical price-cell audit of the grocery candidate union.

Requires the ignored, checksum-addressed official source cache. This does not
approve product continuity, convert units, fill gaps, or publish observations.
"""

import argparse
import hashlib
import json
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.audit_grocery_catalog import raw_bytes
from scripts.import_recent_prices import read_prices, read_specs
from scripts.legacy_geography import normalize_city_label
from scripts.legacy_prices import read_legacy_prices
from scripts.review_recent_prices import normalized, survey_months


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def header_format_key(value):
    """Group spacing, width and a single parenthesis wrapper only.

    No numeric quantity, alternative package size or product wording is erased.
    Equal keys are display-format evidence, not approval of unit equivalence.
    """
    value = normalized(value)
    return value[1:-1] if value.startswith("(") and value.endswith(")") else value


def evidence(source, row, city, month):
    return {
        "month": month, "cityLabelOrCode": city,
        "raw": row["values"][city], "nativeUnit": row["unit"],
        "sheet": row["sheet"], **row["locations"][city],
        "url": source["url"], "sha256": source["sha256"],
    }


def series_runs(records, field, key=normalized):
    runs = []
    for month, source, row in records:
        value = row.get(field)
        fingerprint = key(value)
        if runs and runs[-1]["key"] == fingerprint:
            runs[-1]["end"] = month
            runs[-1]["monthCount"] += 1
            if value not in runs[-1]["rawExamples"] and len(runs[-1]["rawExamples"]) < 3:
                runs[-1]["rawExamples"].append(value)
        else:
            runs.append({"start": month, "end": month, "monthCount": 1,
                         "key": fingerprint, "rawExamples": [value],
                         "sourceUrl": source["url"], "sha256": source["sha256"],
                         "sheet": row["sheet"], "headerRow": row["row"],
                         "unitLocations": row.get("unitLocations", [])})
    return runs


def read_snapshot(record, codes):
    month = record["month"]
    source = next(s for s in record["sources"] if s["category"] == "food")
    data = raw_bytes(source)
    if data.startswith(b"PK\x03\x04"):
        cities, rows = read_prices(data, month)
        city_ids = [city["id"] for city in cities]
        tokyo = "13100"
        for row in rows:
            row["unitLocations"] = [{"row": row["row"], "column": 12}]
    else:
        # Bypass the production importer's deliberately bounded REVIEW_CODES.
        cities, rows = read_legacy_prices(data, month, codes)
        city_ids = [city["rawLabel"] for city in cities]
        tokyo = next(c for c in city_ids if normalize_city_label(c) == "東京都区部")
        if any(row["format"] == "legacy-wide-xls" for row in rows):
            book = xlrd.open_workbook(file_contents=data)
            try:
                sheet = book.sheet_by_index(0)
                header = next(sheet.row_values(i) for i in range(sheet.nrows)
                              if "銘柄符号" in sheet.row_values(i))
                unit_column = header.index("銘柄符号") + 3
                for row in rows:
                    row["unitLocations"] = [{"row": row["row"], "column": unit_column}]
            finally:
                book.release_resources()
    selected = {row["code"]: row for row in rows if row["code"] in codes}
    if len(selected) != sum(row["code"] in codes for row in rows):
        raise ValueError(f"Duplicate candidate row: {month}")
    if any(set(row["values"]) != set(city_ids) for row in selected.values()):
        raise ValueError(f"Candidate row does not cover actual source roster: {month}")
    return {"month": month, "source": source, "cityCount": len(city_ids),
            "tokyo": tokyo, "rows": selected}


def audit(workers=4):
    input_path = ROOT / "tmp/grocery-catalog-audit.json"
    inputs = json.loads(input_path.read_text(encoding="utf-8"))
    recent = {p["code"]: p for p in inputs["metadataStableUnreviewedRecentCandidates"]
              if p["numericInAllCitiesEveryScheduledMonth"]}
    historical = {p["code"]: p for p in inputs["unreviewedSingleFingerprintEveryHistoricalMonth"]}
    codes = set(recent) | set(historical)
    manifest_path = ROOT / "data/staging/history-source-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    snapshots, failures = [], []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [(record, pool.submit(read_snapshot, record, codes))
                   for record in manifest["months"]]
        for number, (record, future) in enumerate(futures, 1):
            try:
                snapshots.append(future.result())
            except Exception as exc:
                failures.append({"month": record["month"], "error": str(exc)})
            if number % 40 == 0 or number == len(futures):
                print(f"Price workbooks inspected: {number}/{len(futures)}; failures: {len(failures)}", flush=True)
    specification_cache, specs_by_month = {}, {}
    for record in manifest["months"]:
        receipt = record["specSource"]
        if receipt["sha256"] not in specification_cache:
            specification_cache[receipt["sha256"]] = read_specs(raw_bytes(receipt), codes)
        specs_by_month[record["month"]] = specification_cache[receipt["sha256"]]
    all_months = [record["month"] for record in manifest["months"]]
    products = []
    for code in sorted(codes):
        records = [(snapshot["month"], snapshot["source"], snapshot["rows"][code])
                   for snapshot in snapshots if code in snapshot["rows"]]
        found = {month for month, _, _ in records}
        scheduled_numeric, scheduled_non_numeric = 0, 0
        tokens, examples = Counter(), {}
        incomplete_months, tokyo_missing, outside_schedule = [], [], []
        scheduled_month_count, all_city_numeric_months, tokyo_numeric_months = 0, 0, 0
        by_month = {snapshot["month"]: snapshot for snapshot in snapshots}
        calendars, calendar_failures = [], []
        for month, source, row in records:
            snapshot = by_month[month]
            spec = specs_by_month[month].get(code)
            if spec is None:
                calendar_failures.append({"month": month, "error": "No dated specification"})
                continue
            try:
                calendar = survey_months(spec)
            except ValueError as exc:
                calendar_failures.append({"month": month, "error": str(exc)})
                continue
            if not calendars or calendars[-1]["months"] != calendar:
                calendars.append({"start": month, "end": month, "months": calendar})
            else:
                calendars[-1]["end"] = month
            if int(month[5:]) not in calendar:
                outside_schedule.append(month)
                continue
            scheduled_month_count += 1
            missing = [(city, value) for city, value in row["values"].items() if not numeric(value)]
            scheduled_numeric += len(row["values"]) - len(missing)
            scheduled_non_numeric += len(missing)
            if not missing:
                all_city_numeric_months += 1
            else:
                incomplete_months.append({"month": month, "nonNumericCities": len(missing),
                                          "actualRoster": snapshot["cityCount"]})
                for city, value in missing:
                    token = str(value)
                    tokens[token] += 1
                    if token not in examples:
                        examples[token] = []
                    if len(examples[token]) < 5:
                        examples[token].append(evidence(source, row, city, month))
            tokyo = snapshot["tokyo"]
            if numeric(row["values"][tokyo]):
                tokyo_numeric_months += 1
            else:
                tokyo_missing.append(evidence(source, row, tokyo, month))
        first_month, first_source, first_row = records[0]
        last_month, last_source, last_row = records[-1]
        january = next(((source, row) for month, source, row in records if month == "2000-01"), None)
        first_tokyo_numeric = next(
            (evidence(source, row, by_month[month]["tokyo"], month)
             for month, source, row in records
             if numeric(row["values"][by_month[month]["tokyo"]])), None)
        products.append({
            "code": code, "currentName": (recent.get(code) or historical[code])["name"],
            "candidateGroups": {"recentComplete": code in recent, "unchangedDefinition2000": code in historical},
            "firstPriceRow": first_month, "lastPriceRow": last_month, "rowMonthCount": len(records),
            "missingRowMonths": [month for month in all_months if month not in found],
            "currentUnit": last_row["unit"],
            "jan2000Tokyo": evidence(january[0], january[1], by_month["2000-01"]["tokyo"], "2000-01") if january else None,
            "firstTokyoNumericObservation": first_tokyo_numeric,
            "latestTokyo": evidence(last_source, last_row, by_month[last_month]["tokyo"], last_month),
            "unitHeaderRuns": series_runs(records, "unit"),
            "unitHeaderFormatGroupedRuns": series_runs(records, "unit", header_format_key),
            "sourceNameRuns": series_runs(records, "name"),
            "revisionMarkerRuns": series_runs(records, "revision"),
            "surveyCalendarRuns": calendars, "calendarFailures": calendar_failures,
            "outsideScheduleMonths": outside_schedule,
            "scheduled": {"rowMonths": scheduled_month_count, "numericCityCells": scheduled_numeric,
                          "nonNumericCityCells": scheduled_non_numeric,
                          "allCitiesNumericMonths": all_city_numeric_months,
                          "nonNumericTokens": dict(tokens), "nonNumericExamples": examples,
                          "incompleteCityMonths": incomplete_months,
                          "tokyoNumericMonths": tokyo_numeric_months,
                          "tokyoNonNumeric": tokyo_missing},
        })
    return {
        "schemaVersion": 1, "purpose": "Read-only availability screening; no continuity or conversion approval",
        "window": {"start": manifest["start"], "end": manifest["end"], "months": len(all_months)},
        "selection": {"recentComplete": len(recent), "unchangedDefinition2000": len(historical),
                      "overlap": len(set(recent) & set(historical)), "distinctCodes": len(codes)},
        "inputs": {"catalogAuditSha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
                   "historySourceManifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                   "auditScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
        "inspectedPriceWorkbooks": len(snapshots), "sourceFailures": failures,
        "uniqueSpecificationWorkbooks": len(specification_cache),
        "actualRosterRuns": series_runs([(s["month"], s["source"], {"row": 0, "sheet": "",
                                                                    "cityCount": s["cityCount"]})
                                         for s in snapshots], "cityCount"),
        "products": products,
    }


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/candidate-price-history.json")
    args = parser.parse_args()
    result = audit(args.workers)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({key: result[key] for key in ["selection", "inspectedPriceWorkbooks", "sourceFailures"]}, ensure_ascii=False), flush=True)
