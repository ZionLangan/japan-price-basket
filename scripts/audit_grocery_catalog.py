"""Read-only catalog/coverage audit against retained official RPS workbooks.

Requires the operator's ignored raw archive and history-source-manifest.json.
This reports source availability and review candidates; it admits no products,
does not normalize prices, and does not approve historical comparability.
"""

import argparse
import hashlib
import json
import io
import re
import sys
import urllib.parse
from collections import Counter
from html import unescape
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_recent_prices import read_prices, read_specs
from scripts.review_recent_prices import normalized, specification_hash, survey_months


# Audit groupings, explicitly limited to the inspected full-city food part.
# These are code ranges, not a claimed replacement for the official CPI tree.
GROUPS = [
    ("Grains and bread", 1000, 1099),
    ("Fish and seafood", 1100, 1199),
    ("Meat", 1200, 1299),
    ("Dairy and eggs", 1300, 1399),
    ("Vegetables, seaweed, soy and processed vegetables", 1400, 1499),
    ("Fruit and nuts", 1500, 1599),
    ("Oils and seasonings", 1600, 1699),
    ("Sweets and snacks", 1700, 1789),
    ("Prepared foods", 1790, 1899),
    ("Non-alcoholic drinks", 1900, 1999),
    ("Alcohol", 2000, 2099),
    ("Eating out and delivery", 2100, 2179),
    ("School meals", 2180, 2199),
]


def raw_bytes(receipt):
    data = (ROOT / "data/raw/recent" / receipt["sha256"]).read_bytes()
    if hashlib.sha256(data).hexdigest() != receipt["sha256"] or len(data) != receipt["bytes"]:
        raise ValueError(f"Original source checksum/length mismatch: {receipt['url']}")
    return data


def numeric_count(row):
    return sum(isinstance(v, (int, float)) and not isinstance(v, bool)
               for v in row["values"].values())


def uniform_food_rows(snapshot, month):
    """Inspect the separately scoped nationwide table; never assign city IDs."""
    page = raw_bytes(snapshot["listing"]).decode("utf-8")
    articles = [a for a in re.findall(r"<article\b.*?</article>", page, re.S)
                if "全国統一価格品目の価格" in a]
    if len(articles) != 1:
        raise ValueError("Expected one nationwide uniform-price table")
    link = re.search(r'href="([^"<>]+file-download\?[^"<>]+fileKind=0)"', articles[0])
    if link is None:
        raise ValueError("Missing uniform-price machine-readable workbook link")
    url = urllib.parse.urljoin("https://www.e-stat.go.jp", unescape(link[1]))
    receipt_path = ROOT / "data/raw/recent" / (hashlib.sha256(url.encode()).hexdigest() + ".json")
    if not receipt_path.exists():
        raise ValueError(f"Nationwide source is not cached; cache this public workbook first: {url}")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if receipt["url"] != url:
        raise ValueError("Cached national table URL mismatch")
    book = openpyxl.load_workbook(io.BytesIO(raw_bytes(receipt)), read_only=True, data_only=True)
    try:
        sheet = book.worksheets[0]
        values = list(sheet.values)
        header = next(r for r in values if "地域コード" in r and "銘柄符号" in r)
        period = f"{int(month[:4])}年{int(month[5:])}月"
        column = next(i for i, cell in enumerate(header) if normalized(cell) == period)
        rows = []
        for index, row in enumerate(values, 1):
            code = str(row[9]) if len(row) > 9 else ""
            if re.fullmatch(r"\d{4}", code) and 1000 <= int(code) < 2200:
                if row[7] != "00000" or row[8] != "全国":
                    raise ValueError("Expected explicitly national scope")
                rows.append({"code": code, "name": row[10], "unit": row[11],
                             "numeric": isinstance(row[column], (int, float)),
                             "scope": "00000", "sheet": sheet.title,
                             "row": index, "column": column + 1})
        return receipt, rows
    finally:
        book.close()


