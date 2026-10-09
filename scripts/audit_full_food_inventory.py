"""Read-only inventory of every retained grocery source code and dated definition.

Requires ignored history-source-manifest.json and immutable raw workbooks.
Reports source availability; it approves no product continuity or conversion.
Audit-only unit fallbacks retain candidate headers for production adapter review.
"""
import argparse
import hashlib
import json
import re
import sys
import unicodedata
import urllib.parse
from html import unescape
from threading import local
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.audit_candidate_prices import read_snapshot as read_native_snapshot, numeric, series_runs
from scripts.audit_grocery_catalog import raw_bytes
from scripts.import_recent_prices import read_specs
from scripts.review_recent_prices import survey_months, specification_hash
import scripts.legacy_prices as legacy

original_unit = legacy.printed_unit
unit_fallbacks = []
source_context = local()


def read_snapshot(record, codes):
    source_context.record = record
    return read_native_snapshot(record, codes)


def audit_unit(rows, start, end, column, code, city_column):
    try:
        return original_unit(rows, start, end, column, code, city_column)
    except ValueError as exc:
        candidates = []
        for index in range(start, end):
            text = str(rows[index][column] or "")
            if not re.match(r"^[（(]\s*\d", unicodedata.normalize("NFKC", text)):
                continue
            fragments, locations = [text], [{"row": index + 1, "column": column + 1}]
            cursor = index
            while ")" not in unicodedata.normalize("NFKC", "".join(fragments)) and cursor + 1 < end:
                cursor += 1
                if rows[cursor][column]:
                    fragments.append(str(rows[cursor][column]))
                    locations.append({"row": cursor + 1, "column": column + 1})
            joined = "".join(fragments)
            if ")" in unicodedata.normalize("NFKC", joined):
                candidates.append({"text": joined, "locations": locations})
        record = source_context.record
        source = next(s for s in record["sources"] if s["category"] == "food")
        unit_fallbacks.append({"month": record["month"], "sourceUrl": source["url"],
                               "sha256": source["sha256"], "code": code,
                               "error": str(exc), "candidates": candidates})
        if len(candidates) == 1:
            return candidates[0]["text"], candidates[0]["locations"], []
        return "[AUDIT UNIT UNRESOLVED] " + " | ".join(c["text"] for c in candidates), [p for c in candidates for p in c["locations"]], candidates


def supplementary_tables(manifest):
    """List omitted historical food-relevant table scopes without downloading."""
    result = []
    for record in manifest["months"]:
        page = raw_bytes(record["listing"]).decode("utf-8")
        for article in re.findall(r"<article\b.*?</article>", page, re.S):
            href = re.search(r'href="([^"<>]+file-download\?[^"<>]+fileKind=0)"', article)
            if href is None:
                continue
            title = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", article))).strip()
            if "主要品目の都市別小売価格" in title and "月報非掲載表" in title:
                category = "historicalCityUnpublished"
            elif "その他の品目の東京都区部小売価格" in title:
                category = "historicalTokyoOther"
            else:
                continue
            result.append({"month": record["month"], "category": category,
                           "url": urllib.parse.urljoin("https://www.e-stat.go.jp", unescape(href[1])),
                           "title": title, "listingSha256": record["listing"]["sha256"]})
    return result


