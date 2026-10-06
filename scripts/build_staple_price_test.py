"""Build a small, reproducible basket example from downloaded government files.

This is a pilot, not a full historical importer. Source receipts and raw files
are kept in data/audit/2026-10-05. No application ID or live API is used.
"""
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / "data" / "audit" / "2026-10-05"
OUT = ROOT / "demo"
ITEMS = {
    1021: ("White bread", "食パン", "1 kg", "1kg", True),
    1632: ("White sugar", "砂糖（上白糖）", "1 kg bag", "1kg袋", True),
    1401: ("Cabbage", "キャベツ", "1 kg", "1kg", True),
    1412: ("Potatoes", "じゃがいも", "1 kg", "1kg", True),
    1415: ("Carrots", "にんじん", "1 kg", "1kg", True),
    1001: ("Koshihikari rice", "コシヒカリ", None, None, False),
    1303: ("Milk", "牛乳", None, None, False),
    1341: ("Eggs", "鶏卵", None, None, False),
    4413: ("Toilet paper", "トイレットペーパー", None, None, False),
    4441: ("Laundry detergent", "洗濯用洗剤", None, None, False),
}
REASONS = {
    1001: ("10 kg quotation changed to a specified 5 kg bag in 2002; product rules also changed. No automatic join.",
           "2002年に10kg当たりから指定の5kg袋へ変更。銘柄の条件も改正されているため、自動接続しません。"),
    1303: ("Specification revisions in 2002 and January 2026 need review, despite the matching 1 L unit.",
           "単位は1Lですが、2002年および2026年1月の基本銘柄改正の確認が必要です。"),
    1341: ("Eggs changed from a weight quotation to a 10-egg pack; size rules changed too.",
           "重量当たりから10個入りパックへ変更され、卵のサイズの条件も改正されています。"),
    4413: ("Roll-pack versus length units, and recycled-paper versus pulp specifications, differ.",
           "ロール入り袋と長さ当たりの単位、古紙とパルプの基本銘柄が異なります。"),
    4441: ("Powder in a 1.2 kg box versus liquid detergent per kg; multiple later revisions.",
           "1.2kg箱入りの粉末と1kg当たりの液体で条件が異なり、その後も複数の改正があります。"),
}


def read(stem, suffix="extracted.json"):
    return json.loads((AUDIT / f"{stem}.{suffix}").read_text(encoding="utf-8"))


def rows(stem):
    return read(stem)["sheets"][0]["nonempty_rows"]


def observation(stem, row, col, code, period, unit):
    value = row["values"][col]
    if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"Missing, flagged or invalid price: {stem}, {period}, {code}: {value}")
    return {"period": period, "value": value, "currency": "JPY", "source_unit": unit,
            "source_file": read(stem, "receipt.json")["file"], "evidence_stem": stem,
            "sheet": read(stem)["sheets"][0]["name"], "row": row["row"], "column_1_based": col+1}


def old_city(stem, period, specs):
    result, codes = {}, {}
    for row in rows(stem):
        values = row["values"]
        found = {i: int(m[1]) for i, v in enumerate(values)
                 if isinstance(v, str) and (m := re.fullmatch(r"\((\d{4})\)", v.strip()))}
        if found:
            codes = found
        if "東京都区部" in str(values[7]):
            for col, code in codes.items():
                if code in ITEMS:
                    if code in result:
                        raise ValueError(f"Duplicate item: {stem}, {code}")
                    result[code] = observation(stem, row, col, code, period, specs[code]["unit"])
    return result


def old_tokyo(stem, specs):
    result, codes, year = {}, {}, None
    for row in rows(stem):
        values = row["values"]
        found = {i: int(m[1]) for i, v in enumerate(values)
                 if isinstance(v, str) and (m := re.fullmatch(r"\((\d{4})\)", v.strip()))}
        if found:
            codes, year = found, None
        # Strict full-month labels exclude upper/middle/lower ten-day observations.
        label = re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(values[7])))
        match = re.fullmatch(r"(?:平成)?(?:(\d+)年)?(\d+)(?:月)?", label)
        if not match or not str(values[0]).strip().startswith("002"):
            continue
        if match[1]:
            year = 1988 + int(match[1])  # Printed era is Heisei on this 1999–2000 table.
        if year != 2000:
            continue
        period = f"{year}-{int(match[2]):02d}"
        if period not in {"2000-01", "2000-08"}:
            continue
        for col, code in codes.items():
            if code in ITEMS:
                key = (code, period)
                if key in result:
                    raise ValueError(f"Duplicate monthly historical price: {key}")
                result[key] = observation(stem, row, col, code, period, specs[code]["unit"])
    return result


