"""Synthetic-only safeguards for omitted city table acquisition.

These in-memory sheets are parser fixtures, never observed public prices.
The operator audit separately dereferences every downloaded native cell.
"""

import hashlib
import tempfile
import unittest
from pathlib import Path

from scripts.acquire_supplementary_food import (
    FOOD_CODES,
    FoodSheetPrefix,
    discover_supplementary_sources,
    evidence,
)
from scripts.legacy_prices import parse_printed
from scripts.acquire_early_tokyo_food import read_tokyo_food
from scripts.stage_supplementary_food import merge_snapshot

ROOT = Path(__file__).resolve().parents[1]
TEMP_ROOT = ROOT / "tmp"


class SyntheticSheet:
    name = "synthetic-only"

    def __init__(self, rows):
        self.rows = rows
        self.nrows = len(rows)

    def row_values(self, index):
        return self.rows[index]


def block(code="1491", period="平成17年１月", cities=(1, 2)):
    return [["", f"({code})"], ["", "Synthetic canned food"],
            ["都市", "(1缶･190g)"], ["Cities", "Canned food"],
            ["", period], [f"{cities[0]} 札幌", "..."],
            [f"{cities[1]} 東京都区部", 123.0]]


class SupplementaryFoodReader(unittest.TestCase):
    def test_food_prefix_excludes_repeated_unrelated_numeric_code_blocks(self):
        # Numeric negative item headers reproduce Excel parenthesis formatting
        # seen in unrelated later non-food blocks, not negative food prices.
        sheet = SyntheticSheet(block() + [["", -4072.0], ["", "Synthetic appliance"],
                                          ["都市", "(1台)"], ["Cities", "Appliance"],
                                          ["", "平成17年１月"], ["1 札幌", 10.0],
                                          ["2 東京都区部", 20.0]])
        prefix = FoodSheetPrefix(sheet)
        cities, rows = parse_printed(prefix, "2005-01", FOOD_CODES)
        self.assertEqual(prefix.nrows, 7)
        self.assertEqual(len(cities), 2)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["unit"], "(1缶･190g)")
        self.assertEqual(rows[0]["values"], {"札幌": "...", "東京都区部": 123.0})
        self.assertEqual(rows[0]["locations"]["東京都区部"], {"row": 7, "column": 2})

    def test_later_food_block_is_rejected_rather_than_silently_discarded(self):
        sheet = SyntheticSheet(block() + block("3015") + block("1781"))
        with self.assertRaisesRegex(ValueError, "Food code appears after non-food boundary"):
            FoodSheetPrefix(sheet)

    def test_source_period_and_city_sequence_remain_required(self):
        with self.assertRaisesRegex(ValueError, "Unexpected workbook period"):
            parse_printed(FoodSheetPrefix(SyntheticSheet(block())), "2005-02", FOOD_CODES)
        with self.assertRaisesRegex(ValueError, "city-number sequence"):
            parse_printed(FoodSheetPrefix(SyntheticSheet(block(cities=(1, 3)))), "2005-01", FOOD_CODES)

    def test_non_food_only_source_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "no food item blocks"):
            FoodSheetPrefix(SyntheticSheet(block("3015")))

    def test_negative_city_price_stays_a_raw_value_instead_of_an_item_header(self):
        sheet = SyntheticSheet(block())
        sheet.rows[-1][1] = -1234.0
        _, rows = parse_printed(FoodSheetPrefix(sheet), "2005-01", FOOD_CODES)
        self.assertEqual(rows[0]["values"]["東京都区部"], -1234.0)


class SupplementaryDiscovery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        TEMP_ROOT.mkdir(exist_ok=True)

    def make_manifest(self, folder, articles):
        data = articles.encode("utf-8")
        digest = hashlib.sha256(data).hexdigest()
        (folder / digest).write_bytes(data)
        return {"months": [{"month": "2005-01", "listing": {
            "url": "https://www.e-stat.go.jp/synthetic-only", "sha256": digest,
            "bytes": len(data)}, "specSource": {}, "cityIds": ["01100", "13100"]}]}

    def test_only_supplementary_all_city_article_is_selected(self):
        html = '''<article>主要品目の都市別小売価格 月報非掲載表
          <a href="/stat-search/file-download?statInfId=city&amp;fileKind=0">EXCEL</a></article>
          <article>その他の品目の東京都区部小売価格 月報非掲載表
          <a href="/stat-search/file-download?statInfId=tokyo&amp;fileKind=0">EXCEL</a></article>'''
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as temporary:
            folder = Path(temporary)
            sources = discover_supplementary_sources(self.make_manifest(folder, html), folder)
        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]["url"],
                         "https://www.e-stat.go.jp/stat-search/file-download?statInfId=city&fileKind=0")

    def test_ambiguous_supplementary_articles_are_rejected(self):
        article = '''<article>主要品目の都市別小売価格 月報非掲載表
          <a href="/stat-search/file-download?statInfId=city&amp;fileKind=0">EXCEL</a></article>'''
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as temporary:
            folder = Path(temporary)
            with self.assertRaisesRegex(ValueError, "Ambiguous supplementary"):
                discover_supplementary_sources(self.make_manifest(folder, article * 2), folder)

    def test_cached_source_bytes_are_verified(self):
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as temporary:
            folder = Path(temporary)
            digest = hashlib.sha256(b"original synthetic evidence").hexdigest()
            (folder / digest).write_bytes(b"edited synthetic evidence")
            with self.assertRaisesRegex(ValueError, "checksum failure"):
                evidence({"url": "synthetic-only", "sha256": digest, "bytes": 27}, folder)


