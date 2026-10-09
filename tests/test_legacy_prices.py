"""Original retained evidence and explicit synthetic sheets verify legacy prices."""

import unittest
from pathlib import Path

from scripts.import_recent_prices import REVIEW_CODES, discover_price_sources, read_prices
from scripts.legacy_geography import resolve_legacy_city
from scripts.legacy_prices import parse_printed, parse_wide, read_legacy_prices

ROOT = Path(__file__).resolve().parents[1]


class SyntheticSheet:
    """A calculation-only in-memory sheet; never part of published observations."""
    name = "synthetic-only"

    def __init__(self, rows):
        self.rows = rows
        self.nrows = len(rows)
        self.ncols = len(rows[0])

    def row_values(self, index):
        return self.rows[index]


def synthetic_wide(numbers=(1, 2), period="平成22年１月"):
    return SyntheticSheet([
        ["", "", "", "", "", "", "", ""],
        ["", "", "銘柄符号", "", "", "銘柄改正年月", *numbers],
        ["", "", "Specification NO.", "品目", "単位", "", "札幌", "東京都区部"],
        ["", "", "", period, "", "", "", ""],
        ["", "", 1021.0, "Synthetic bread", "1kg", "H21.11", 100.25, "Y"],
    ])


def synthetic_printed(city_numbers=(1, 2)):
    return SyntheticSheet([
        ["", "(1341)", "(1303)"],
        ["", "Synthetic eggs", "Synthetic milk"],
        ["都市", "(1パック)", "(1本･"],
        ["", "(1pack･", "1000mL)"],
        ["", "10 pieces)", ""],
        ["Cities", "Eggs", "Milk"],
        ["", "平成14年７月", ""],
        [f"{city_numbers[0]} 札幌", 100.0, "..."],
        [f"{city_numbers[1]} 東京都区部", 200.0, 300.0],
    ])