def modern_city(stem):
    result = {}
    source_rows = rows(stem)
    header = next(r["values"] for r in source_rows if "銘柄符号" in r["values"] and "東京都区部" in r["values"])
    code_col, tokyo_col, unit_col = (header.index(label) for label in ["銘柄符号", "東京都区部", "単位"])
    period_col = header.index("時間軸（月）")
    for row in source_rows:
        values = row["values"]
        code = values[code_col]
        if code in ITEMS:
            if values[period_col] != "2026年8月":
                raise ValueError("Unexpected current period")
            if code in result:
                raise ValueError(f"Duplicate current item: {code}")
            result[code] = observation(stem, row, tokyo_col, code, "2026-08", values[unit_col])
    return result


def modern_tokyo_month(stem, code, period):
    source_rows = rows(stem)
    header = next(r["values"] for r in source_rows if "銘柄符号" in r["values"])
    col = header.index(code)
    unit = next(r["values"][col] for r in source_rows if "単位" in r["values"])
    label = f"{period[:4]}年{int(period[-2:])}月"
    # Column 8 is the ten-day-period code; only null means a full month.
    matches = [r for r in source_rows if r["values"][9] == label and r["values"][8] is None]
    if len(matches) != 1:
        raise ValueError(f"Expected one complete month: {stem}, {period}, found {len(matches)}")
    return observation(stem, matches[0], col, code, period, unit)


def specifications(stem, unit_col):
    return {int(r["values"][0]): {"name": r["values"][1], "definition": r["values"][2],
                                  "unit": r["values"][unit_col], "row": r["row"], "evidence_stem": stem}
            for r in rows(stem) if r["values"][0] in ITEMS}


def norm(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value or "")).replace("、", ",")


