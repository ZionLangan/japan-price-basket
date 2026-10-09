"""Build a small approved, normalized prototype fixture from acquired evidence.

Run only after reviewing the report and catalog mapping. This is not an automatic
approval of new products or old archives. Output is a bounded, compressed fixture;
ordinary release files and downloaded workbooks stay outside Git.
"""

import argparse
import gzip
import hashlib
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def normalized(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(text or "")))


def specification_hash(spec):
    """Fingerprint the reviewed meanings of every original specification column."""
    return hashlib.sha256(canonical({
        key: normalized(spec.get(key))
        for key in ["name", "definition", "detail", "unit", "months"]
    })).hexdigest()


def conversion_hash(conversion):
    """Fingerprint an explicitly reviewed conversion assumption independently."""
    return hashlib.sha256(canonical(conversion)).hexdigest()


def survey_months(spec):
    """Read an explicit month list/range; unknown calendar wording fails review."""
    text = normalized(spec.get("months")).replace("～", "~")
    if not text:
        return list(range(1, 13))
    result = set()
    for token in re.split(r"[,、､]", text):
        match = re.fullmatch(r"(\d{1,2})(?:月)?(?:~(\d{1,2}))?月", token)
        if not match:
            raise ValueError(f"Unreviewed seasonal schedule: {spec.get('months')!r}")
        first, last = int(match[1]), int(match[2] or match[1])
        if not 1 <= first <= last <= 12:
            raise ValueError(f"Invalid seasonal schedule: {spec.get('months')!r}")
        result.update(range(first, last + 1))
    return sorted(result)


def reviewed_specification(mapping, month):
    admitted = [s for s in mapping.get("reviewedSpecifications", [])
                if s["start"] <= month <= s["end"]]
    if len(admitted) > 1:
        raise ValueError(f"Overlapping specification approvals {mapping['id']}, {month}")
    return admitted[0] if admitted else None


def validate_reviewed_specification(mapping, row, spec, month):
    approval = reviewed_specification(mapping, month)
    if approval is None:
        raise ValueError(f"Inactive or unreviewed variant {mapping['id']}, {month}")
    if specification_hash(spec) != approval["specificationHash"]:
        raise ValueError(f"Unreviewed specification {mapping['id']}, {month}")
    if normalized(row["unit"]) not in {normalized(v) for v in approval["sourceUnits"]}:
        raise ValueError(f"Unreviewed quote unit {mapping['id']}, {month}: {row['unit']}")
    if survey_months(spec) != approval["surveyMonths"]:
        raise ValueError(f"Unreviewed seasonal schedule {mapping['id']}, {month}")
    conversion = approval.get("quantityConversion")
    if conversion is not None:
        # The owner explicitly approved this one historical approximation.
        # It must not become a general permission to infer mass/count ratios.
        if approval.get("quantityConversionHash") != conversion_hash(conversion):
            raise ValueError(f"Unreviewed conversion metadata {mapping['id']}, {month}")
        if not (
                mapping["id"] == "mixed-size-eggs" and mapping["code"] == "1341"
                and "2000-01" <= month <= "2002-06"
                and mapping["unit"] == "count" and approval["quoteUnit"] == "kg"
                and str(approval["quoteQuantity"]) == "1"
                and normalized(spec["unit"]) == "1kg"
                and normalized(spec["definition"]) == "1個約60g"
                and conversion.get("from") == "count" and conversion.get("to") == "kg"
                and conversion.get("factor") == "0.06" and conversion.get("estimated") is True
                and conversion.get("evidenceUrl") == "https://www.stat.go.jp/data/kouri/doukou/zuhyou/200001.xls"
                and all(conversion.get("description", {}).get(language) for language in ["en", "ja"])):
            raise ValueError(f"Unsupported reviewed conversion {mapping['id']}, {month}")
    elif approval["quoteUnit"] != mapping["unit"]:
        raise ValueError(f"Incompatible quote dimension {mapping['id']}, {month}")
    quantity = str(approval["quoteQuantity"])
    if not re.fullmatch(r"(?:0|[1-9]\d*)(?:\.\d{1,6})?", quantity) or not 0 < float(quantity) <= 10000:
        raise ValueError(f"Invalid reviewed quantity {mapping['id']}, {month}")
    if approval["continuityFromPrevious"] and not (
            approval.get("continuityReason") and approval.get("continuityEvidence")):
        raise ValueError(f"Unevidenced continuity {mapping['id']}, {month}")
    return approval