def quotation_group(unit):
    unit = unicodedata.normalize("NFKC", unit).replace(",", "")
    if unit in {"100g", "1kg"}:
        return "standardMass"
    if re.fullmatch(r"\d+(?:\.\d+)?mL", unit):
        return "standardVolume"
    if any(token in unit for token in ("又は", "~", "〜")):
        return "variableMassPackage"
    if re.search(r"\d+(?:\.\d+)?(?:kg|g|mL|L)", unit):
        return "fixedNumericPackage"
    return "countOrPackage"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/full-food-inventory.json")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    legacy.printed_unit = audit_unit

    manifest = json.loads((ROOT / "data/staging/history-source-manifest.json").read_text(encoding="utf-8"))
    codes = {str(i) for i in range(1000, 2100)}
    spec_cache = {}
    specs_by_month = {}
    for record in manifest["months"]:
        ref = record["specSource"]
        if ref["sha256"] not in spec_cache:
            spec_cache[ref["sha256"]] = read_specs(raw_bytes(ref), codes)
        specs_by_month[record["month"]] = spec_cache[ref["sha256"]]
    print(f"Definitions inspected: {len(spec_cache)} unique workbooks", flush=True)
    snapshots, failures = [], []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [(record, pool.submit(read_snapshot, record, codes)) for record in manifest["months"]]
        for i, (record, future) in enumerate(futures, 1):
            try:
                snapshots.append(future.result())
            except Exception as exc:
                failures.append({"month": record["month"], "error": str(exc)})
            if i % 40 == 0:
                print(f"Price files inspected: {i}/{len(futures)}; failures {len(failures)}", flush=True)
    legacy.printed_unit = original_unit
    if failures:
        raise ValueError(f"Incomplete source inventory; no output written: {failures}")
    all_codes = set().union(*(s["rows"] for s in snapshots))
    definition_codes = set().union(*(s for s in specs_by_month.values()))
    latest = snapshots[-1]
    current_codes = set(latest["rows"])
    products = []
    for code in sorted(definition_codes | all_codes):
        defs = [(m, s[code]) for m, s in specs_by_month.items() if code in s]
        records = [(s["month"], s["source"], s["rows"][code]) for s in snapshots if code in s["rows"]]
        scheduled_numeric, scheduled_missing = 0, 0
        tokens = Counter()
        tokyo_numeric, tokyo_missing, calendars, calendar_failures = [], [], [], []
        incomplete = []
        for snapshot in snapshots:
            month = snapshot["month"]
            if code not in snapshot["rows"]:
                continue
            row = snapshot["rows"][code]
            spec = specs_by_month[month].get(code)
            if spec is None:
                calendar_failures.append({"month": month, "error": "No dated definition"})
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
                continue
            missing = [(city, v) for city, v in row["values"].items() if not numeric(v)]
            scheduled_numeric += len(row["values"]) - len(missing)
            scheduled_missing += len(missing)
            tokens.update(str(v) for _, v in missing)
            if missing:
                incomplete.append({"month": month, "count": len(missing)})
            if numeric(row["values"][snapshot["tokyo"]]):
                tokyo_numeric.append(month)
            else:
                tokyo_missing.append(month)
        products.append({"code": code, "currentCitySeries": code in current_codes,
            "latestDefinitionName": defs[-1][1]["name"] if defs else None,
            "currentPriceName": latest["rows"].get(code, {}).get("name"),
            "firstDefinition": defs[0][0] if defs else None, "lastDefinition": defs[-1][0] if defs else None,
            "definitionMonthCount": len(defs), "definitionVersions": len({specification_hash(d) for _, d in defs}),
            "firstPrimaryPriceRow": records[0][0] if records else None,
            "lastPrimaryPriceRow": records[-1][0] if records else None, "primaryPriceRowMonths": len(records),
            "firstScheduledTokyoNumeric": tokyo_numeric[0] if tokyo_numeric else None,
            "tokyoScheduledNonNumericMonths": tokyo_missing,
            "scheduledNumericCityCells": scheduled_numeric, "scheduledNonNumericCityCells": scheduled_missing,
            "scheduledNonNumericTokens": dict(tokens), "incompleteScheduledMonths": incomplete,
            "unitRuns": series_runs(records, "unit"), "sourceNameRuns": series_runs(records, "name"),
            "calendarRuns": calendars, "calendarFailures": calendar_failures,
            "latestDefinition": defs[-1][1] if defs else None})
    current_products = [p for p in products if p["currentCitySeries"]]
    supplements = supplementary_tables(manifest)
    report = {"window": {"start":manifest["start"], "end":manifest["end"], "months":len(manifest["months"])},
        "manifestHash": hashlib.sha256((ROOT / "data/staging/history-source-manifest.json").read_bytes()).hexdigest(),
        "purpose":"Availability screening only; source-native headers retained. Audit-only fallback unit parsing may need production adapter review.",
        "sourceFailures": failures, "inspectedPrimaryWorkbooks": len(snapshots),
        "currentCityGroceryCodes": len(current_codes), "historicalPrimaryGroceryCodeUnion":len(all_codes),
        "historicalBasicGroceryDefinitionCodeUnion":len(definition_codes),
        "uniqueSpecificationWorkbooks":len(spec_cache),
        "currentCodesWithAllPrimaryMonths":sum(p["primaryPriceRowMonths"] == len(manifest["months"]) for p in current_products),
        "currentCodesWithAllDefinitionMonths":sum(p["definitionMonthCount"] == len(manifest["months"]) for p in current_products),
        "currentCodesWithNoScheduledTokyoGap":sum(not p["tokyoScheduledNonNumericMonths"] and not p["calendarFailures"]
                                                   for p in current_products),
        "currentNativeQuotationGroups":dict(Counter(quotation_group(p["unitRuns"][-1]["rawExamples"][0]) for p in current_products)),
        "supplementaryTableCounts":dict(Counter(p["category"] for p in supplements)),
        "supplementaryTables":supplements,
        "unitFallbackCalls":len(unit_fallbacks), "unitFallbacks":unit_fallbacks, "products":products}
    unit_fallbacks.sort(key=lambda value: (value["month"], value["code"]))
    output = args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k not in {"products","unitFallbacks","supplementaryTables"}},ensure_ascii=False,indent=2))
    print(f"Wrote {output}",flush=True)