def main():
    old_specs = specifications("rps_specs_2000", 4)
    august_specs = specifications("rps_specs_jul2000", 4)
    current_specs = specifications("rps_specs_2026", 5)
    old = {**old_city("rps_jan2000_city_a", "2000-01", old_specs),
           **old_city("rps_jan2000_city_b", "2000-01", old_specs)}
    historical = old_tokyo("rps_tokyo_sep2000_history", old_specs)
    current = {**modern_city("rps_food_aug2026"), **modern_city("rps_household_aug2026")}
    changes = {code: [] for code in ITEMS}
    for sheet in read("rps_spec_changes")["sheets"]:
        for row in sheet["nonempty_rows"]:
            if row["values"][0] in ITEMS:
                changes[int(row["values"][0])].append({"year_sheet": sheet["name"], "row": row["row"],
                                                        "values": row["values"][:8]})
    items = []
    for code, (en, ja, unit_en, unit_ja, eligible) in ITEMS.items():
        if eligible:
            if (norm(old_specs[code]["definition"]) != norm(august_specs[code]["definition"])
                    or norm(old_specs[code]["unit"]) != norm(august_specs[code]["unit"])):
                raise ValueError(f"Unresolved 2000 baseline specification change: {code}")
            if norm(old_specs[code]["definition"]) != norm(current_specs[code]["definition"]):
                raise ValueError(f"Unresolved definition mismatch: {code}")
            if norm(old_specs[code]["unit"]) != norm(current_specs[code]["unit"]):
                raise ValueError(f"Unresolved reporting-unit mismatch: {code}")
            if changes[code] and code != 1412:
                raise ValueError(f"Unreviewed historical specification change: {code}")
            if code == 1412:
                if len(changes[code]) != 1 or changes[code][0]["year_sheet"] != "2010年":
                    raise ValueError("Unexpected potato specification history")
                note_en = "2010 rename (ばれいしょ → じゃがいも) resolved as a name-only change; definition and kg unit match."
                note_ja = "2010年の「ばれいしょ」から「じゃがいも」への名称変更を確認。基本銘柄とkg単位は同一です。"
            else:
                note_en = "Endpoint specifications and units match; no change recorded in the 2001–2026 change workbook."
                note_ja = "両時点の基本銘柄と単位が一致し、2001～2026年の新旧対照表に改正の記録はありません。"
        else:
            note_en, note_ja = REASONS[code]
        # Independent old/current publications must agree on the shared months.
        if old[code]["value"] != historical[(code, "2000-01")]["value"]:
            raise ValueError(f"Old publications disagree: {code}")
        tokyo_stem = "rps_fresh_sep2026_tokyo" if code in {1401, 1412, 1415} else (
            "rps_household_sep2026_tokyo" if code >= 4000 else "rps_food_sep2026_tokyo")
        if current[code]["value"] != modern_tokyo_month(tokyo_stem, code, "2026-08")["value"]:
            raise ValueError(f"Current publications disagree: {code}")
        obs = {"2000-01": old[code], "2000-08": historical[(code, "2000-08")], "2026-08": current[code]}
        comparisons = {base: {"difference_yen": current[code]["value"] - obs[base]["value"],
                              "change_percent": (current[code]["value"] / obs[base]["value"] - 1) * 100}
                       if eligible else None for base in ["2000-01", "2000-08"]}
        items.append({"code": str(code), "name_en": en, "name_ja": ja, "eligible": eligible,
                      "unit_en": unit_en, "unit_ja": unit_ja, "note_en": note_en, "note_ja": note_ja,
                      "old_specification": old_specs[code], "current_specification": current_specs[code],
                      "august_2000_specification": august_specs[code],
                      "changes": changes[code], "observations": obs, "comparisons": comparisons})
    for stem in ["rps_local_specs_aug2026", "rps_local_specs_sep2026"]:
        for row in read(stem).get("rows", []):
            if len(row) >= 5 and row[1] in {str(c) for c in ITEMS} and row[3] == "13100":
                raise ValueError(f"Unresolved local specification: {row}")
    sources = []
    stems = {o["evidence_stem"] for item in items for o in item["observations"].values()}
    stems.update(["rps_tokyo_sep2000_history", "rps_specs_2000", "rps_specs_jul2000", "rps_specs_2026", "rps_spec_changes",
                  "rps_fresh_sep2026_tokyo", "rps_food_sep2026_tokyo", "rps_household_sep2026_tokyo",
                  "rps_local_specs_aug2026", "rps_local_specs_sep2026"])
    for stem in sorted(stems):
        receipt = read(stem, "receipt.json")
        actual = hashlib.sha256((ROOT / receipt["file"]).read_bytes()).hexdigest()
        if actual != receipt["sha256"]:
            raise ValueError(f"Source integrity failure: {stem}")
        sources.append({"name": stem, "url": receipt["requested_url"], "file": receipt["file"],
                        "sha256": actual, "retrieved_at_utc": receipt["retrieved_at_utc"]})
    totals = {}
    for base in ["2000-01", "2000-08"]:
        before = sum(i["observations"][base]["value"] for i in items if i["eligible"])
        after = sum(i["observations"]["2026-08"]["value"] for i in items if i["eligible"])
        totals[base] = {"before_yen": before, "after_yen": after, "difference_yen": after-before,
                        "change_percent": (after/before-1)*100, "quantity_per_item": 1}
    payload = {"source": "Statistics Bureau of Japan — Retail Price Survey (Trend), via e-Stat public files",
               "area_code": "13100", "area_en": "Tokyo wards", "area_ja": "東京都区部",
               "as_of_date": "2026-10-05", "latest_complete_basket_month": "2026-08",
               "latest_release_checked": "2026-09 (Tokyo release dated 2026-10-02)",
               "latest_month_reason": "September fresh-food file contains ten-day observations but no full-month September row.",
               "credentials_used": False, "items": items, "default_basket": totals, "sources": sources,
               "validation": {"raw_hashes_verified": True, "shared_publications_reconciled": True,
                              "full_month_only": True, "unresolved_comparisons_blocked": True},
               "limitations": ["Endpoint example; intervening 2000–2026 observations have not been backfilled.",
                               "Narrow specification review; does not certify the entire survey catalog.",
                               "Nominal, tax-inclusive surveyed prices; no tax or quality adjustment.",
                               "January-versus-August comparison includes seasonality; August 2000 is also available.",
                               "Fixed illustrative quantities; not official CPI or representative household spending."]}
    OUT.mkdir(exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2)
    (OUT / "staple-price-test.json").write_text(serialized+"\n", encoding="utf-8")
    template = (OUT / "staple-price-test.template.html").read_text(encoding="utf-8")
    (OUT / "staple-price-test.html").write_text(template.replace("__PILOT_DATA__", serialized.replace("</", "<\\/")), encoding="utf-8")
    print(json.dumps({"default_basket": totals, "items": [{"code": i["code"], "name": i["name_en"],
                    "before": i["observations"]["2000-01"]["value"], "after": i["observations"]["2026-08"]["value"],
                    "comparison": i["comparisons"]["2000-01"]} for i in items]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
