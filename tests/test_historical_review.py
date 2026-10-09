"""Synthetic publication fixtures verify review boundaries; never public prices."""
import copy
import hashlib
import unittest
from unittest.mock import patch

from scripts.review_recent_prices import (
    make_fixture,
    specification_hash,
    survey_months,
    validate_reviewed_specification,
)

SYNTHETIC_BYTES = b"SYNTHETIC TEST EVIDENCE ONLY"


def approval(spec, month, unit, quantity, source_unit):
    return {
        "start": month, "end": month, "specificationHash": specification_hash(spec),
        "quoteUnit": unit, "quoteQuantity": quantity,
        "quoteLabel": {"en": "Synthetic quote", "ja": "合成テスト用"},
        "sourceUnits": [source_unit], "surveyMonths": survey_months(spec),
        "continuityFromPrevious": False, "continuityReason": "Synthetic variant boundary",
        "continuityEvidence": ["https://example.invalid/synthetic-only"],
    }


class HistoricalReviewContracts(unittest.TestCase):
    def test_calendar_comes_from_explicit_months_not_a_missing_token(self):
        self.assertEqual(survey_months({"months": "１月～３月，\n９月～１２月"}), [1, 2, 3, 9, 10, 11, 12])
        self.assertEqual(survey_months({"months": "6月～7月"}), [6, 7])
        self.assertEqual(survey_months({"months": ""}), list(range(1, 13)))
        for text in ["off-season", "7月～6月", "13月", "6月～7月（変更予定）"]:
            with self.assertRaises(ValueError):
                survey_months({"months": text})

    def test_changed_form_or_quantity_cannot_reuse_an_existing_approval(self):
        spec = {"name": "Synthetic eggs", "definition": "Synthetic large eggs", "detail": "", "unit": "10 eggs", "months": ""}
        mapping = {"id": "synthetic-eggs", "unit": "count", "reviewedSpecifications": [approval(spec, "2020-12", "count", "10", "10 eggs")]}
        validate_reviewed_specification(mapping, {"unit": "10 eggs"}, spec, "2020-12")
        with self.assertRaisesRegex(ValueError, "Unreviewed specification"):
            validate_reviewed_specification(mapping, {"unit": "10 eggs"}, {**spec, "definition": "Synthetic mixed eggs"}, "2020-12")
        with self.assertRaisesRegex(ValueError, "Unreviewed quote unit"):
            validate_reviewed_specification(mapping, {"unit": "1 kg"}, spec, "2020-12")
        with self.assertRaisesRegex(ValueError, "Inactive or unreviewed variant"):
            validate_reviewed_specification(mapping, {"unit": "10 eggs"}, spec, "2021-01")

    def test_quantity_dimension_and_continuity_evidence_are_required(self):
        spec = {"name": "Synthetic powder", "definition": "Synthetic 1.2 kg box", "detail": "", "unit": "1 box", "months": ""}
        base = {"id": "synthetic-powder", "unit": "kg", "reviewedSpecifications": [approval(spec, "2020-12", "kg", "1.2", "1 box")]}
        for change, error in [
            ({"quoteUnit": "L"}, "Incompatible quote dimension"),
            ({"quoteQuantity": "0"}, "Invalid reviewed quantity"),
            ({"continuityFromPrevious": True, "continuityEvidence": []}, "Unevidenced continuity"),
        ]:
            mapping = copy.deepcopy(base)
            mapping["reviewedSpecifications"][0].update(change)
            with self.assertRaisesRegex(ValueError, error):
                validate_reviewed_specification(mapping, {"unit": "1 box"}, spec, "2020-12")

    def staging(self):
        payload = SYNTHETIC_BYTES
        digest = hashlib.sha256(payload).hexdigest()
        cities = [
            {"id": "00001-pre202101", "ja": "合成旧都市", "en": "Synthetic old scope", "historical": True},
            {"id": "00001", "ja": "合成新都市", "en": "Synthetic new scope", "historical": False},
        ]
        products, snapshots = [], []
        for i, (month, unit, quantity, id_) in enumerate([
            ("2020-12", "kg", "1", "synthetic-eggs-weight"),
            ("2021-01", "count", "10", "synthetic-eggs-count"),
        ]):
            source_unit = "1 kg" if unit == "kg" else "10 eggs"
            spec = {"name": "Synthetic eggs", "definition": "Synthetic-only " + unit, "detail": "", "unit": source_unit, "months": ""}
            products.append({
                "id": id_, "code": "1341", "en": id_, "unit": unit, "aliases": [],
                "presets": ["1"], "reviewedSpecifications": [approval(spec, month, unit, quantity, source_unit)],
            })
            info = {"url": "https://example.invalid/synthetic-only", "sha256": digest,
                    "retrievedAt": "2026-10-10T00:00:00Z", "bytes": len(payload)}
            snapshot = {
                "month": month, "cities": [cities[i]], "specSource": info,
                "sources": [{**info, "id": month + "-synthetic", "category": "food"}],
                "specs": {"1341": spec},
                "prices": [{"code": "1341", "name": "Synthetic eggs", "unit": source_unit,
                            "revision": None, "sheet": "synthetic-only", "row": 5,
                            "sourceId": month + "-synthetic", "values": {cities[i]["id"]: 123},
                            "locations": {cities[i]["id"]: {"row": 30 + i, "column": 7 + i}}}],
            }
            snapshots.append(snapshot)
        return {"cities": cities, "snapshots": snapshots}, {
            "approvedWindow": {"start": "2020-12", "end": "2021-01"},
            "reviewedMissingTokens": ["", "..", "...", "…", "-"], "products": products,
        }

    def test_sparse_variants_and_city_scopes_preserve_exact_source_locators(self):
        staging, review = self.staging()
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            fixture, _ = make_fixture(staging, review)
            old, new = fixture["cities"]
            self.assertEqual((old["start"], old["end"]), ("2020-12", "2020-12"))
            self.assertTrue(old["historical"])
            self.assertEqual((new["start"], new["end"]), ("2021-01", "2021-01"))
            self.assertEqual(fixture["series"][old["id"]]["synthetic-eggs-count"], [])
            self.assertEqual(fixture["series"][new["id"]]["synthetic-eggs-weight"], [])
            observed = fixture["series"][old["id"]]["synthetic-eggs-weight"][0]
            self.assertEqual((observed["sourceRow"], observed["sourceColumn"]), (30, 7))
            self.assertEqual(observed["raw"], 123)
            self.assertEqual(observed["price"], "123")
            self.assertEqual(fixture["products"][1]["segments"][0]["quoteQuantity"], "10")
            self.assertEqual(fixture["products"][1]["segments"][0]["specificationUnit"], "10 eggs")

    def test_unknown_price_tokens_and_overlapping_variants_fail_publication(self):
        staging, review = self.staging()
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            unknown = copy.deepcopy(staging)
            unknown["snapshots"][0]["prices"][0]["values"]["00001-pre202101"] = "?unknown"
            with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
                with self.assertRaisesRegex(ValueError, "Unexpected price token"):
                    make_fixture(unknown, review)
                overlapping = copy.deepcopy(review)
                duplicate = copy.deepcopy(overlapping["products"][0])
                duplicate["id"] = "synthetic-overlap"
                overlapping["products"].append(duplicate)
                with self.assertRaisesRegex(ValueError, "overlapping variant review"):
                    make_fixture(staging, overlapping)

    def test_legacy_unknown_dots_cannot_authorize_seasonal_carry(self):
        staging, review = self.staging()
        snapshot = staging["snapshots"][0]
        snapshot["specs"]["1341"]["months"] = "6月～7月"
        snapshot["prices"][0]["values"]["00001-pre202101"] = ".."
        admitted = review["products"][0]["reviewedSpecifications"][0]
        admitted["specificationHash"] = specification_hash(snapshot["specs"]["1341"])
        admitted["surveyMonths"] = [6, 7]
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            fixture, _ = make_fixture(staging, review)
        price = fixture["series"]["00001-pre202101"]["synthetic-eggs-weight"][0]
        self.assertEqual(price["raw"], "..")
        self.assertEqual(price["status"], "unavailable")
        self.assertIsNone(price["price"])

    def test_arbitrary_text_containing_y_is_not_a_local_specification(self):
        staging, review = self.staging()
        staging["snapshots"][0]["prices"][0]["values"]["00001-pre202101"] = "MYSTERY"
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            with self.assertRaisesRegex(ValueError, "Unexpected price token"):
                make_fixture(staging, review)

    def test_nonpositive_prices_booleans_and_changed_evidence_fail(self):
        for raw in [0, -1, False, True]:
            staging, review = self.staging()
            staging["snapshots"][0]["prices"][0]["values"]["00001-pre202101"] = raw
            with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
                with self.assertRaisesRegex(ValueError, "Invalid numeric price"):
                    make_fixture(staging, review)
        staging, review = self.staging()
        with patch("pathlib.Path.read_bytes", return_value=b"CHANGED SYNTHETIC EVIDENCE"):
            with self.assertRaisesRegex(ValueError, "Source hash failed"):
                make_fixture(staging, review)


if __name__ == "__main__":
    unittest.main()
