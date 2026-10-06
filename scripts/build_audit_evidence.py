"""Build the audit's evidence indexes from saved receipts and inspected files.

This is an audit artifact builder, not a production data importer.
"""

import hashlib
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / "data" / "audit" / "2026-10-05"


def read(name):
    return json.loads((AUDIT / name).read_text(encoding="utf-8-sig"))


def save(name, value):
    (AUDIT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    manifest = []
    for path in sorted(AUDIT.glob("*.receipt.json")):
        receipt = read(path.name)
        item = {**receipt, "receipt_file": path.relative_to(ROOT).as_posix()}
        if "file" in item:
            raw = ROOT / item["file"]
            actual_hash = hashlib.sha256(raw.read_bytes()).hexdigest()
            if actual_hash != item["sha256"]:
                raise ValueError(f"Raw evidence hash mismatch: {raw}")
            item["bytes"] = raw.stat().st_size
            item["integrity_verified"] = True
        extraction = AUDIT / f"{receipt['name']}.extracted.json"
        if extraction.exists():
            item["extracted_file"] = extraction.relative_to(ROOT).as_posix()
        manifest.append(item)
    save("audit_manifest.json", {"audit_date_jst": "2026-10-05", "probes": manifest})

    # Periods below describe the stated or inspected coverage, not certified continuity.
    profiles = [
        ("rps_city", "Statistics Bureau", "Retail Price Survey, Trend: city prices", "primary_basket",
         "monthly", "Database title: January 2000 onward; January 2000/2010 and August 2026 full-month files inspected; September 2026 Tokyo release has partial fresh-food observations",
         "e-Stat API requires appId; public XLS/XLSX/CSV do not", "verified_download",
         "https://www.e-stat.go.jp/dbview?sid=0003421913",
         ["rps_jan2000_city_a", "rps_jan2000_city_b", "rps_tokyo_sep2000_history", "rps_specs_2000", "rps_specs_jul2000", "rps_jan2010_city_a", "rps_jan2010_city_b", "rps_food_aug2026", "rps_household_aug2026", "rps_local_specs_aug2026", "rps_specs_2010", "rps_specs_2020", "rps_specs_2026", "rps_spec_changes", "rps_food_sep2026_tokyo", "rps_household_sep2026_tokyo", "rps_fresh_sep2026_tokyo", "rps_local_specs_sep2026"],
         ["Specification and reporting-unit breaks", "Local-specification Y flags", "City roster changes", "Missing observations"]),
        ("rps_uniform", "Statistics Bureau", "Trend: nationwide uniform-price items", "eligible_items_only",
         "monthly/annual", "Monthly database title: February 2000 onward", "e-Stat API or public files",
         "reviewed_catalog", "https://www.e-stat.go.jp/dbview?sid=0003449369", [],
         ["Not a national grocery-price average"]),
        ("rps_tokyo_history", "Statistics Bureau", "Tokyo wards historical retail table", "optional_history",
         "annual", "1950–2010 workbook inspected", "Public legacy XLS", "verified_download",
         "https://www.stat.go.jp/data/kouri/doukou/zuhyou/kubu_chouki.xls", ["rps_tokyo_long"],
         ["Selected items only", "Long-run definition changes"]),
        ("cpi_dashboard", "Statistics Bureau", "CPI via Statistical Dashboard", "official_benchmark",
         "monthly", "Current indicator metadata starts January 1970; 200 observations January 2010–August 2026 retrieved",
         "Public JSON/XML/CSV API; registration not required", "verified_api",
         "https://dashboard.e-stat.go.jp/static/api", ["dashboard_cpi_meta", "dashboard_cpi_data", "dashboard_data_schema"],
         ["Index points, not yen", "Base and indicator changes", "Rounded indices versus official change rates"]),
        ("rps_structural", "Statistics Bureau", "Retail Price Survey, Structural", "regional_context",
         "annual", "2013 onward; store-type/brand surveying ended December 2021", "e-Stat API/files",
         "reviewed_documentation", "https://www.stat.go.jp/data/kouri/kouzou/gaiyou.htm", [],
         ["Spatial indices are not time-series yen prices", "Retired price components"]),
        ("household_expenditure", "Statistics Bureau", "Family Income and Expenditure Survey", "preset_quantities",
         "table-specific monthly/quarterly/annual", "Relevant annual item index: 2005 onward; older annual tables also exist",
         "e-Stat API/files", "reviewed_documentation", "https://www.stat.go.jp/data/kakei/rank/singleyear.html", [],
         ["Household population must be fixed", "Unit values depend on purchase mix"]),
        ("maff_vegetables", "MAFF", "Food Price Monitoring: vegetables", "optional_national_retail",
         "weekly", "Survey starts April 2010; inspected XLSX weeks November 2017–September 2026",
         "Public XLSX and older PDFs; dedicated public API not found", "verified_download",
         "https://www.maff.go.jp/j/zyukyu/anpo/kouri/k_yasai/h22index.html", ["maff_veg_archive_xlsx", "maff_veg_backup", "maff_veg_latest"],
         ["Explicit pandemic sample discontinuities", "Seasonal/item roster changes", "National normal prices excluding promotions"]),
        ("maff_processed", "MAFF", "Food Price Monitoring: processed foods", "optional_national_retail",
         "monthly currently", "Survey starts January 2008; monthly yen prices from October 2018", "Public PDFs/archive",
         "verified_download", "https://www.maff.go.jp/j/zyukyu/anpo/kouri/gaiyou.html",
         ["maff_processed_latest", "maff_processed_specs", "maff_processed_past"],
         ["September/October 2018 non-connectable boundary", "Report versus definition-sheet tuna-can size discrepancy", "PDF parsing"]),
        ("maff_meat_eggs", "MAFF", "Food Price Monitoring: meat and eggs", "optional_national_retail",
         "weekly through April 2012; monthly since May 2012", "Survey starts August 2003; latest report and archive index inspected",
         "Public PDFs", "verified_download", "https://www.maff.go.jp/j/zyukyu/anpo/kouri/k_gyuniku/index.html",
         ["maff_meat_eggs", "maff_meat_latest"], ["Egg size changed July 2019", "Frequency change", "Full archive not backfilled"]),
        ("maff_fish", "MAFF", "Food Price Monitoring: fish", "optional_national_retail",
         "monthly", "October 2018 onward; September 2026 report inspected", "Public PDFs", "verified_download",
         "https://www.maff.go.jp/j/zyukyu/anpo/kouri/k_gyuniku/fish/index.html", ["maff_fish", "maff_fish_latest"],
         ["Detailed product definitions need qualification", "No city matrix"]),
        ("maff_fruit", "MAFF", "Food Price Monitoring: fruit", "optional_national_retail",
         "monthly", "October 2023 onward; September 2026 report inspected", "Public PDFs", "verified_download",
         "https://www.maff.go.jp/j/zyukyu/anpo/kouri/kouri/kajyu.html", ["maff_fruit_valid", "maff_fruit_latest"],
         ["Seasonal missingness", "Short history"]),
        ("maff_rice_pos", "MAFF / private POS panels", "Rice POS summaries", "optional_sales_context",
         "weekly/monthly by report", "Current inspected weekly PDF: February 2025–September 2026; broader KSP monitoring described as starting in 2022",
         "Public government reports; private raw POS data", "verified_download",
         "https://www.maff.go.jp/j/nousan/kokumotu/kome_kakaku.html", ["maff_rice_portal", "maff_rice_weekly", "maff_rice_monthly"],
         ["Sales/product mix changes", "Private-data reuse conditions", "Current PDF is overwritten", "Full 2022-onward archive not established"]),
        ("maff_retired_retail", "MAFF", "Older fresh-food/vegetable retail surveys", "historical_only",
         "historical monthly/annual tables", "Fresh-food file index 2003–2013; successor 2014–2016 ended",
         "e-Stat files", "reviewed_documentation", "https://www.maff.go.jp/j/tokei/kouhyou/seisen_doukou/index.html",
         ["maff_old_retail", "maff_old_overview"], ["Discontinued", "Survey redesign and expansion from 7 to 15 cities"]),
        ("maff_wholesale", "MAFF", "Fruit and vegetable wholesale market survey", "upstream_context",
         "daily/ten-day/monthly/annual", "Annual index 2003–2025 plus long-run tables; per-item earliest period not certified",
         "e-Stat API/files and ministry publications", "reviewed_catalog",
         "https://www.maff.go.jp/j/tokei/kouhyou/seika_orosi/", ["maff_wholesale"],
         ["Wholesale stage, not consumer cost", "Unit-value mix", "Revisions"]),
        ("tokyo_wholesale", "Tokyo Central Wholesale Market", "Market statistics", "upstream_context",
         "monthly/annual", "Online tables reach 2002; January 2026 structured detail inspected", "Public XLSX",
         "verified_download", "https://www.shijou.metro.tokyo.lg.jp/ja/torihiki/geppo", ["tokyo_market", "tokyo_wholesale_sample"],
         ["Wholesale stage", "Quantity/value aggregation", "Historical files republished"]),
        ("boj_cgpi", "Bank of Japan", "Corporate Goods Price Index", "upstream_benchmark",
         "monthly", "Verified polished-rice series starts January 2005; 2010–August 2026 subset retrieved",
         "Public JSON/CSV API", "verified_api", "https://www.stat-search.boj.or.jp/ssi/docs/info/nme_aphelp.html",
         ["boj_api_manual", "boj_cgpi_metadata", "boj_rice_data"], ["Producer/import index points, not retail yen", "Base changes"]),
        ("egov_catalog", "Digital Agency / e-Gov", "Data Portal metadata catalog", "discovery",
         "publisher-dependent", "No independent price history", "Public CKAN metadata API", "verified_api",
         "https://data.e-gov.go.jp/data/ja/api_guide", ["egov_search"],
         ["Metadata only", "Search relevance must be checked", "Bundled Python trust failure; system-trusted client succeeded"]),
    ]
    keys = ["source_id", "publisher", "title", "role", "frequency", "coverage_statement",
            "access", "evidence_status", "entry_url", "evidence_stems", "limitations"]
    sources = [dict(zip(keys, values)) for values in profiles]
    for source in sources:
        for stem in source["evidence_stems"]:
            receipt = read(stem + ".receipt.json")
            if receipt.get("status") != 200 or "error" in receipt:
                raise ValueError(f"Expected successful evidence: {stem}")
    save("source_registry.json", {"audit_date_jst": "2026-10-05", "credentials_used": False,
                                 "comparability_certified": False,
                                 "break_policy": "Separate segments; block unresolved basket comparisons",
                                 "sources": sources})

    observations = []
    city_names = {"札幌": "01100", "東京都区部": "13100", "横浜": "14100", "大阪": "27100", "那覇": "47201"}
    selected = {1001, 1303, 1341, 1401, 4413, 4441}
    for stem in ["rps_jan2010_city_a", "rps_jan2010_city_b", "rps_food_aug2026", "rps_household_aug2026"]:
        sheet = read(stem + ".extracted.json")["sheets"][0]
        header = next(r["values"] for r in sheet["nonempty_rows"] if r["row"] == 11)
        current = "aug2026" in stem
        if current:
            codes = next(r["values"] for r in sheet["nonempty_rows"] if r["row"] == 10)
            columns = [(i, str(code), header[i]) for i, code in enumerate(codes) if str(code) in city_names.values()]
        else:
            columns = [(i, city_names[name], name) for i, name in enumerate(header) if name in city_names]
        for row in sheet["nonempty_rows"]:
            values = row["values"]
            item = values[9] if current else values[7]
            if item not in selected:
                continue
            for col, area_code, area_name in columns:
                observations.append({"evidence_stem": stem, "sheet": sheet["name"], "row": row["row"],
                                     "column_1_based": col + 1, "period": "2026-08" if current else "2010-01",
                                     "source_item_code": str(int(item)), "source_item_name": values[10] if current else values[8],
                                     "source_unit": values[11] if current else values[9], "currency": "JPY",
                                     "area_code": area_code, "source_area_name": area_name, "value": values[col],
                                     "comparability_status": "not_certified"})
    save("sample_observations.json", {"audit_date_jst": "2026-10-05", "purpose": "Source verification; no cross-break change calculated",
                                      "legacy_area_codes": "Explicit crosswalk for five pilot areas; no roster-wide crosswalk implied",
                                      "observations": observations})
    print(json.dumps({"probes": len(manifest), "sources": len(sources), "sample_observations": len(observations)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