class OriginalPrintedPrices(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.food_bytes = (ROOT / "data/audit/2026-10-05/rps_jan2000_city_a.xls").read_bytes()
        cls.cities, cls.food = read_legacy_prices(cls.food_bytes, "2000-01", REVIEW_CODES)
        _, cls.household = read_legacy_prices(
            (ROOT / "data/audit/2026-10-05/rps_jan2000_city_b.xls").read_bytes(), "2000-01", REVIEW_CODES)

    def test_all_original_city_rows_and_twenty_catalog_codes_are_accounted_for(self):
        self.assertEqual(len(self.cities), 71)
        self.assertEqual(len({city["rawLabel"] for city in self.cities}), 71)
        self.assertEqual({row["code"] for row in self.food + self.household}, REVIEW_CODES)

    def test_price_cell_locators_differ_from_the_printed_header(self):
        rice = next(row for row in self.food if row["code"] == "1001")
        milk = next(row for row in self.food if row["code"] == "1303")
        self.assertEqual(rice["unit"], "(10kg)")
        self.assertEqual(rice["values"]["東京都区部"], 5922)
        self.assertEqual(rice["locations"]["東京都区部"], {"row": 39, "column": 9})
        self.assertEqual(milk["unit"], "(1本･1000ml)")
        self.assertEqual(milk["values"]["東京都区部"], 210)
        self.assertEqual(milk["locations"]["東京都区部"], {"row": 598, "column": 16})
        self.assertEqual(milk["unitLocations"], [{"row": 571, "column": 16}, {"row": 572, "column": 16}])

    def test_original_missing_token_and_powder_package_are_not_rewritten(self):
        cherries = next(row for row in self.food if row["code"] == "1572")
        laundry = next(row for row in self.household if row["code"] == "4441")
        self.assertEqual(cherries["values"]["東京都区部"], "..")
        self.assertEqual(laundry["unit"], "(1箱･1.2kg)")
        self.assertEqual(laundry["values"]["東京都区部"], 454)
        self.assertNotIn("status", cherries)

    def test_wrong_month_is_rejected_instead_of_becoming_an_observation(self):
        with self.assertRaisesRegex(ValueError, "Unexpected workbook period"):
            read_legacy_prices(self.food_bytes, "2000-02", REVIEW_CODES)

    def test_dated_geography_does_not_relabel_urawa_as_saitama(self):
        cities, rows = read_prices(self.food_bytes, "2000-01", resolve_legacy_city)
        self.assertIn("11204", {city["id"] for city in cities})
        self.assertNotIn("11100", {city["id"] for city in cities})
        rice = next(row for row in rows if row["code"] == "1001")
        self.assertEqual(rice["values"]["11204"], 6112)
        self.assertEqual(rice["locations"]["13100"], {"row": 39, "column": 9})


class LegacyHeaderSafeguards(unittest.TestCase):
    def test_catalog_nested_rice_quotes_and_moving_file_parts_are_resolved(self):
        # Catalog titles reproduce real January 2002 / March 2013 syntax;
        # these synthetic HTML records contain no public observations.
        html = '''<article>主要品目の都市別小売価格
        「1001うるち米(単一原料米, 「コシヒカリ」)」～「4401ラップ」
        <a href="/stat-search/file-download?statInfId=food&amp;fileKind=0">EXCEL</a></article>
        <article>主要品目の都市別小売価格 「4412用品」～「9921保育所保育料」
        <a href="/stat-search/file-download?statInfId=household&amp;fileKind=0">EXCEL</a>
        <a href="/stat-search/file-download?statInfId=household&amp;fileKind=4">EXCEL 閲覧用</a></article>
        <article>主要品目の東京都区部小売価格 「1001米」～「9921保育料」
        <a href="/stat-search/file-download?statInfId=tokyo&amp;fileKind=0">EXCEL</a></article>'''
        sources = discover_price_sources(html.encode("utf-8"), "2013-03")
        self.assertIn("statInfId=food&", sources["food"]["url"])
        self.assertIn("statInfId=household&", sources["household"]["url"])
        self.assertEqual(sources["food"]["lastCode"], "4401")

    def test_wide_headers_preserve_alignment_decimal_values_revisions_and_tokens(self):
        cities, rows = parse_wide(synthetic_wide(), "2010-01", {"1021"})
        self.assertEqual([city["rawLabel"] for city in cities], ["札幌", "東京都区部"])
        self.assertEqual(rows[0]["values"], {"札幌": 100.25, "東京都区部": "Y"})
        self.assertEqual(rows[0]["revision"], "H21.11")
        self.assertEqual(rows[0]["locations"]["東京都区部"], {"row": 5, "column": 8})

    def test_missing_wide_city_column_is_an_import_error(self):
        with self.assertRaisesRegex(ValueError, "city-number sequence"):
            parse_wide(synthetic_wide(numbers=(1, 3)), "2010-01", {"1021"})

    def test_text_city_ordinals_do_not_discard_actual_columns(self):
        cities, rows = parse_wide(synthetic_wide(numbers=(1.0, "2")), "2010-01", {"1021"})
        self.assertEqual(len(cities), 2)
        self.assertEqual(rows[0]["values"]["東京都区部"], "Y")

    def test_printed_bilingual_quantity_headers_remain_separate_evidence(self):
        _, rows = parse_printed(synthetic_printed(), "2002-07", {"1341", "1303"})
        eggs = next(row for row in rows if row["code"] == "1341")
        milk = next(row for row in rows if row["code"] == "1303")
        self.assertEqual(eggs["unit"], "(1パック)")
        self.assertEqual(eggs["alternateUnitHeaders"][0]["text"], "(1pack･10 pieces)")
        self.assertEqual(milk["unit"], "(1本･1000mL)")
        self.assertEqual(milk["values"]["札幌"], "...")

    def test_missing_printed_city_row_cannot_be_filled_with_another_city(self):
        with self.assertRaisesRegex(ValueError, "city-number sequence"):
            parse_printed(synthetic_printed(city_numbers=(1, 3)), "2002-07", {"1341", "1303"})

    def test_partial_print_page_uses_the_city_header_not_first_product_position(self):
        original = synthetic_printed()
        shifted = SyntheticSheet([row[:1] + [""] + row[1:] for row in original.rows])
        cities, rows = parse_printed(shifted, "2002-07", {"1341", "1303"})
        self.assertEqual(len(cities), 2)
        eggs = next(row for row in rows if row["code"] == "1341")
        self.assertEqual(eggs["values"]["東京都区部"], 200)
        self.assertEqual(eggs["locations"]["東京都区部"], {"row": 9, "column": 3})


if __name__ == "__main__":
    unittest.main()
