"""Synthetic metadata protects retired ends and unresolved regional periods."""
import copy
import unittest

from scripts.build_remaining_food_review import AUDITED_END, build, quote
from scripts.build_retired_food_review import FALLBACKS, META, UNREVIEWED_SOURCE_PERIODS


def synthetic_retired_inputs():
    code = "1231"
    spec = {"name": "synthetic lamb", "definition": "synthetic test only", "unit": "100g",
            "detail": "", "months": ""}
    def snapshot(month, include_row=True, include_spec=True):
        return {"month": month, "prices": [{"code": code, "name": spec["name"], "unit": "100g"}]
                if include_row else [], "specs": {code: spec} if include_spec else {},
                "sources": [{"url": "https://example.invalid/synthetic-price"}],
                "specSource": {"url": "https://example.invalid/synthetic-spec"}}
    staging = {"snapshots": [snapshot("2000-01", include_spec=False), snapshot("2001-01"),
                              snapshot(AUDITED_END, include_row=False)]}
    current = {"products": []}
    first = {"products": [], "policy": "synthetic only", "reviewedMissingTokens": ["-"],
             "ownerAuthorization": "synthetic only", "notAdmitted": {}}
    meta = {code: {"code": code, "id": "synthetic-retired", "en": "Synthetic retired",
                   "ja": "合成テスト用", "unit": "kg", "aliases": []}}
    rule = {"code": code, "start": "2000-01", "end": "2000-01",
            "requireMissingBasicDefinition": True, "reason": "Synthetic unresolved local definition"}
    kwargs = {"meta": meta, "variants": {}, "expected_codes": set(meta), "unreviewed_periods": [rule]}
    return staging, current, first, kwargs


class RetiredFoodReviewContracts(unittest.TestCase):
    def test_all_retained_retired_codes_have_metadata_with_national_only_excluded(self):
        self.assertEqual(len(META), 56)
        self.assertTrue({"1231", "1592", "1731", "1762"} <= set(META))
        self.assertFalse({"1924", "1984"} & set(META))
        self.assertEqual(len(UNREVIEWED_SOURCE_PERIODS), 6)

    def test_retired_end_is_last_actual_admitted_row(self):
        staging, current, first, kwargs = synthetic_retired_inputs()
        review, _, unresolved = build(staging, current, first, initialize=True, **kwargs)
        self.assertEqual(unresolved, [])
        approvals = review["products"][0]["reviewedSpecifications"]
        self.assertEqual(approvals[0]["start"], "2001-01")
        self.assertEqual(approvals[-1]["end"], "2001-01")
        self.assertEqual(review["unreviewedSourcePeriods"], kwargs["unreviewed_periods"])

    def test_missing_definition_requires_explicit_bounded_rule(self):
        staging, current, first, kwargs = synthetic_retired_inputs()
        kwargs["unreviewed_periods"] = []
        with self.assertRaisesRegex(ValueError, "Missing dated basic definition"):
            build(staging, current, first, initialize=True, **kwargs)

    def test_unreviewed_rule_requires_actual_row_and_absent_basic_definition(self):
        staging, current, first, kwargs = synthetic_retired_inputs()
        changed = copy.deepcopy(staging)
        changed["snapshots"][0]["prices"] = []
        with self.assertRaisesRegex(ValueError, "Unreviewed-period evidence changed"):
            build(changed, current, first, initialize=True, **kwargs)
        changed = copy.deepcopy(staging)
        changed["snapshots"][0]["specs"] = changed["snapshots"][1]["specs"]
        with self.assertRaisesRegex(ValueError, "Unreviewed-period evidence changed"):
            build(changed, current, first, initialize=True, **kwargs)

    def test_unreviewed_period_change_requires_new_dated_review(self):
        staging, current, first, kwargs = synthetic_retired_inputs()
        review, _, _ = build(staging, current, first, initialize=True, **kwargs)
        changed_kwargs = {**kwargs, "unreviewed_periods": []}
        with self.assertRaisesRegex(ValueError, "allowlist changed"):
            build(staging, current, first, previous=review, **changed_kwargs)

    def test_retired_native_count_and_exact_definition_capacity(self):
        self.assertEqual(quote("1731", "2000-01", {"unit": "1箱"},
                               {"unit": "1箱・12pieces"}, "count")[0], "12")
        self.assertEqual(quote("1972", "2000-09", {"unit": "1本"},
                               {"unit": "1本・bottle"}, "L", FALLBACKS)[0], "0.065")
        self.assertEqual(quote("1972", "2008-01", {"unit": "1本"},
                               {"unit": "1本"}, "L", FALLBACKS)[0], "0.08")
        self.assertEqual(quote("1592", "2000-01", {"unit": "1缶"},
                               {"unit": "1缶・565,567g"}, "package")[0], "1")


if __name__ == "__main__":
    unittest.main()
