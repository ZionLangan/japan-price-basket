"""Synthetic metadata tests protect exact food quantities; no public test prices."""

import copy
import json
import unittest
from pathlib import Path

from scripts.build_food_expansion_review import (
    BASE,
    build_product,
    current_product_updates,
    exact_quote,
    variants,
)
from scripts.review_recent_prices import specification_hash

ROOT = Path(__file__).resolve().parents[1]


def synthetic_snapshot(month="2000-01", unit="100g", definition="synthetic metadata only"):
    spec = {"name": "synthetic anpan", "definition": definition, "detail": "",
            "months": "", "unit": "100g"}
    return {"month": month, "prices": [{"code": "1022", "name": spec["name"], "unit": unit}],
            "specs": {"1022": spec}, "specSource": {"url": "https://example.invalid/synthetic-only"}}


class FoodExpansionReviewContracts(unittest.TestCase):
    def test_pack_ranges_remain_native_pack_forms(self):
        for code, period in [("1473", "2009-09"), ("1732", "2007-10"),
                             ("1782", "2000-01"), ("1784", "2000-01")]:
            selected = [meta for start, end, meta in variants(code) if start <= period <= end]
            self.assertEqual(len(selected), 1)
            self.assertEqual(selected[0]["unit"], "package")
            quote = exact_quote(code, period, {"unit": "1 pack"}, {"unit": "1 pack"}, "package")
            self.assertEqual(quote, "1")

    def test_package_shrinkage_uses_dated_exact_amounts(self):
        spec = {"unit": "1箱"}
        row = {"unit": "1箱"}
        self.assertEqual(exact_quote("1602", "2008-02", spec, row, "kg"), "0.45")
        self.assertEqual(exact_quote("1602", "2008-03", spec, row, "kg"), "0.4")
        self.assertEqual(exact_quote("1602", "2009-04", spec, row, "kg"), "0.32")
        self.assertEqual(exact_quote("1602", "2013-11", spec, row, "kg"), "0.3")
        self.assertEqual(exact_quote("1602", "2014-09", {"unit": "１ｋｇ"}, row, "kg"), "1")
        self.assertEqual(exact_quote("1782", "2014-06", {"unit": "1個"}, row, "L"), "0.12")
        self.assertEqual(exact_quote("1782", "2014-07", {"unit": "1個"}, row, "L"), "0.11")

    def test_physical_quote_overrides_permitted_package_weight_range(self):
        self.assertEqual(exact_quote("1921", "2014-03", {"unit": "１００ｇ"},
                                    {"unit": "100g"}, "kg"), "0.1")
        self.assertEqual(exact_quote("1784", "2019-11", {"unit": "１００ｇ"},
                                    {"unit": "100g"}, "kg"), "0.1")

    def test_real_product_replacements_have_disjoint_histories(self):
        for code in ["1051", "1463", "1732", "1781", "1811", "2011"]:
            chosen = variants(code)
            self.assertGreater(len(chosen), 1)
            for left, right in zip(chosen, chosen[1:]):
                self.assertLess(left[1], right[0])
                self.assertNotEqual(left[2]["id"], right[2]["id"])

    def test_quoted_servings_and_volume_are_exact_count_or_volume(self):
        self.assertEqual(exact_quote("1051", "2000-01", {"unit": "1袋"},
                                    {"unit": "1袋"}, "count"), "1")
        self.assertEqual(exact_quote("1051", "2001-01", {"unit": "1パック"},
                                    {"unit": "1パック"}, "count"), "5")
        self.assertEqual(exact_quote("2026", "2002-06", {"unit": "1缶"},
                                    {"unit": "1缶"}, "L"), "0.35")
        self.assertEqual(exact_quote("2026", "2002-07", {"unit": "1パック"},
                                    {"unit": "1パック"}, "L"), "2.1")

    def test_unknown_definition_or_changed_quote_unit_requires_review(self):
        snapshot = synthetic_snapshot()
        fingerprint = specification_hash(snapshot["specs"]["1022"])
        accepted_hashes = {"1022": {fingerprint}}
        accepted_units = {("1022", fingerprint): {"100g"}}
        product = build_product(BASE["1022"], [snapshot], "2000-01", "2000-01",
                                accepted_hashes, accepted_units)
        self.assertEqual(len(product["reviewedSpecifications"]), 1)
        self.assertEqual(product["missingPriceEstimate"],
                         {"maxMonths": 2, "tokens": ["-"], "allowEquivalentSegments": True})
        self.assertTrue(all(url.startswith("https://") for s in product["reviewedSpecifications"]
                            for url in s["continuityEvidence"]))
        changed = copy.deepcopy(snapshot)
        changed["specs"]["1022"]["definition"] = "unreviewed replacement"
        with self.assertRaisesRegex(ValueError, "Unreviewed future specification"):
            build_product(BASE["1022"], [changed], "2000-01", "2000-01", accepted_hashes, accepted_units)
        changed = copy.deepcopy(snapshot)
        changed["prices"][0]["unit"] = "1kg"
        with self.assertRaisesRegex(ValueError, "Unreviewed source quote unit"):
            build_product(BASE["1022"], [changed], "2000-01", "2000-01", accepted_hashes, accepted_units)

    def test_an_absent_price_row_has_no_fabricated_approval(self):
        earlier, later = synthetic_snapshot(), synthetic_snapshot("2005-01")
        earlier["prices"] = []
        product = build_product(BASE["1022"], [earlier, later], "2000-01", "2026-08")
        self.assertEqual(product["reviewedSpecifications"][0]["start"], "2005-01")
        self.assertFalse(product["reviewedSpecifications"][0]["continuityFromPrevious"])

    def test_existing_food_ids_and_egg_conversion_are_preserved(self):
        current = json.loads((ROOT / "data/catalog-review.json").read_text(encoding="utf-8"))
        updates = current_product_updates(current)
        old_food = [p for p in current["products"] if int(p["code"]) < 3000]
        self.assertEqual({p["id"] for p in updates}, {p["id"] for p in old_food})
        old_eggs = next(p for p in old_food if p["id"] == "mixed-size-eggs")
        new_eggs = next(p for p in updates if p["id"] == "mixed-size-eggs")
        self.assertEqual(old_eggs, new_eggs)
        for p in updates:
            self.assertEqual(p["missingPriceEstimate"],
                             {"maxMonths": 2, "tokens": ["-"], "allowEquivalentSegments": True})
            self.assertTrue(all(url.startswith("https://") for s in p["reviewedSpecifications"]
                                for url in s["continuityEvidence"]))
            if p["code"] != "1341":
                self.assertTrue(all(s["continuityFromPrevious"] for s in p["reviewedSpecifications"][1:]))


if __name__ == "__main__":
    unittest.main()
