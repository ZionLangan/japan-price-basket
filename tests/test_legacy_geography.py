"""Dated official geography mappings; no synthetic price observations."""

import json
import re
import unittest
from pathlib import Path

from scripts.legacy_geography import (
    classify_reviewed_legacy_token,
    load_review,
    normalize_city_label,
    resolve_legacy_city,
)

ROOT = Path(__file__).resolve().parents[1]


class LegacyGeographyContract(unittest.TestCase):
    def test_print_spacing_and_actual_ordinal_preserve_identity(self):
        self.assertEqual(normalize_city_label(" １　札  幌 "), "札幌")
        self.assertEqual(resolve_legacy_city(" １　札  幌 ", "2000-01")["id"], "01100")
        self.assertEqual(resolve_legacy_city("横\n浜", "2010-01")["id"], "14100")
        with self.assertRaisesRegex(ValueError, "Unreviewed legacy city identity"):
            resolve_legacy_city("1札幌", "2000-01")

    def test_predecessor_is_never_substituted_for_saitama(self):
        urawa = resolve_legacy_city("14 浦 和", "2000-01")
        self.assertEqual(urawa["id"], "11204")
        self.assertTrue(urawa["historical"])
        self.assertIsNone(urawa["currentId"])
        self.assertEqual(urawa["end"], "2001-04")
        saitama = resolve_legacy_city("さいたま", "2001-05")
        self.assertEqual(saitama["id"], "11100")
        self.assertEqual(saitama["sourceCode"], "11244")
        with self.assertRaisesRegex(ValueError, "No unique reviewed city scope"):
            resolve_legacy_city("さいたま", "2001-04")
        with self.assertRaisesRegex(ValueError, "No unique reviewed city scope"):
            resolve_legacy_city("浦和", "2001-05")

    def test_reused_municipality_name_and_code_do_not_join_new_entities(self):
        pairs = [
            ("青森", "2005-03", "2005-04", "02201-pre200504", "02201"),
            ("富山", "2005-03", "2005-04", "16201-pre200504", "16201"),
            ("熊谷", "2005-09", "2005-10", "11202-pre200510", "11202"),
            ("山口", "2005-09", "2005-10", "35203-pre200510", "35203"),
            ("津", "2005-12", "2006-01", "24201-pre200601", "24201"),
            ("石巻", "2005-03", "2005-04", "04202-pre200504", "04202"),
        ]
        for name, before, after, old_id, new_id in pairs:
            with self.subTest(name=name):
                old = resolve_legacy_city(name, before)
                new = resolve_legacy_city(name, after)
                self.assertEqual(old["id"], old_id)
                self.assertEqual(new["id"], new_id)
                self.assertNotEqual(old["id"], new["id"])
                self.assertTrue(old["historical"])
                self.assertIsNone(old["currentId"])
                self.assertTrue(old["evidenceUrls"])

    def test_designated_city_code_change_keeps_only_the_continuing_entity(self):
        old_shizuoka = resolve_legacy_city("静岡", "2000-01")
        new_shizuoka = resolve_legacy_city("静岡", "2003-04")
        designated = resolve_legacy_city("静岡", "2005-04")
        self.assertEqual(old_shizuoka["id"], "22201")
        self.assertEqual(new_shizuoka["id"], "22100")
        self.assertEqual(new_shizuoka["sourceCode"], "22201")
        self.assertEqual(designated["id"], "22100")
        self.assertEqual(designated["sourceCode"], "22100")
        self.assertNotEqual(old_shizuoka["id"], new_shizuoka["id"])

    def test_midmonth_merger_is_a_separate_monthly_scope(self):
        for name, before, transition, after, prefix in [
            ("今治", "2004-12", "2005-01", "2005-02", "38202"),
            ("松江", "2005-02", "2005-03", "2005-04", "32201"),
        ]:
            with self.subTest(name=name):
                old = resolve_legacy_city(name, before)
                middle = resolve_legacy_city(name, transition)
                new = resolve_legacy_city(name, after)
                self.assertEqual(middle["id"], prefix + "-transition" + transition.replace("-", ""))
                self.assertEqual(middle["start"], transition)
                self.assertEqual(middle["end"], transition)
                self.assertTrue(middle["historical"])
                self.assertEqual(len({old["id"], middle["id"], new["id"]}), 3)

    def test_all_current_codes_have_bilingual_latest_scope(self):
        review, _ = load_review()
        current = [s for e in review["entries"] for s in e["scopes"] if not s["historical"]]
        self.assertEqual(len(current), 81)
        self.assertEqual(len({s["id"] for s in current}), 81)
        for entry in review["entries"]:
            for scope in entry["scopes"]:
                result = resolve_legacy_city(entry["sourceName"], scope["start"])
                self.assertEqual(result["id"], scope["id"])
                self.assertTrue(result["names"]["en"])
                self.assertTrue(result["names"]["ja"])
                self.assertTrue(result["sourcePeriods"])

    def test_unknown_similar_names_and_dates_fail_closed(self):
        for name in ["府中町", "東京", "浦和区", "Sapporo", "さっぽろ", "Unknown"]:
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "Unreviewed legacy city identity"):
                    resolve_legacy_city(name, "2000-01")
        for month in ["1999-12", "2026-09", "2000-13", "2000-00", "2000-1", "2000-01junk"]:
            with self.subTest(month=month):
                with self.assertRaises(ValueError):
                    resolve_legacy_city("札幌", month)
        self.assertEqual(resolve_legacy_city("府中", "2000-01")["sourceCode"], "13206")

    def test_original_january_2000_roster_resolves_71_distinct_scopes(self):
        path = ROOT / "data/audit/2026-10-05/rps_jan2000_city_a.extracted.json"
        if not path.exists():
            self.skipTest("Optional original audit evidence is not present in a clean checkout")
        rows = json.loads(path.read_text(encoding="utf-8"))["sheets"][0]["nonempty_rows"]
        started, resolved = False, []
        for row in rows:
            values = row["values"]
            if any(isinstance(v, str) and re.fullmatch(r"\(\d{4}\)", v.strip()) for v in values):
                if started:
                    break
                started = True
                continue
            if started and isinstance(values[7], str) and re.match(r"^\s*\d+\s+", values[7]):
                resolved.append(resolve_legacy_city(values[7], "2000-01"))
        self.assertEqual(len(resolved), 71)
        self.assertEqual(len({r["id"] for r in resolved}), 71)
        self.assertIn("11204", {r["id"] for r in resolved})
        self.assertNotIn("11100", {r["id"] for r in resolved})


class LegacyLegendContract(unittest.TestCase):
    def test_old_dot_token_remains_unknown_unavailable_without_estimate(self):
        result = classify_reviewed_legacy_token(" .. ", "rps-legacy-unknown-dots")
        self.assertEqual(result["raw"], " .. ")
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "unknown")
        self.assertFalse(result["estimateAllowed"])

    def test_known_general_symbols_do_not_authorize_carry_forward(self):
        for token, status in [("***", "not-surveyed"), ("Y", "local-spec"), ("-", "unavailable")]:
            result = classify_reviewed_legacy_token(token, "rps-current-general-notes")
            self.assertEqual(result["status"], status)
            self.assertFalse(result["estimateAllowed"])
        with self.assertRaisesRegex(ValueError, "Unreviewed missing token"):
            classify_reviewed_legacy_token("..", "rps-current-general-notes")
        with self.assertRaisesRegex(ValueError, "Unreviewed source legend"):
            classify_reviewed_legacy_token("-", "invented")


if __name__ == "__main__":
    unittest.main()
