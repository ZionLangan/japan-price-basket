"""Synthetic metadata protects quantity assumptions and bounded food admission."""
import copy
import unittest

from scripts.build_remaining_food_review import (
    AUDITED_END, CONFLICT_CAPACITIES, META, VARIANTS, build, quote,
)
from scripts.review_recent_prices import conversion_hash


def synthetic_inputs(code="1331", unit="(1箱・200g)", spec_unit="1箱"):
    def snapshot(month):
        spec = {"name": "synthetic cheese", "definition": "synthetic 225g package",
                "detail": "", "months": "", "unit": spec_unit}
        return {"month": month, "prices": [{"code": code, "name": spec["name"], "unit": unit}],
                "specs": {code: spec}, "sources": [{"url": "https://example.invalid/synthetic-price"}],
                "specSource": {"url": "https://example.invalid/synthetic-spec"}}
    staging = {"snapshots": [snapshot("2000-01"), snapshot("2000-02"), snapshot(AUDITED_END)]}
    current = {"products": []}
    first = {"products": [], "policy": "synthetic only", "reviewedMissingTokens": ["-"],
             "ownerAuthorization": "synthetic only", "notAdmitted": {}}
    meta = {code: {"code": code, "id": "synthetic-cheese", "en": "Synthetic cheese",
                   "ja": "合成テスト用チーズ", "unit": "kg", "aliases": []}}
    return staging, current, first, meta


