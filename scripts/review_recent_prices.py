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
    english = ["Sapporo", "Hakodate", "Asahikawa", "Aomori", "Hachinohe", "Morioka",
               "Sendai", "Akita", "Yamagata", "Fukushima", "Koriyama", "Mito", "Hitachi",
               "Utsunomiya", "Oyama", "Maebashi", "Saitama", "Kumagaya", "Kawaguchi",
               "Tokorozawa", "Chiba", "Kashiwa", "Urayasu", "Tokyo special wards",
               "Hachioji", "Tachikawa", "Fuchu", "Yokohama", "Kawasaki", "Sagamihara",
               "Fujisawa", "Niigata", "Nagaoka", "Toyama", "Kanazawa", "Fukui", "Kofu",
               "Nagano", "Matsumoto", "Gifu", "Shizuoka", "Hamamatsu", "Fuji", "Nagoya",
               "Toyohashi", "Tsu", "Matsusaka", "Otsu", "Kyoto", "Osaka", "Sakai",
               "Hirakata", "Higashiosaka", "Kobe", "Himeji", "Nishinomiya", "Itami",
               "Nara", "Wakayama", "Tottori", "Matsue", "Okayama", "Hiroshima",
               "Fukuyama", "Yamaguchi", "Ube", "Tokushima", "Takamatsu", "Matsuyama",
               "Imabari", "Kochi", "Fukuoka", "Kitakyushu", "Saga", "Nagasaki",
               "Sasebo", "Kumamoto", "Oita", "Miyazaki", "Kagoshima", "Naha"]
    cities = []
    for c, label in zip(staging["cities"], english, strict=True):
        first = next(s["month"] for s in snapshots if c["id"] in {r["id"] for r in s["cities"]})
        cities.append({"id": c["id"], "names": {"ja": c["ja"], "en": label}, "start": first, "end": end})
    series = {c["id"]: {} for c in cities}
    products, sources, report = [], [], []
    for s in snapshots:
        for source in s["sources"]:
            raw = ROOT / "data/raw/recent" / source["sha256"]
            if hashlib.sha256(raw.read_bytes()).hexdigest() != source["sha256"]:
                raise ValueError("Source hash failed")
            sources.append(source)
        raw_spec = ROOT / "data/raw/recent" / s["specSource"]["sha256"]
        if hashlib.sha256(raw_spec.read_bytes()).hexdigest() != s["specSource"]["sha256"]:
            raise ValueError("Specification hash failed")
        sources.append({**s["specSource"], "id": s["month"] + "-specifications", "category": "specifications"})
    for mapping in review["products"]:
        code = mapping["code"]
        segments, signatures = [], []
        all_rows = []
        for s in snapshots:
            rows = [r for r in s["prices"] if r["code"] == code]
            if len(rows) != 1 or code not in s["specs"]:
                raise ValueError(f"Missing or duplicate item {code}, {s['month']}")
            row, spec = rows[0], s["specs"][code]
            review_identity(mapping, row, spec, s["month"])
            if code in {"1001", "1303", "1341"}:
                expected_source, expected_spec, quantity_term = {
                    "1001": ("1袋・5kg", "1袋", "5kg入り"),
                    "1303": ("1本・1000mL", "1本", "1000mL入り"),
                    "1341": ("1パック・10個", "1パック", "10個入り"),
                }[code]
                if (normalized(row["unit"]).replace("･", "・").replace(",", "") != expected_source
                        or normalized(spec["unit"]) != expected_spec
                        or quantity_term not in normalized(spec["definition"]).replace(",", "")):
                    raise ValueError(f"Unreviewed quoted quantity {code}: {row['unit']}")
            elif mapping["unit"] == "kg":
                expected = "1袋・1kg" if code == "1632" else "1kg"
                # e-Stat uses U+FF65 in the sugar package unit; normalization
                # yields a middle dot. The reviewed bag contains exactly 1 kg.
                if normalized(row["unit"]).replace("･", "・") != expected:
                    raise ValueError(f"Unreviewed quote unit {code}: {row['unit']}")
                if normalized(spec["unit"]) != ("1袋" if code == "1632" else "1kg"):
                    raise ValueError(f"Unreviewed specification unit {code}")
            elif code == "4401" and normalized(row["unit"]) != "1本":
                raise ValueError(f"Unreviewed package {code}: {row['unit']}")
            elif code == "4431":
                quantity = normalized(row["unit"]).replace("･", "・")
                reviewed = {f"1本・{v}mL" for v in mapping["reviewedRefillVolumesML"]}
                if quantity not in reviewed or quantity.split("・")[1] not in normalized(spec["definition"]):
                    raise ValueError(f"Unreviewed package {code}: {row['unit']}")
            schedule = mapping.get("surveyMonths", list(range(1, 13)))
            expected_schedule = {"1511": "1月~3月,9月~12月", "1572": "6月~7月"}.get(code, "")
            if normalized(spec["months"]).replace("～", "~").replace("、", ",") != expected_schedule:
                raise ValueError(f"Unreviewed seasonal schedule {code}: {spec['months']}")
            signature = tuple(normalized(spec[k]) for k in ["name", "definition", "detail", "unit", "months"])
            if not signatures or signature != signatures[-1]:
                if segments:
                    segments[-1]["end"] = all_rows[-1][0]["month"]
                segments.append({"id": f"{mapping['id']}:{s['month']}", "start": s["month"], "end": end,
                                 "definition": spec["definition"] or "", "detail": spec["detail"] or "",
                                 "sourceUrl": s["specSource"]["url"], "surveyMonths": schedule,
                                 "continuityFromPrevious": False})
            signatures.append(signature)
            all_rows.append((s, row, segments[-1]["id"]))
        units = ["kg", "g"] if mapping["unit"] == "kg" else ["L", "mL"] if mapping["unit"] == "L" else [mapping["unit"]]
        products.append({"id": mapping["id"], "familyId": mapping["id"], "variantId": mapping["id"],
                         "code": code, "names": {"en": mapping["en"], "ja": all_rows[-1][1]["name"]},
                         "aliases": mapping["aliases"], "category": "food" if int(code) < 3000 else "household",
                         "unit": mapping["unit"], "quoteQuantity": mapping["quoteQuantity"],
                         "quoteLabel": {"en": mapping.get("quoteLabelEn", (
                             f"{mapping['quoteQuantity']} {mapping['unit']}" if mapping["unit"] in {"kg", "L"}
                             else "1 roll" if code == "4401" else "1 specified refill")),
                                        "ja": ("1本（期間ごとの指定容量）" if code == "4431" else all_rows[-1][1]["unit"])},
                         "units": units, "presets": mapping["presets"], "segments": segments})
        counts = Counter()
        for city in cities:
            observations = []
            for s, row, segment_id in all_rows:
                raw = row["values"].get(city["id"])
                status, price = "unavailable", None
                if city["id"] not in row["values"]:
                    status = "not-surveyed"
                elif isinstance(raw, (int, float)) and not isinstance(raw, bool) and raw > 0:
                    status, price = "observed", str(int(raw)) if raw == int(raw) else str(raw)
                elif "Y" in str(raw):
                    status = "local-spec"
                elif normalized(raw) in ("...", "…") and int(s["month"][5:]) not in schedule:
                    # All selected seasonal items have observations in each
                    # admitted city during this window; checked below.
                    status = "seasonal"
                elif normalized(raw) not in {"...", "…", "-"}:
                    raise ValueError(f"Unexpected price token {code}, {city['id']}, {s['month']}: {raw!r}")
                observations.append({"month": s["month"], "price": price, "status": status,
                                     "segmentId": segment_id, "sourceId": row["sourceId"], "raw": raw,
                                     "sourceRow": row["row"], "sourceSheet": row["sheet"],
                                     "sourceUnit": row["unit"],
                                     "sourceRevision": None if row["revision"] is None else str(row["revision"])})
            if mapping.get("surveyMonths") and not any(o["status"] == "observed" for o in observations):
                for o in observations:
                    if o["status"] == "seasonal":
                        o["status"] = "not-surveyed"
            series[city["id"]][mapping["id"]] = observations
            counts.update(o["status"] for o in observations)
        report.append({"id": mapping["id"], "code": code, "segments": segments, "counts": dict(counts)})
    fixture = {"schemaVersion": 1, "policyVersion": "1.0", "start": start, "end": end,
               "builtAt": max(s["retrievedAt"] for s in sources),
               "sourceName": {"en": "Statistics Bureau of Japan · Retail Price Survey (Trend)",
                              "ja": "総務省統計局 · 小売物価統計調査（動向編）"},
               "cities": cities, "products": products, "sources": sources, "series": series}
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
