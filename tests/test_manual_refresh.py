"""Synthetic correction fixtures and mocked downloads; never published prices."""

import copy
import hashlib
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from scripts import import_recent_prices as importer
from scripts.refresh_historical_prices import (
    combine_staging, correction_report, digest, refresh_window, staging_manifest,
)

URL = "https://www.e-stat.go.jp/synthetic-download-test-only"


def source(raw=b"synthetic old", source_id="2026-08-food"):
    return {"id": source_id, "category": "food", "url": URL,
            "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
            "retrievedAt": "2026-09-01T00:00:00+00:00"}


def snapshot(month="2026-08"):
    receipt = source(source_id=month + "-food")
    return {"month": month, "cities": [{"id": "13100", "names": {"en": "Synthetic only", "ja": "合成テスト"}}],
            "sources": [receipt], "listing": receipt, "specSource": source(source_id="synthetic-spec"),
            "specs": {"1021": {"name": "Synthetic only", "definition": "Synthetic bread",
                                "detail": "", "months": "", "unit": "1kg"}},
            "prices": [{"code": "1021", "sourceId": receipt["id"], "name": "Synthetic only",
                        "sheet": "synthetic-only", "unit": "1kg", "row": 3, "revision": None,
                        "values": {"13100": 100}, "locations": {"13100": {"row": 3, "column": 4}}}]}


def window(*snapshots):
    return {"cities": snapshots[0]["cities"], "snapshots": list(snapshots)}


class ExplicitDownloadRefresh(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.cache = Path(self.temporary.name)
        self.cache_patch = patch.object(importer, "CACHE", self.cache)
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)

    def fetch(self, data, refresh=False):
        with patch.object(importer.urllib.request, "urlopen", return_value=io.BytesIO(data)) as upstream:
            result = importer.download(URL, refresh)
        return result, upstream.call_count

    def test_cached_read_does_not_fetch_and_checks_existing_bytes(self):
        (original, receipt), count = self.fetch(b"synthetic original")
        self.assertEqual(count, 1)
        with patch.object(importer.urllib.request, "urlopen") as upstream:
            self.assertEqual(importer.download(URL), (original, receipt))
            upstream.assert_not_called()
        (self.cache / receipt["sha256"]).write_bytes(b"corrupted")
        with patch.object(importer.urllib.request, "urlopen") as upstream:
            with self.assertRaisesRegex(ValueError, "Cached source checksum"):
                importer.download(URL, refresh=True)
            upstream.assert_not_called()

    def test_changed_refresh_keeps_old_bytes_and_receipt_chain(self):
        (old, before), _ = self.fetch(b"synthetic original")
        key = hashlib.sha256(URL.encode()).hexdigest()
        old_receipt = (self.cache / f"{key}.json").read_bytes()
        (new, after), count = self.fetch(b"synthetic correction", refresh=True)
        self.assertEqual(count, 1)
        self.assertNotEqual(before["sha256"], after["sha256"])
        self.assertEqual(after["refreshStatus"], "changed")
        self.assertEqual(after["previousSha256"], before["sha256"])
        self.assertEqual((self.cache / before["sha256"]).read_bytes(), old)
        self.assertEqual((self.cache / after["sha256"]).read_bytes(), new)
        history = self.cache / "receipts" / key
        self.assertEqual((history / f"{after['previousReceiptSha256']}.json").read_bytes(), old_receipt)
        for path in history.iterdir():
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), path.stem)

    def test_unchanged_refresh_is_reported_without_new_evidence_blob(self):
        (_, before), _ = self.fetch(b"synthetic original")
        (_, after), count = self.fetch(b"synthetic original", refresh=True)
        self.assertEqual(count, 1)
        self.assertEqual(after["refreshStatus"], "unchanged")
        self.assertEqual(before["sha256"], after["sha256"])
        self.assertEqual(len([path for path in self.cache.iterdir() if len(path.name) == 64]), 1)

    def test_failed_fetch_preserves_current_receipt_and_prior_evidence(self):
        (_, before), _ = self.fetch(b"synthetic original")
        key = hashlib.sha256(URL.encode()).hexdigest()
        receipt_path = self.cache / f"{key}.json"
        old_receipt = receipt_path.read_bytes()
        with patch.object(importer.urllib.request, "urlopen", side_effect=urllib.error.URLError("synthetic failure")), \
                patch.object(importer.time, "sleep"):
            with self.assertRaises(urllib.error.URLError):
                importer.download(URL, refresh=True)
        self.assertEqual(receipt_path.read_bytes(), old_receipt)
        self.assertEqual((self.cache / before["sha256"]).read_bytes(), b"synthetic original")

    def test_oversized_response_does_not_replace_a_valid_receipt(self):
        self.fetch(b"synthetic original")
        key = hashlib.sha256(URL.encode()).hexdigest()
        old = (self.cache / f"{key}.json").read_bytes()
        with patch.object(importer.urllib.request, "urlopen", return_value=io.BytesIO(b"x" * (20 * 1024 * 1024 + 1))):
            with self.assertRaisesRegex(ValueError, "exceeds 20 MiB"):
                importer.download(URL, refresh=True)
        self.assertEqual((self.cache / f"{key}.json").read_bytes(), old)