def review_identity(mapping, row, spec, month):
    """Admit only reviewed item names and product forms, including dated aliases."""
    source_name = normalized(row["name"])
    spec_name = normalized(spec["name"])
    names_match = source_name == spec_name
    if mapping.get("sourceName"):
        names_match = (source_name == normalized(mapping["sourceName"])
                       and spec_name == normalized(mapping["specName"]))
    for alias in mapping.get("sourceNameSegments", []):
        if alias["start"] <= month <= alias["end"]:
            names_match = names_match or (
                source_name == normalized(alias["name"])
                and spec_name == normalized(alias["specName"]))
    if not names_match:
        raise ValueError(f"Name mismatch {mapping['code']}, {month}")
    definition = normalized(spec["definition"])
    for term in mapping.get("requiredSpecificationTerms", []):
        if normalized(term) not in definition:
            raise ValueError(f"Unreviewed product form {mapping['code']}, {month}: {term}")
    for alternatives in mapping.get("requiredSpecificationTermGroups", []):
        if not any(normalized(term) in definition for term in alternatives):
            raise ValueError(f"Unreviewed product form {mapping['code']}, {month}: {alternatives}")


def make_fixture(staging, review):
    snapshots = staging["snapshots"]
    start, end = snapshots[0]["month"], snapshots[-1]["month"]
    if review["approvedWindow"] != {"start": start, "end": end}:
        raise ValueError("Staging window differs from the reviewed catalog; review required")
    expected = []
    year, month = map(int, start.split("-"))
    while f"{year:04}-{month:02}" <= end:
        expected.append(f"{year:04}-{month:02}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    if [s["month"] for s in snapshots] != expected:
        raise ValueError("Missing, duplicate, or unordered monthly snapshot")
    mappings = review["products"]
    if len({p["id"] for p in mappings}) != len(mappings):
        raise ValueError("Duplicate reviewed variant ID")
    # One actual source item belongs to exactly one reviewed variant that month.
    # Inactive variants are absent, rather than manufactured null observations.
    codes = {p["code"] for p in mappings}
    for snapshot in snapshots:
        for code in codes:
            matching = [p for p in mappings if p["code"] == code
                        and reviewed_specification(p, snapshot["month"])]
            if len(matching) != 1:
                raise ValueError(f"Missing or overlapping variant review {code}, {snapshot['month']}")
    cities = []
    for city in staging["cities"]:
        covered = [s["month"] for s in snapshots
                   if city["id"] in {r["id"] for r in s["cities"]}]
        names = city.get("names") or {"ja": city["ja"], "en": city.get("en")}
        if not covered or not names.get("en") or not names.get("ja"):
            raise ValueError(f"Unreviewed city identity {city['id']}")
        cities.append({"id": city["id"], "names": names, "start": covered[0],
                       "end": covered[-1], "historical": bool(city.get("historical", False))})
    if len({c["id"] for c in cities}) != len(cities):
        raise ValueError("Duplicate city scope")
    series = {c["id"]: {} for c in cities}
    products, sources, report = [], [], []
    checked_hashes = set()
    for snapshot in snapshots:
        for source in [*snapshot["sources"], snapshot["specSource"]]:
            if source["sha256"] not in checked_hashes:
                raw = ROOT / "data/raw/recent" / source["sha256"]
                if hashlib.sha256(raw.read_bytes()).hexdigest() != source["sha256"]:
                    raise ValueError("Source hash failed")
                checked_hashes.add(source["sha256"])
        sources.extend(snapshot["sources"])
        sources.append({**snapshot["specSource"], "id": snapshot["month"] + "-specifications",
                        "category": "specifications"})
    missing_tokens = set(review["reviewedMissingTokens"])
    for mapping in mappings:
        code = mapping["code"]
        if mapping.get("missingPriceEstimate") is not None and not (
                code == "1341" and mapping["id"] == "mixed-size-eggs"
                and mapping["missingPriceEstimate"] == {
                    "maxMonths": 2, "tokens": ["-"], "allowEquivalentSegments": True}):
            raise ValueError(f"Unreviewed missing-price estimate rule {mapping['id']}")
        segments, all_rows = [], []
        last_approval = None
        for snapshot in snapshots:
            period = snapshot["month"]
            approval = reviewed_specification(mapping, period)
            if approval is None:
                continue
            rows = [r for r in snapshot["prices"] if r["code"] == code]
            if len(rows) != 1 or code not in snapshot["specs"]:
                raise ValueError(f"Missing or duplicate item {code}, {period}")
            row, spec = rows[0], snapshot["specs"][code]
            review_identity(mapping, row, spec, period)
            validate_reviewed_specification(mapping, row, spec, period)
            if approval is not last_approval:
                segments.append({
                    "id": f"{mapping['id']}:{period}", "start": period, "end": period,
                    "definition": spec["definition"] or "", "detail": spec["detail"] or "",
                    "specificationName": spec["name"], "specificationUnit": str(spec["unit"] or ""),
                    "sourceUrl": snapshot["specSource"]["url"], "surveyMonths": approval["surveyMonths"],
                    "quoteQuantity": approval["quoteQuantity"], "quoteUnit": approval["quoteUnit"],
                    "quoteLabel": approval["quoteLabel"], "sourceUnit": str(row["unit"]),
                    "continuityFromPrevious": bool(segments) and approval["continuityFromPrevious"],
                    "continuityReason": approval["continuityReason"],
                    "continuityEvidence": approval["continuityEvidence"],
                    "reviewHash": approval["specificationHash"],
                })
                if approval.get("quantityConversion") is not None:
                    segments[-1]["quantityConversion"] = approval["quantityConversion"]
                last_approval = approval
            segments[-1]["end"] = period
            all_rows.append((snapshot, row, segments[-1]))
        if not all_rows:
            raise ValueError(f"Reviewed variant has no admitted months: {mapping['id']}")
        units = ["kg", "g"] if mapping["unit"] == "kg" else ["L", "mL"] if mapping["unit"] == "L" else [mapping["unit"]]
        latest = segments[-1]
        products.append({
            "id": mapping["id"], "familyId": mapping.get("familyId", mapping["id"]),
            "variantId": mapping["id"], "code": code,
            "names": {"en": mapping["en"], "ja": mapping.get("ja", all_rows[-1][1]["name"])},
            "aliases": mapping["aliases"], "category": "food" if int(code) < 3000 else "household",
            "unit": mapping["unit"], "quoteQuantity": latest["quoteQuantity"],
            "quoteLabel": latest["quoteLabel"], "units": units,
            "presets": mapping["presets"], "segments": segments,
        })
        for field in ["selectable", "comparisonNote", "missingPriceEstimate"]:
            if field in mapping:
                products[-1][field] = mapping[field]
        counts = Counter()
        for city in cities:
            observations = []
            for snapshot, row, segment in all_rows:
                if not city["start"] <= snapshot["month"] <= city["end"]:
                    continue
                raw = row["values"].get(city["id"])
                status, price = "unavailable", None
                if city["id"] not in row["values"]:
                    status = "not-surveyed"
                elif isinstance(raw, (int, float)) and not isinstance(raw, bool) and raw > 0:
                    status, price = "observed", str(int(raw)) if raw == int(raw) else str(raw)
                elif isinstance(raw, (int, float, bool)):
                    raise ValueError(f"Invalid numeric price {code}, {city['id']}, {snapshot['month']}: {raw!r}")
                elif re.fullmatch(r"Y(?:\s*\d+(?:\.\d+)?)?", str(raw).strip()):
                    status = "local-spec"
                elif normalized(raw) in missing_tokens:
                    # No dated legend establishes the older two-dot token's
                    # cause. A seasonal calendar alone cannot redefine it.
                    if (normalized(raw) in {"...", "…"}
                            and int(snapshot["month"][5:]) not in segment["surveyMonths"]):
                        status = "seasonal"
                else:
                    raise ValueError(f"Unexpected price token {code}, {city['id']}, {snapshot['month']}: {raw!r}")
                location = row.get("locations", {}).get(city["id"], {})
                observation = {
                    "month": snapshot["month"], "price": price, "status": status,
                    "segmentId": segment["id"], "sourceId": row["sourceId"], "raw": raw,
                    "sourceRow": location.get("row", row["row"]), "sourceSheet": row["sheet"],
                    "sourceUnit": row["unit"],
                    "sourceRevision": None if row["revision"] is None else str(row["revision"]),
                }
                if "column" in location:
                    observation["sourceColumn"] = location["column"]
                observations.append(observation)
            if any(len(s["surveyMonths"]) < 12 for s in segments) and not any(
                    o["status"] == "observed" for o in observations):
                for observation in observations:
                    if observation["status"] == "seasonal":
                        observation["status"] = "not-surveyed"
            series[city["id"]][mapping["id"]] = observations
            counts.update(o["status"] for o in observations)
        report.append({"id": mapping["id"], "code": code, "activeMonths": len(all_rows),
                       "segments": segments, "counts": dict(counts)})
    fixture = {
        "schemaVersion": 1, "policyVersion": review.get("policyVersion", "1.0"), "start": start, "end": end,
        "builtAt": max(s["retrievedAt"] for s in sources),
        "sourceName": {"en": "Statistics Bureau of Japan · Retail Price Survey (Trend)",
                       "ja": "総務省統計局 · 小売物価統計調査（動向編）"},
        "cities": cities, "products": products, "sources": sources, "series": series,
    }
    return fixture, report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-reviewed", action="store_true")
    args = parser.parse_args()
    staging = json.loads((ROOT / "data/staging/recent.json").read_text(encoding="utf-8"))
    review = json.loads((ROOT / "data/catalog-review.json").read_text(encoding="utf-8"))
    fixture, report = make_fixture(staging, review)
    report_path = ROOT / "data/staging/review-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    for r in report:
        print(r["code"], r["id"], "segments", len(r["segments"]), r["counts"])
    if args.export_reviewed:
        folder = ROOT / "data/fixtures"
        folder.mkdir(parents=True, exist_ok=True)
        payload = gzip.compress(canonical(fixture), mtime=0)
        (folder / "recent-approved.json.gz").write_bytes(payload)
        (folder / "recent-approved.manifest.json").write_bytes(canonical({
            "sha256": hashlib.sha256(payload).hexdigest(), "reviewedAt": review["reviewedAt"],
            "cityCount": len(fixture["cities"]), "productCount": len(fixture["products"]),
            "start": fixture["start"], "end": fixture["end"], "report": report}))
