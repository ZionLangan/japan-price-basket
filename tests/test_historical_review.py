"""Synthetic publication fixtures verify review boundaries; never public prices."""
import copy
import hashlib
import gzip
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.review_recent_prices import (
    make_fixture,
    merge_reviews,
    conversion_hash,
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
    def test_conflicting_caption_quantity_is_explicitly_estimated_and_dated(self):
        spec = {"name": "Synthetic cheese", "definition": "Synthetic package: 225g",
                "detail": "", "unit": "1 box", "months": ""}
        conversion = {"from": "kg", "to": "kg", "factor": "1", "estimated": True,
                      "basis": "dated-specification-over-conflicting-price-caption",
                      "evidenceUrl": "https://www.stat.go.jp/data/kouri/doukou/zuhyou/200001.xls",
                      "description": {"en": "Synthetic uncertain caption example", "ja": "合成テスト用"}}
        admitted = approval(spec, "2000-01", "kg", "0.225", "Synthetic 200g caption")
        admitted.update(quantityConversion=conversion, quantityConversionHash=conversion_hash(conversion))
        mapping = {"id": "synthetic-cheese", "code": "1331", "unit": "kg",
                   "reviewedSpecifications": [admitted]}
        validate_reviewed_specification(mapping, {"unit": "Synthetic 200g caption"}, spec, "2000-01")
        for key, value in [("factor", "5"), ("estimated", False), ("to", "count")]:
            changed = copy.deepcopy(mapping)
            changed["reviewedSpecifications"][0]["quantityConversion"][key] = value
            changed["reviewedSpecifications"][0]["quantityConversionHash"] = conversion_hash(
                changed["reviewedSpecifications"][0]["quantityConversion"])
            with self.assertRaisesRegex(ValueError, "Unsupported reviewed conversion"):
                validate_reviewed_specification(changed, {"unit": "Synthetic 200g caption"}, spec, "2000-01")
        for code in ["1021", "1341", "1491"]:
            changed = {**mapping, "code": code}
            with self.assertRaisesRegex(ValueError, "Unsupported reviewed conversion"):
                validate_reviewed_specification(changed, {"unit": "Synthetic 200g caption"}, spec, "2000-01")
        changed = copy.deepcopy(mapping)
        changed["reviewedSpecifications"][0].update(start="2000-02", end="2000-02")
        with self.assertRaisesRegex(ValueError, "Unsupported reviewed conversion"):
            validate_reviewed_specification(changed, {"unit": "Synthetic 200g caption"}, spec, "2000-02")

    def test_other_caption_estimates_require_reviewed_windows_and_disclosure(self):
        for code, month, unit, quantity, invalid_month in [
            ("1011", "2002-01", "kg", "1", "2002-02"),
            ("2042", "2006-12", "L", "0.75", "2007-01"),
            ("1331", "2005-10", "kg", "0.18", "2005-11"),
        ]:
            with self.subTest(code=code):
                spec = {"name": "Synthetic caption conflict", "definition": "Synthetic dated package",
                        "detail": "", "unit": "Synthetic package", "months": ""}
                conversion = {
                    "from": unit, "to": unit, "factor": "1", "estimated": True,
                    "basis": "dated-specification-over-conflicting-price-caption",
                    "evidenceUrl": "https://www.stat.go.jp/data/kouri/doukou/zuhyou/synthetic-only.xls",
                    "description": {"en": "Synthetic disclosed conflict", "ja": "合成テスト用"},
                }
                admitted = approval(spec, month, unit, quantity, "Synthetic conflicting caption")
                admitted.update(quantityConversion=conversion, quantityConversionHash=conversion_hash(conversion))
                mapping = {"id": "synthetic-caption-conflict", "code": code, "unit": unit,
                           "reviewedSpecifications": [admitted]}
                validate_reviewed_specification(mapping, {"unit": "Synthetic conflicting caption"}, spec, month)
                for change in [
                    {"basis": "unreviewed-caption-preference"},
                    {"evidenceUrl": "https://example.invalid/unreviewed"},
                    {"description": {"en": "Missing Japanese disclosure"}},
                ]:
                    changed = copy.deepcopy(mapping)
                    converted = changed["reviewedSpecifications"][0]["quantityConversion"]
                    converted.update(change)
                    changed["reviewedSpecifications"][0]["quantityConversionHash"] = conversion_hash(converted)
                    with self.assertRaisesRegex(ValueError, "Unsupported reviewed conversion"):
                        validate_reviewed_specification(changed, {"unit": "Synthetic conflicting caption"}, spec, month)
                changed = copy.deepcopy(mapping)
                changed["reviewedSpecifications"][0].update(start=invalid_month, end=invalid_month)
                with self.assertRaisesRegex(ValueError, "Unsupported reviewed conversion"):
                    validate_reviewed_specification(changed, {"unit": "Synthetic conflicting caption"}, spec, invalid_month)

    def test_ordered_food_reviews_preserve_existing_and_household_identities(self):
        base = {"approvedWindow": {"start": "2000-01", "end": "2026-08"},
                "products": [{"id": "synthetic-food", "code": "1021", "unit": "kg"},
                             {"id": "synthetic-household", "code": "4421", "unit": "package"}]}
        first = {"approvedWindow": base["approvedWindow"], "policyVersion": "1.2",
                 "reviewedAt": "2026-10-10", "policy": "Synthetic review only",
                 "products": [{"id": "synthetic-added-a", "code": "1031", "unit": "kg"}],
                 "existingProductUpdates": [{**base["products"][0], "reviewed": True}]}
        second = {**first, "products": [{"id": "synthetic-added-b", "code": "1041", "unit": "kg"}],
                  "existingProductUpdates": []}
        combined = merge_reviews(merge_reviews(base, first), second)
        self.assertEqual([p["id"] for p in combined["products"]],
                         ["synthetic-food", "synthetic-household", "synthetic-added-a", "synthetic-added-b"])
        self.assertEqual(combined["products"][1], base["products"][1])
        self.assertTrue(combined["products"][0]["reviewed"])
        self.assertNotIn("reviewed", base["products"][0])
        with self.assertRaisesRegex(ValueError, "duplicate identity"):
            merge_reviews(combined, second)
        bad_household = {**first, "products": [],
                         "existingProductUpdates": [{**base["products"][1], "reviewed": True}]}
        with self.assertRaisesRegex(ValueError, "stable product identity"):
            merge_reviews(base, bad_household)

    def test_ordered_food_reviews_accumulate_independent_definition_exclusions(self):
        base = {"approvedWindow": {"start": "2000-01", "end": "2026-08"},
                "products": [{"id": "synthetic-food", "code": "1021", "unit": "kg"}],
                "unreviewedSourcePeriods": [{"code": "1021", "start": "2000-01",
                                             "end": "2000-02", "requireMissingBasicDefinition": True,
                                             "reason": "Synthetic absent local definition"}]}
        expansion = {"approvedWindow": base["approvedWindow"], "policyVersion": "1.2",
                     "reviewedAt": "2026-10-10", "policy": "Synthetic review only",
                     "products": [{"id": "synthetic-added", "code": "1031", "unit": "kg"}],
                     "unreviewedSourcePeriods": [{"code": "1031", "start": "2000-03",
                                                  "end": "2000-04", "requireMissingBasicDefinition": True,
                                                  "reason": "Another synthetic absent definition"}]}
        combined = merge_reviews(base, expansion)
        self.assertEqual(combined["unreviewedSourcePeriods"],
                         base["unreviewedSourcePeriods"] + expansion["unreviewedSourcePeriods"])
        combined["unreviewedSourcePeriods"][0]["reason"] = "Changed test copy"
        combined["unreviewedSourcePeriods"][1]["reason"] = "Changed second test copy"
        self.assertEqual(base["unreviewedSourcePeriods"][0]["reason"],
                         "Synthetic absent local definition")
        self.assertEqual(expansion["unreviewedSourcePeriods"][0]["reason"],
                         "Another synthetic absent definition")

    def reviewed_egg(self):
        review = json.loads((Path(__file__).resolve().parents[1] / "data/catalog-review.json").read_text(encoding="utf-8"))
        mapping = next(p for p in review["products"] if p["id"] == "mixed-size-eggs")
        spec = {"name": "鶏卵", "definition": "1個約60g", "detail": "", "unit": "1kg", "months": ""}
        return copy.deepcopy(mapping), spec

    def test_only_the_dated_60g_egg_assumption_allows_mass_to_count(self):
        mapping, spec = self.reviewed_egg()
        admitted = validate_reviewed_specification(mapping, {"unit": "(1kg)"}, spec, "2000-01")
        self.assertEqual(mapping["unit"], "count")
        self.assertEqual((admitted["quoteQuantity"], admitted["quoteUnit"]), ("1", "kg"))
        self.assertEqual(admitted["quantityConversion"]["factor"], "0.06")
        self.assertTrue(admitted["quantityConversion"]["estimated"])
        missing = copy.deepcopy(mapping)
        del missing["reviewedSpecifications"][0]["quantityConversion"]
        with self.assertRaisesRegex(ValueError, "Incompatible quote dimension"):
            validate_reviewed_specification(missing, {"unit": "(1kg)"}, spec, "2000-01")

    def test_changed_conversion_metadata_and_unrelated_conversions_fail_review(self):
        mapping, spec = self.reviewed_egg()
        for field, value in [("factor", "0.067"), ("estimated", False), ("from", "kg"),
                             ("to", "count"), ("evidenceUrl", "https://example.invalid/unreviewed")]:
            changed = copy.deepcopy(mapping)
            changed["reviewedSpecifications"][0]["quantityConversion"][field] = value
            with self.assertRaisesRegex(ValueError, "Unreviewed conversion metadata"):
                validate_reviewed_specification(changed, {"unit": "(1kg)"}, spec, "2000-01")
        for id_, factor in [("synthetic-unrelated-product", "0.06"), ("mixed-size-eggs", "0.067")]:
            changed = copy.deepcopy(mapping)
            changed["id"] = id_
            admitted = changed["reviewedSpecifications"][0]
            admitted["quantityConversion"]["factor"] = factor
            admitted["quantityConversionHash"] = conversion_hash(admitted["quantityConversion"])
            with self.assertRaisesRegex(ValueError, "Unsupported reviewed conversion"):
                validate_reviewed_specification(changed, {"unit": "(1kg)"}, spec, "2000-01")

    def test_published_egg_merge_preserves_native_prices_and_unique_cells(self):
        fixture = json.loads(gzip.decompress((Path(__file__).resolve().parents[1] /
                                             "data/fixtures/recent-approved.json.gz").read_bytes()))
        eggs = [p for p in fixture["products"] if p["code"] == "1341"]
        self.assertEqual([p["id"] for p in eggs], ["mixed-size-eggs"])
        self.assertEqual(eggs[0]["missingPriceEstimate"],
                         {"maxMonths": 2, "tokens": ["-"], "allowEquivalentSegments": True})
        self.assertEqual(eggs[0]["segments"][0]["quoteUnit"], "kg")
        self.assertTrue(eggs[0]["segments"][0]["quantityConversion"]["estimated"])
        tokyo = fixture["series"]["13100"]["mixed-size-eggs"]
        native = next(o for o in tokyo if o["month"] == "2000-01")
        self.assertEqual((native["raw"], native["price"], native["status"], native["sourceUnit"]),
                         (302, "302", "observed", "(1kg)"))
        cells = set()
        for products in fixture["series"].values():
            for rows in products.values():
                for row in rows:
                    if "sourceColumn" not in row:
                        continue
                    cell = (row["sourceId"], row["sourceSheet"], row["sourceRow"], row["sourceColumn"])
                    self.assertNotIn(cell, cells, "A native cell was duplicated under multiple variants")
                    cells.add(cell)
        self.assertEqual(len(cells), 5261365)
        self.assertTrue(all(p.get("selectable") is False for p in fixture["products"]
                            if p["code"] in {"4431", "4441"}))

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

    def test_policy_12_offseason_inference_keeps_native_dots_and_scheduled_gaps(self):
        staging, review = self.staging()
        review["policyVersion"] = "1.2"
        snapshot = staging["snapshots"][0]
        snapshot["specs"]["1341"]["months"] = "1月"
        snapshot["prices"][0]["values"]["00001-pre202101"] = ".."
        approval = review["products"][0]["reviewedSpecifications"][0]
        approval["end"] = "2021-01"
        approval["specificationHash"] = specification_hash(snapshot["specs"]["1341"])
        approval["surveyMonths"] = [1]
        # This city actually surveys the synthetic item in January. December
        # may be marked off-season, but calculations cannot fill it backwards.
        review["products"] = review["products"][:1]
        staging["cities"] = staging["cities"][:1]
        later = staging["snapshots"][1]
        later["cities"] = snapshot["cities"]
        later["specs"] = copy.deepcopy(snapshot["specs"])
        later["prices"] = copy.deepcopy(snapshot["prices"])
        later["prices"][0]["values"]["00001-pre202101"] = 123
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            fixture, _ = make_fixture(staging, review)
            row = fixture["series"]["00001-pre202101"]["synthetic-eggs-weight"][0]
            self.assertEqual((row["raw"], row["price"], row["status"]), ("..", None, "seasonal"))
            snapshot["specs"]["1341"]["months"] = "12月"
            later["specs"] = copy.deepcopy(snapshot["specs"])
            approval["specificationHash"] = specification_hash(snapshot["specs"]["1341"])
            approval["surveyMonths"] = [12]
            fixture, _ = make_fixture(staging, review)
            row = fixture["series"]["00001-pre202101"]["synthetic-eggs-weight"][0]
            self.assertEqual((row["raw"], row["price"], row["status"]), ("..", None, "unavailable"))

    def test_egg_market_gap_exception_cannot_leak_to_an_unreviewed_product(self):
        staging, review = self.staging()
        review["products"][0]["missingPriceEstimate"] = {
            "maxMonths": 2, "tokens": ["-"], "allowEquivalentSegments": True}
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            with self.assertRaisesRegex(ValueError, "Unreviewed missing-price estimate rule"):
                make_fixture(staging, review)

    def test_policy_12_food_gaps_require_the_bounded_explicit_rule(self):
        staging, review = self.staging()
        review["policyVersion"] = "1.2"
        rule = {"maxMonths": 2, "tokens": ["-"], "allowEquivalentSegments": True}
        review["products"][0]["missingPriceEstimate"] = rule
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            fixture, _ = make_fixture(staging, review)
            self.assertEqual(fixture["products"][0]["missingPriceEstimate"], rule)
            review["products"][0]["missingPriceEstimate"]["tokens"] = ["..."]
            with self.assertRaisesRegex(ValueError, "Unreviewed missing-price estimate rule"):
                make_fixture(staging, review)

    def test_later_survey_start_keeps_prior_month_absent_but_not_a_missing_parse(self):
        staging, review = self.staging()
        # A deliberately synthetic new survey item has no first-month row or
        # approval. Existing, present rows still require exactly one approval.
        staging["snapshots"][0]["prices"] = []
        staging["snapshots"][0]["specs"] = {}
        review["products"] = [review["products"][1]]
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            fixture, _ = make_fixture(staging, review)
            self.assertEqual(fixture["series"]["00001-pre202101"]["synthetic-eggs-count"], [])
            bad = copy.deepcopy(review)
            bad["products"][0]["reviewedSpecifications"][0]["start"] = "2020-12"
            with self.assertRaisesRegex(ValueError, "Missing or overlapping variant review"):
                make_fixture(staging, bad)

    def unresolved_definition(self):
        staging, review = self.staging()
        # The first month really contains a price row, but no basic definition.
        # Admit the later defined form and retain the earlier evidence upstream.
        review["products"] = [review["products"][1]]
        staging["snapshots"][0]["specs"] = {}
        review["unreviewedSourcePeriods"] = [{
            "code": "1341", "start": "2020-12", "end": "2020-12",
            "requireMissingBasicDefinition": True,
            "reason": "Synthetic local definition not yet recovered",
        }]
        return staging, review

    def test_bounded_unresolved_definition_excludes_only_unadmitted_public_prices(self):
        staging, review = self.unresolved_definition()
        original = copy.deepcopy(staging)
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            fixture, _ = make_fixture(staging, review)
        self.assertEqual(staging, original, "Raw staging evidence must remain unchanged")
        self.assertEqual(fixture["series"]["00001-pre202101"]["synthetic-eggs-count"], [])
        admitted = fixture["series"]["00001"]["synthetic-eggs-count"]
        self.assertEqual([(row["month"], row["raw"], row["price"]) for row in admitted],
                         [("2021-01", 123, "123")])
        self.assertIn("2020-12-synthetic", {source["id"] for source in fixture["sources"]})

    def test_unresolved_definition_rule_cannot_hide_defined_or_approved_rows(self):
        staging, review = self.unresolved_definition()
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            defined = copy.deepcopy(staging)
            defined["snapshots"][0]["specs"]["1341"] = self.staging()[0]["snapshots"][0]["specs"]["1341"]
            with self.assertRaisesRegex(ValueError, "Missing or overlapping variant review"):
                make_fixture(defined, review)
            approved = copy.deepcopy(review)
            approved["products"].insert(0, self.staging()[1]["products"][0])
            with self.assertRaisesRegex(ValueError, "overlapping review/exclusion"):
                make_fixture(staging, approved)
            absent_rule = copy.deepcopy(review)
            del absent_rule["unreviewedSourcePeriods"]
            with self.assertRaisesRegex(ValueError, "Missing or overlapping variant review"):
                make_fixture(staging, absent_rule)

    def test_unresolved_definition_rule_requires_bounded_explicit_metadata(self):
        staging, review = self.unresolved_definition()
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            for change in [
                {"code": "9999"}, {"start": "2020-11"}, {"end": "2021-02"},
                {"start": "2021-01", "end": "2020-12"},
                {"requireMissingBasicDefinition": False}, {"reason": ""},
            ]:
                with self.subTest(change=change):
                    changed = copy.deepcopy(review)
                    changed["unreviewedSourcePeriods"][0].update(change)
                    with self.assertRaisesRegex(ValueError, "Invalid explicit unresolved-definition period"):
                        make_fixture(staging, changed)

    def test_unresolved_definition_rule_cannot_hide_duplicate_sources_or_exclusions(self):
        staging, review = self.unresolved_definition()
        with patch("pathlib.Path.read_bytes", return_value=SYNTHETIC_BYTES):
            duplicated = copy.deepcopy(staging)
            duplicated["snapshots"][0]["prices"].append(
                copy.deepcopy(duplicated["snapshots"][0]["prices"][0]))
            with self.assertRaisesRegex(ValueError, "Duplicate source or overlapping review/exclusion"):
                make_fixture(duplicated, review)
            overlapping = copy.deepcopy(review)
            overlapping["unreviewedSourcePeriods"].append(
                copy.deepcopy(overlapping["unreviewedSourcePeriods"][0]))
            with self.assertRaisesRegex(ValueError, "Duplicate source or overlapping review/exclusion"):
                make_fixture(staging, overlapping)

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