class CorrectionDiffSafety(unittest.TestCase):
    def test_price_change_retains_both_cells_and_flags_large_movement(self):
        old, new = snapshot(), snapshot()
        new["prices"][0]["values"]["13100"] = 135
        new["sources"][0] = source(b"synthetic corrected")
        report = correction_report(window(old), window(new))
        self.assertEqual(report["counts"]["changedPrices"], 1)
        self.assertEqual(report["counts"]["sourceChanges"], 1)
        change = report["priceChanges"][0]
        self.assertEqual(change["before"]["raw"], 100)
        self.assertEqual(change["after"]["raw"], 135)
        self.assertEqual(change["before"]["column"], 4)
        self.assertNotEqual(change["before"]["source"]["sha256"], change["after"]["source"]["sha256"])
        self.assertEqual(change["percentChange"], "35.00")
        self.assertTrue(change["largeMovementReview"])
        self.assertEqual(old["prices"][0]["values"]["13100"], 100)

    def test_missing_token_is_retained_and_not_converted_to_zero(self):
        old, new = snapshot(), snapshot()
        new["prices"][0]["values"]["13100"] = ".."
        change = correction_report(window(old), window(new))["priceChanges"][0]
        self.assertEqual(change["after"]["raw"], "..")
        self.assertIsNone(change["percentChange"])
        self.assertFalse(change["largeMovementReview"])

    def test_definition_unit_revision_and_locator_changes_are_reviewable(self):
        old, new = snapshot(), snapshot()
        new["specs"]["1021"]["unit"] = "500g"
        new["prices"][0]["unit"] = "500g"
        new["prices"][0]["revision"] = "synthetic corrected marker"
        new["prices"][0]["locations"]["13100"]["row"] = 4
        report = correction_report(window(old), window(new))
        self.assertEqual({row["kind"] for row in report["metadataChanges"]},
                         {"specification", "price-row", "cell-locator"})
        self.assertEqual(report["counts"]["changedPrices"], 0)
        self.assertEqual(report["counts"]["changedMonths"], 1)

    def test_native_percent_is_not_computed_across_a_changed_quote_unit(self):
        old, new = snapshot(), snapshot()
        new["prices"][0]["unit"] = "500g"
        new["prices"][0]["values"]["13100"] = 60
        change = correction_report(window(old), window(new))["priceChanges"][0]
        self.assertIsNone(change["percentChange"])
        self.assertFalse(change["largeMovementReview"])

    def test_recheck_timestamps_alone_do_not_change_a_month(self):
        old, new = snapshot(), snapshot()
        new["sources"][0]["retrievedAt"] = "2026-10-10T00:00:00+00:00"
        new["specSource"]["retrievedAt"] = "2026-10-10T00:00:00+00:00"
        self.assertEqual(correction_report(window(old), window(new))["counts"]["changedMonths"], 0)

    def test_duplicates_missing_provenance_and_window_mismatch_fail(self):
        old = snapshot()
        candidates = []
        duplicate = snapshot()
        duplicate["prices"].append(copy.deepcopy(duplicate["prices"][0]))
        candidates.append(window(duplicate))
        missing = snapshot()
        del missing["prices"][0]["locations"]["13100"]
        candidates.append(window(missing))
        candidates.append(window(snapshot("2026-07")))
        candidates.append(window(snapshot(), snapshot()))
        for candidate in candidates:
            with self.subTest(candidate=candidate):
                with self.assertRaises(ValueError):
                    correction_report(window(old), candidate)

    def test_unapproved_private_or_credentialed_sources_are_rejected(self):
        for url in ["http://www.e-stat.go.jp/test", "https://127.0.0.1/test",
                    "https://user:password@www.e-stat.go.jp/test", "https://www.e-stat.go.jp/test?appId=synthetic-secret"]:
            candidate = snapshot()
            candidate["sources"][0]["url"] = url
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, "public official download"):
                correction_report(window(snapshot()), window(candidate))

    def test_combine_binds_baseline_and_candidate_and_preserves_other_months(self):
        old, new = snapshot(), snapshot()
        new["prices"][0]["values"]["13100"] = 105
        candidate = window(new)
        candidate["reviewStatus"] = "unapproved-candidate"
        report = correction_report(window(old), candidate)
        report["afterStagingSha256"] = digest(candidate)
        baseline = window(snapshot("2026-07"), old)
        untouched = copy.deepcopy(baseline)
        combined = combine_staging(baseline, candidate, report)
        self.assertEqual(combined["snapshots"][0], baseline["snapshots"][0])
        self.assertEqual(combined["snapshots"][1]["prices"][0]["values"]["13100"], 105)
        self.assertEqual(baseline, untouched)
        self.assertEqual(combined["reviewStatus"], "unapproved-candidate")
        updated_sources = staging_manifest(combined)
        self.assertEqual(updated_sources["start"], "2026-07")
        self.assertEqual(updated_sources["months"][1]["sources"], new["sources"])
        altered = copy.deepcopy(candidate)
        altered["snapshots"][0]["prices"][0]["values"]["13100"] = 200
        with self.assertRaisesRegex(ValueError, "match the correction report"):
            combine_staging(baseline, altered, report)
        stale = copy.deepcopy(baseline)
        stale["snapshots"][1]["prices"][0]["unit"] = "500g"
        with self.assertRaisesRegex(ValueError, "Baseline month differs"):
            combine_staging(stale, candidate, report)
        bad_report = copy.deepcopy(report)
        bad_report["months"][0]["changed"] = False
        with self.assertRaisesRegex(ValueError, "change flag disagrees"):
            combine_staging(baseline, candidate, bad_report)


