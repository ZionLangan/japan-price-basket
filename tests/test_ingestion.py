"""Synthetic workbooks test ingestion failures; no synthetic prices are published."""

import io
import json
import unittest
from pathlib import Path

import openpyxl

from scripts.import_recent_prices import read_prices, read_specs
from scripts.review_recent_prices import review_identity

ROOT = Path(__file__).resolve().parents[1]


def synthetic_workbook(month="2026年8月", city_count=81):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "synthetic-only"
    codes, labels, prices = [None] * 97, [None] * 97, [None] * 97
    codes[14] = "地域コード"
    labels[8:12] = ["時間軸（月）", "銘柄符号", "品目", "単位"]
    for i in range(city_count):
        codes[15 + i] = f"{i + 1:05}"
        labels[15 + i] = f"Synthetic city {i + 1}"
        prices[15 + i] = 100 + i
    prices[8:12] = [month, "1021", "Synthetic bread", "1kg"]
    for row in [codes, labels, prices]:
        sheet.append(row)
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


class WideWorkbookContract(unittest.TestCase):
    def test_city_code_mapping_preserves_column_alignment_and_provenance(self):
        cities, rows = read_prices(synthetic_workbook(), "2026-08")
        self.assertEqual(len(cities), 81)
        self.assertEqual(rows[0]["values"]["00081"], 180)
        self.assertEqual(rows[0]["row"], 3)
        self.assertEqual(rows[0]["sheet"], "synthetic-only")

    def test_wrong_period_is_an_error_not_a_missing_month(self):
        with self.assertRaisesRegex(ValueError, "Unexpected period"):
            read_prices(synthetic_workbook(month="2026年7月"), "2026-08")

    def test_roster_loss_is_an_error_not_false_price_coverage(self):
        with self.assertRaisesRegex(ValueError, "Unreviewed city roster"):
            read_prices(synthetic_workbook(city_count=80), "2026-08")

    def test_original_city_layout_is_quarantined_not_an_empty_month(self):
        raw = (ROOT / "data/audit/2026-10-05/rps_jan2000_city_a.xls").read_bytes()
        with self.assertRaisesRegex(ValueError, "city-code/layout review required"):
            read_prices(raw, "2000-01")


class SpecificationContract(unittest.TestCase):
    def test_original_xls_retains_numeric_codes_old_units_and_powder_form(self):
        raw = (ROOT / "data/audit/2026-10-05/rps_specs_2000.xls").read_bytes()
        specifications = read_specs(raw)
        self.assertEqual(specifications["1001"]["unit"], "10kg")
        self.assertEqual(specifications["1341"]["unit"], "1kg")
        self.assertIn("高密度粉末", specifications["4441"]["definition"])
        self.assertEqual(specifications["1511"]["unit"], "1kg")

    def test_duplicate_specification_is_rejected(self):
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.append(["符号", "品名", "銘柄", "細部指定", "調査月", "単位"])
        for _ in range(2):
            sheet.append([1021, "Synthetic bread", "Synthetic only", "", "", "1kg"])
        output = io.BytesIO()
        workbook.save(output)
        workbook.close()
        with self.assertRaisesRegex(ValueError, "Duplicate specification code"):
            read_specs(output.getvalue())

    def test_unknown_format_is_not_admitted(self):
        with self.assertRaisesRegex(ValueError, "Unsupported specification workbook format"):
            read_specs(b"<html>Upstream error</html>")

    def test_milk_alias_is_only_admitted_within_its_reviewed_dates(self):
        review = json.loads((ROOT / "data/catalog-review.json").read_text(encoding="utf-8"))
        mapping = next(p for p in review["products"] if p["id"] == "carton-milk")
        row = {"name": "牛乳(店頭売り, 紙容器入り)"}
        spec = {"name": "牛乳", "definition": "牛乳，店頭売り，紙容器入り（１，０００ｍＬ入り）"}
        review_identity(mapping, row, spec, "2021-12")
        with self.assertRaisesRegex(ValueError, "Name mismatch"):
            review_identity(mapping, row, spec, "2022-01")

    def test_old_powder_cannot_reuse_liquid_laundry_variant(self):
        review = json.loads((ROOT / "data/catalog-review.json").read_text(encoding="utf-8"))
        mapping = next(p for p in review["products"] if p["id"] == "liquid-laundry-detergent")
        spec = read_specs((ROOT / "data/audit/2026-10-05/rps_specs_2000.xls").read_bytes())["4441"]
        with self.assertRaisesRegex(ValueError, "Unreviewed product form"):
            review_identity(mapping, {"name": spec["name"]}, spec, "2000-01")


if __name__ == "__main__":
    unittest.main()
