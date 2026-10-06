"""Synthetic workbooks test ingestion failures; no synthetic prices are published."""

import io
import unittest

import openpyxl

from scripts.import_recent_prices import read_prices


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


if __name__ == "__main__":
    unittest.main()