def audit(month):
    manifest = json.loads((ROOT / "data/staging/history-source-manifest.json").read_text(encoding="utf-8"))
    matches = [s for s in manifest["months"] if s["month"] == month]
    if len(matches) != 1:
        raise ValueError(f"Expected one acquired monthly snapshot: {month}")
    snapshot = matches[0]
    source = next(s for s in snapshot["sources"] if s["category"] == "food")
    cities, rows = read_prices(raw_bytes(source), month)
    if len({r["code"] for r in rows}) != len(rows):
        raise ValueError("Duplicate full-city item codes")
    specs = read_specs(raw_bytes(snapshot["specSource"]))
    groceries = [r for r in rows if 1000 <= int(r["code"]) < 2100]
    codes = {r["code"] for r in groceries}
    review = json.loads((ROOT / "data/catalog-review.json").read_text(encoding="utf-8"))
    reviewed = [p for p in review["products"] if p["code"] in codes]
    reviewed_codes = {p["code"] for p in reviewed}
    household = [p for p in review["products"] if p["code"] not in codes]
    selectable = [p for p in review["products"] if p.get("selectable", True)]
    categories = []
    for name, first, last in GROUPS:
        group = [r for r in rows if first <= int(r["code"]) <= last]
        categories.append({
            "category": name, "firstCode": first, "lastCode": last,
            "series": len(group),
            "numericInAnyCity": sum(numeric_count(r) > 0 for r in group),
            "numericInEveryCity": sum(numeric_count(r) == len(cities) for r in group),
            "reviewedSourceCodes": sum(r["code"] in reviewed_codes for r in group),
        })
    if sum(c["series"] for c in categories) != len(rows):
        raise ValueError("Unclassified food-workbook series")
    missing_specs = codes - set(specs)
    if missing_specs:
        raise ValueError(f"Price series lack dated definitions: {sorted(missing_specs)}")
    national_source, national_rows = uniform_food_rows(snapshot, month)
    national_grocery_rows = [r for r in national_rows if int(r["code"]) < 2100]
    extra_retail_definitions = {code for code in specs if 1000 <= int(code) < 2100} - codes
    if {r["code"] for r in national_grocery_rows} != extra_retail_definitions:
        raise ValueError("Uniform-price rows differ from the extra retail definitions")
    all_food_definitions = {code for code in specs if 1000 <= int(code) < 2200}
    all_food_prices = {r["code"] for r in rows} | {r["code"] for r in national_rows}
    if all_food_definitions != all_food_prices:
        raise ValueError("Combined city/national food rows differ from dated food definitions")
    seasonal = [{"code": r["code"], "name": r["name"],
                 "months": survey_months(specs[r["code"]]),
                 "numericCities": numeric_count(r)}
                for r in groceries if len(survey_months(specs[r["code"]])) < 12]
    specification_cache = {}
    definitions = {code: [] for code in codes}
    for record in manifest["months"]:
        if record["month"] > month:
            continue
        receipt = record["specSource"]
        if receipt["sha256"] not in specification_cache:
            specification_cache[receipt["sha256"]] = read_specs(raw_bytes(receipt), codes)
        for code, spec in specification_cache[receipt["sha256"]].items():
            definitions[code].append((record["month"], specification_hash(spec)))
    # The recent adapter can inspect every source row. Legacy adapters in the
    # production importer are deliberately limited to the already reviewed20.
    recent = [s for s in manifest["months"] if "2020-12" <= s["month"] <= month]
    recent_rows = {}
    for record in recent:
        receipt = next(s for s in record["sources"] if s["category"] == "food")
        _, values = read_prices(raw_bytes(receipt), record["month"])
        recent_rows[record["month"]] = {r["code"]: r for r in values}
    unreviewed = codes - reviewed_codes
    stable_candidates = []
    for code in sorted(unreviewed):
        dated = [(date, fingerprint) for date, fingerprint in definitions[code] if date >= "2020-12"]
        records = [recent_rows[s["month"]].get(code) for s in recent]
        if (len(dated) == len(recent) and len({fingerprint for _, fingerprint in dated}) == 1
                and all(r is not None for r in records)
                and len({normalized(r["unit"]) for r in records}) == 1
                and len({normalized(r["name"]) for r in records}) == 1
                and len({normalized(r.get("revision")) for r in records}) == 1):
            calendar = survey_months(specs[code])
            scheduled = [r for s, r in zip(recent, records, strict=True)
                         if int(s["month"][5:]) in calendar]
            stable_candidates.append({
                "code": code, "name": next(r["name"] for r in groceries if r["code"] == code),
                "numericInEveryScheduledMonthSomewhere": all(numeric_count(r) > 0 for r in scheduled),
                "numericInAllCitiesEveryScheduledMonth": all(numeric_count(r) == len(cities) for r in scheduled),
            })
    history_month_count = len([s for s in manifest["months"] if s["month"] <= month])
    return {
        "month": month, "cityCount": len(cities), "foodWorkbookSeries": len(rows),
        "groceryAndDrinkSeries": len(groceries),
        "nationalUniformGrocerySeries": national_grocery_rows,
        "nationalUniformEatingOutSeries": [r for r in national_rows if int(r["code"]) >= 2100],
        "combinedCityAndNationalGroceryCodes": len(codes | extra_retail_definitions),
        "groceryNumericInAnyCity": sum(numeric_count(r) > 0 for r in groceries),
        "groceryNumericInEveryCity": sum(numeric_count(r) == len(cities) for r in groceries),
        "categories": categories, "seasonalSeries": seasonal,
        "retailDefinitionsWithoutFullCityRow": [
            {"code": code, "name": specs[code]["name"]} for code in sorted(specs)
            if 1000 <= int(code) < 2100 and code not in codes],
        "reviewedFoodSourceCodes": len(reviewed_codes), "reviewedFoodVariants": len(reviewed),
        "reviewedHouseholdSourceCodes": len({p["code"] for p in household}),
        "reviewedHouseholdVariants": len(household),
        "reviewedTotalVariants": len(review["products"]),
        "selectableVariantsBeforeCityPeriodChecks": len(selectable),
        "archivedUnselectableVariants": len(review["products"]) - len(selectable),
        "unreviewedGroceryCodes": len(unreviewed),
        "unreviewedDefinitionsPresentEveryHistoricalMonth": sum(
            len(definitions[code]) == history_month_count for code in unreviewed),
        "unreviewedSingleFingerprintEveryHistoricalMonth": [
            {"code": code, "name": specs[code]["name"], "currentSourceUnit":
             next(r["unit"] for r in groceries if r["code"] == code)}
            for code in sorted(unreviewed) if len(definitions[code]) == history_month_count
            and len({h for _, h in definitions[code]}) == 1],
        "recentCandidateWindow": {"start": "2020-12", "end": month, "months": len(recent)},
        "metadataStableUnreviewedRecentCandidates": stable_candidates,
        "latestSources": {"prices": source, "specifications": snapshot["specSource"],
                          "nationwideUniformPrices": national_source},
        "groceryNonNumericTokens": dict(Counter(str(v) for r in groceries for v in r["values"].values()
                                                if not isinstance(v, (int, float)))),
    }


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--month", default="2026-08")
    args = parser.parse_args()
    print(json.dumps(audit(args.month), ensure_ascii=False, indent=2))
