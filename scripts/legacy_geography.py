"""Resolve reviewed legacy survey city names without positional or fuzzy joins.

This helper reads the checked-in dated review. It performs no network requests.
Original city labels and table cell locators remain the acquisition adapter's
responsibility. The returned source code is dated provenance; id is the reviewed
website scope, which may be a distinct historical or merger-transition entity.
"""

import calendar
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVIEW_PATH = ROOT / "data/legacy-geography-review.json"
MONTH = re.compile(r"20\d{2}-(0[1-9]|1[0-2])\Z")


def normalize_city_label(raw_label):
    """Remove print spacing and an actual ordinal prefix, never rename a city."""
    if not isinstance(raw_label, str) or len(raw_label) > 200:
        raise ValueError("Invalid legacy city label")
    value = unicodedata.normalize("NFKC", raw_label)
    value = re.sub(r"^\s*\d{1,3}\s+", "", value)
    value = re.sub(r"\s+", "", value)
    if not value:
        raise ValueError("Empty legacy city label")
    return value


@lru_cache(maxsize=1)
def load_review():
    review = json.loads(REVIEW_PATH.read_text(encoding="utf-8"))
    if review.get("schemaVersion") != 1:
        raise ValueError("Unsupported geography review schema")
    labels, scope_ids = {}, set()
    for entry in review["entries"]:
        for alias in entry["aliases"]:
            key = normalize_city_label(alias)
            if key in labels:
                raise ValueError("Duplicate reviewed city alias: " + key)
            labels[key] = entry
        for scope in entry["scopes"]:
            if scope["id"] in scope_ids:
                raise ValueError("Duplicate reviewed geography scope: " + scope["id"])
            scope_ids.add(scope["id"])
            if not re.fullmatch(r"\d{5}(?:-(?:pre|transition)20\d{4})?", scope["id"]):
                raise ValueError("Invalid reviewed geography scope")
            if scope["start"] > scope["end"] or not scope["evidenceUrls"]:
                raise ValueError("Invalid or unevidenced geography window")
    return review, labels


def resolve_legacy_city(raw_label, month):
    if not isinstance(month, str) or not MONTH.fullmatch(month):
        raise ValueError("Invalid geography month; use YYYY-MM")
    review, labels = load_review()
    if not review["start"] <= month <= review["end"]:
        raise ValueError("Month outside reviewed geography window")
    label = normalize_city_label(raw_label)
    entry = labels.get(label)
    if entry is None:
        raise ValueError(f"Unreviewed legacy city identity: {raw_label!r}, {month}")
    scopes = [s for s in entry["scopes"] if s["start"] <= month <= s["end"]]
    if len(scopes) != 1:
        raise ValueError(f"No unique reviewed city scope: {raw_label!r}, {month}")
    scope = scopes[0]
    year, number = map(int, month.split("-"))
    first = month + "-01"
    last = f"{month}-{calendar.monthrange(year, number)[1]:02}"
    periods = [p for p in entry["periods"] if p["from"] <= last and
               (not p["until"] or p["until"] > first)]
    if not periods:
        raise ValueError(f"No official dated municipality evidence: {raw_label!r}, {month}")
    # A midmonth event may leave several dated code versions. Keep all of them
    # in provenance. Choosing a stable website scope does not erase that event.
    codes = sorted({p["code"] for p in periods})
    return {
        **scope,
        "names": {"ja": scope["ja"], "en": scope["en"]},
        "sourceName": entry["sourceName"],
        "sourceCode": codes[0] if len(codes) == 1 else None,
        "sourceCodes": codes,
        "validFrom": min(p["from"] for p in periods),
        "validTo": max(p["until"] or "9999-12-31" for p in periods),
        "evidenceUrl": periods[-1]["evidenceUrl"],
        "sourcePeriods": periods,
    }


def classify_reviewed_legacy_token(raw_token, legend_id):
    """Classify only an explicit reviewed legend; never authorize an estimate."""
    if not isinstance(raw_token, str):
        raise ValueError("Missing token must remain text")
    review, _ = load_review()
    legend = next((r for r in review["legendReviews"] if r["id"] == legend_id), None)
    if legend is None:
        raise ValueError("Unreviewed source legend")
    token = unicodedata.normalize("NFKC", raw_token).strip()
    if token not in legend["tokens"]:
        raise ValueError(f"Unreviewed missing token: {raw_token!r}")
    return {"status": legend["tokens"][token], "raw": raw_token,
            "reason": "unknown" if token == ".." else legend["tokens"][token],
            "estimateAllowed": False, "sourceUrl": legend["sourceUrl"]}