class RemainingFoodReviewContracts(unittest.TestCase):
    def test_exact_mass_and_multipack_headers(self):
        self.assertEqual(quote("1952", "2020-01", {"unit": "1パック"},
                               {"unit": "1パック・350mL×6"}, "L")[0], "2.1")
        self.assertEqual(quote("1654", "2000-01", {"unit": "1箱"},
                               {"unit": "1箱・50g×3pouches"}, "kg")[0], "0.15")
        self.assertEqual(quote("1654", "2010-01", {"unit": "1箱"},
                               {"unit": "1箱・40g袋×3"}, "kg")[0], "0.12")
        self.assertEqual(quote("9998", "2020-01", {"unit": "1箱"},
                               {"unit": "1箱・14袋×16g"}, "kg")[0], "0.224")
        with self.assertRaisesRegex(ValueError, "Unreviewed multiplication"):
            quote("1654", "2010-01", {"unit": "1箱"}, {"unit": "1箱・40g袋×3×2"}, "kg")
        self.assertEqual(quote("1331", "2014-02", {"unit": "１００ｇ"},
                               {"unit": "100g,7枚・126g又は8枚・144g"}, "kg")[0], "0.1")

    def test_dry_soup_uses_dated_explicit_grams_when_header_only_counts_pouches(self):
        spec, row = {"unit": "1箱"}, {"unit": "1箱・4pouches"}
        expected = {"2000-01": "0.068", "2000-07": "0.0696", "2003-01": "0.08",
                    "2005-01": "0.076", "2006-10": "0.0784"}
        for month, quantity in expected.items():
            self.assertEqual(quote("1653", month, spec, row, "kg")[0], quantity)

    def test_corn_uses_drained_solid_weight_across_reporting_unit_change(self):
        spec, row = {"unit": "1缶"}, {"unit": "1缶・435g"}
        for month, quantity in {"2000-01": "0.275", "2002-07": "0.145", "2004-01": "0.13"}.items():
            self.assertEqual(quote("1491", month, spec, row, "kg")[0], quantity)
        self.assertEqual(quote("1491", "2014-09", {"unit": "１ｋｇ"}, {"unit": "1kg"}, "kg")[0], "1")

    def test_known_caption_conflicts_follow_dated_definition(self):
        cases = [("1331", "2000-01", "0.225"), ("1331", "2005-05", "0.18"),
                 ("2042", "2006-12", "0.75"), ("1011", "2002-01", "1")]
        for code, month, expected in cases:
            self.assertEqual(quote(code, month, {"unit": "1pack"}, {"unit": "1pack"},
                                   "L" if code == "2042" else "kg")[0], expected)

    def test_conflict_assumption_is_estimated_and_has_review_hash(self):
        staging, current, first, meta = synthetic_inputs()
        review, _, unresolved = build(staging, current, first, initialize=True, meta=meta,
                                       variants={}, expected_codes=set(meta))
        self.assertEqual(unresolved, [])
        approval = review["products"][0]["reviewedSpecifications"][0]
        conversion = approval["quantityConversion"]
        self.assertTrue(conversion["estimated"])
        self.assertEqual(conversion["factor"], "1")
        self.assertEqual(conversion["from"], conversion["to"])
        self.assertEqual(approval["quantityConversionHash"], conversion_hash(conversion))
        self.assertEqual(approval["sourceUnits"], ["(1箱・200g)"])

    def test_ranges_are_native_packages_and_unknown_mass_is_rejected(self):
        self.assertEqual(quote("1785", "2025-01", {"unit": "1袋"},
                               {"unit": "1袋・54～56g"}, "package")[0], "1")
        with self.assertRaisesRegex(ValueError, "Unresolved quote"):
            quote("1785", "2025-01", {"unit": "1袋"}, {"unit": "1袋・54～56g"}, "kg")

    def test_count_quotations_do_not_pretend_weight_is_constant(self):
        for month, expected in {"2002-06": "1", "2002-07": "3", "2010-11": "1"}.items():
            self.assertEqual(quote("1714", month, {"unit": "1cup"}, {"unit": "1cup"}, "count")[0], expected)
        for month, expected in {"2013-06": "25", "2013-07": "1", "2014-01": "10"}.items():
            self.assertEqual(quote("1911", month, {"unit": "1box"}, {"unit": "1box"}, "count")[0], expected)

    def test_new_definition_or_quote_unit_requires_review(self):
        staging, current, first, meta = synthetic_inputs()
        review, _, _ = build(staging, current, first, initialize=True, meta=meta, variants={},
                             expected_codes=set(meta))
        changed = copy.deepcopy(staging)
        changed["snapshots"][1]["specs"]["1331"]["definition"] = "unreviewed replacement"
        with self.assertRaisesRegex(ValueError, "Unreviewed specification"):
            build(changed, current, first, previous=review, meta=meta, variants={}, expected_codes=set(meta))
        changed = copy.deepcopy(staging)
        changed["snapshots"][1]["prices"][0]["unit"] = "unreviewed quote"
        with self.assertRaisesRegex(ValueError, "Unreviewed native quote unit"):
            build(changed, current, first, previous=review, meta=meta, variants={}, expected_codes=set(meta))

    def test_initialization_and_source_cutoff_are_explicit(self):
        staging, current, first, meta = synthetic_inputs()
        with self.assertRaisesRegex(ValueError, "requires --initialize"):
            build(staging, current, first, meta=meta, variants={}, expected_codes=set(meta))
        staging["snapshots"][-1]["month"] = "2026-09"
        with self.assertRaisesRegex(ValueError, "changed source cutoff"):
            build(staging, current, first, initialize=True, meta=meta, variants={}, expected_codes=set(meta))

    def test_reintroduced_form_does_not_bridge_an_inactive_period(self):
        staging, current, first, meta = synthetic_inputs()
        staging["snapshots"][1]["prices"] = []
        review, _, _ = build(staging, current, first, initialize=True, meta=meta, variants={},
                             expected_codes=set(meta))
        approvals = review["products"][0]["reviewedSpecifications"]
        self.assertEqual(len(approvals), 2)
        self.assertFalse(approvals[-1]["continuityFromPrevious"])

    def test_catalog_is_bounded_and_form_changes_have_separate_ids(self):
        self.assertEqual(len(META), 132)
        for code in ["1052", "1462", "1796", "1799", "1891", "1941"]:
            self.assertGreater(len({slug for _, _, slug, _ in VARIANTS[code]}), 1)
        self.assertEqual(set(CONFLICT_CAPACITIES), {"1011", "1331", "2042"})


if __name__ == "__main__":
    unittest.main()