class BoundedRefreshOutput(unittest.TestCase):
    def test_success_writes_separate_review_bundle_and_never_changes_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            manifest_path, output = root / "manifest.json", root / "correction"
            old = snapshot()
            record = {"month": old["month"], "sources": old["sources"], "specSource": old["specSource"]}
            manifest_path.write_text(json.dumps({"months": [record]}), encoding="utf-8")
            manifest_before = manifest_path.read_bytes()
            with patch("scripts.refresh_historical_prices.reparse", return_value=old), \
                    patch.object(importer, "download", return_value=(b"synthetic old", old["sources"][0])) as download:
                report = refresh_window(manifest_path, "2026-08", "2026-08", output, root / "cache")
            self.assertEqual(download.call_count, 1)  # One shared URL is fetched once.
            self.assertEqual(download.call_args.kwargs, {"refresh": True})
            self.assertEqual(manifest_path.read_bytes(), manifest_before)
            candidate = json.loads((output / "candidate.json").read_bytes())
            self.assertEqual(report["afterStagingSha256"], digest(candidate))
            self.assertEqual(report["counts"]["changedMonths"], 0)
            self.assertEqual(sorted(p.name for p in output.iterdir()), ["before.json", "candidate.json", "report.json"])

    def test_fetch_failure_or_unbounded_window_writes_no_candidate(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            manifest_path, output = root / "manifest.json", root / "correction"
            old = snapshot()
            record = {"month": old["month"], "sources": old["sources"], "specSource": old["specSource"]}
            manifest_path.write_text(json.dumps({"months": [record]}), encoding="utf-8")
            with patch("scripts.refresh_historical_prices.reparse", return_value=old), \
                    patch.object(importer, "download", side_effect=urllib.error.URLError("synthetic failure")):
                with self.assertRaises(urllib.error.URLError):
                    refresh_window(manifest_path, "2026-08", "2026-08", output, root / "cache")
            self.assertFalse(output.exists())
            with self.assertRaisesRegex(ValueError, "exceeds 24 months"):
                refresh_window(manifest_path, "2000-01", "2026-08", output, root / "cache")
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