def tokyo_sheet(spacer=False):
    rows = [[""] * (15 if spacer else 14) for _ in range(19)]
    rows[3][9] = "第３表 その他の品目の東京都区部小売価格"
    rows[7][7] = "銘柄符号"
    unit_column = 11 if spacer else 10
    rows[7][unit_column] = "単    位"
    rows[11][unit_column + 1:unit_column + 4] = ["平成12年２月", "平成12年１月", "平成11年２月"]
    rows[17][7:10] = ["1781", "Synthetic gum", "Gum"]
    rows[17][unit_column:unit_column + 4] = ["1個･9sticks", 98.0, 97.0, "..."]
    return SyntheticSheet(rows)


class EarlyTokyoReader(unittest.TestCase):
    def test_explicit_prior_month_column_preserves_tokyo_scope_and_original_address(self):
        rows = read_tokyo_food(tokyo_sheet(), "2000-01", "2000-02")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["values"], {"13100": 97.0})
        self.assertEqual(rows[0]["locations"], {"13100": {"row": 18, "column": 13}})
        self.assertEqual(rows[0]["periodLocation"], {"row": 12, "column": 13})
        self.assertEqual(rows[0]["unit"], "1個･9sticks")

    def test_blank_spacer_layout_retains_shifted_original_column(self):
        rows = read_tokyo_food(tokyo_sheet(spacer=True), "2000-02", "2000-02")
        self.assertEqual(rows[0]["locations"], {"13100": {"row": 18, "column": 13}})
        sheet = tokyo_sheet(spacer=True)
        sheet.rows[17][10] = "Unreviewed detail"
        with self.assertRaisesRegex(ValueError, "populated Tokyo header spacer"):
            read_tokyo_food(sheet, "2000-02", "2000-02")

    def test_scope_and_explicit_month_are_required(self):
        sheet = tokyo_sheet()
        sheet.rows[3][9] = "Synthetic nationwide prices"
        with self.assertRaisesRegex(ValueError, "Tokyo other-item scope"):
            read_tokyo_food(sheet, "2000-01", "2000-02")
        with self.assertRaisesRegex(ValueError, "No unique explicit Tokyo observation column"):
            read_tokyo_food(tokyo_sheet(), "2000-03", "2000-02")

    def test_duplicate_food_code_is_rejected(self):
        sheet = tokyo_sheet()
        sheet.rows[18] = sheet.rows[17][:]
        with self.assertRaisesRegex(ValueError, "Duplicate Tokyo food row"):
            read_tokyo_food(sheet, "2000-01", "2000-02")


def merge_records():
    target = {"month": "2000-01", "cities": [{"id": "01100"}, {"id": "13100"}],
              "specSource": {"sha256": "synthetic-spec"}, "sources": [{"id": "primary"}],
              "prices": [{"code": "1001"}], "specs": {"1001": {"unit": "10kg"}}}
    addition = {"month": "2000-01", "cities": [{"id": "13100"}],
                "specSource": {"sha256": "synthetic-spec"}, "sources": [{"id": "tokyo-only"}],
                "prices": [{"code": "1781", "sourceId": "tokyo-only", "values": {"13100": 98.0},
                            "locations": {"13100": {"row": 18, "column": 13}}}],
                "specs": {"1781": {"unit": "1個"}}}
    return target, addition


class SupplementaryMerge(unittest.TestCase):
    def test_tokyo_only_price_never_becomes_another_city_value(self):
        target, addition = merge_records()
        merge_snapshot(target, addition)
        self.assertEqual(target["prices"][-1]["values"], {"13100": 98.0})
        self.assertEqual(target["prices"][-1]["locations"], {"13100": {"row": 18, "column": 13}})
        self.assertEqual(len(target["cities"]), 2)

    def test_duplicate_month_code_is_rejected_instead_of_overwritten(self):
        target, addition = merge_records()
        addition["prices"][0]["code"] = "1001"
        with self.assertRaisesRegex(ValueError, "code/month conflict"):
            merge_snapshot(target, addition)
        self.assertEqual(len(target["prices"]), 1)

    def test_missing_locator_or_unpublished_city_is_rejected(self):
        target, addition = merge_records()
        addition["prices"][0]["locations"] = {}
        with self.assertRaisesRegex(ValueError, "original cell locator"):
            merge_snapshot(target, addition)
        target, addition = merge_records()
        addition["cities"] = [{"id": "99999"}]
        with self.assertRaisesRegex(ValueError, "geography outside actual monthly roster"):
            merge_snapshot(target, addition)

    def test_dated_specification_conflict_is_rejected(self):
        target, addition = merge_records()
        target["specs"]["1781"] = {"unit": "Other synthetic quote"}
        with self.assertRaisesRegex(ValueError, "Dated specification conflict"):
            merge_snapshot(target, addition)


if __name__ == "__main__":
    unittest.main()
