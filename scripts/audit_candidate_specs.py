"""Read-only dated definition audit of the two grocery expansion shortlists.

Requires the retained operator archive; never admits products or changes prices.
Fingerprint transitions are textual changes, not automatic comparison breaks.
"""

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_recent_prices import read_specs
from scripts.review_recent_prices import normalized, specification_hash, survey_months


def audit(report_path):
    report = json.loads(report_path.read_text(encoding="utf-8"))
    recent = {r["code"] for r in report["metadataStableUnreviewedRecentCandidates"]
              if r["numericInAllCitiesEveryScheduledMonth"]}
    historical = {r["code"] for r in report["unreviewedSingleFingerprintEveryHistoricalMonth"]}
    codes = recent | historical
    manifest = json.loads((ROOT / "data/staging/history-source-manifest.json").read_text(encoding="utf-8"))
    monthly = [s for s in manifest["months"] if s["month"] <= report["month"]]
    cache = {}
    records = {c: [] for c in sorted(codes)}
    for snapshot in monthly:
        receipt = snapshot["specSource"]
        digest = receipt["sha256"]
        if digest not in cache:
            evidence = (ROOT / "data/raw/recent" / digest).read_bytes()
            if hashlib.sha256(evidence).hexdigest() != digest or len(evidence) != receipt["bytes"]:
                raise ValueError(f"Source checksum/length mismatch: {receipt['url']}")
            cache[digest] = read_specs(evidence, codes)
        for code, spec in cache[digest].items():
            records[code].append({"month": snapshot["month"], "spec": spec,
                                  "fingerprint": specification_hash(spec), "source": receipt})
    result = []
    fields = ["name", "definition", "detail", "unit", "months"]
    for code, dates in records.items():
        transitions = []
        for before, after in zip(dates, dates[1:]):
            if before["fingerprint"] == after["fingerprint"]:
                continue
            changed = {field: {"before": before["spec"].get(field),
                               "after": after["spec"].get(field)} for field in fields
                       if normalized(before["spec"].get(field)) != normalized(after["spec"].get(field))}
            transitions.append({"month": after["month"], "changedFields": changed,
                                "source": after["source"]})
        last_fingerprint = dates[-1]["fingerprint"]
        suffix = dates[-1]["month"]
        for date in reversed(dates):
            if date["fingerprint"] != last_fingerprint:
                break
            suffix = date["month"]
        missing = [s["month"] for s in monthly if s["month"] not in {d["month"] for d in dates}]
        result.append({"code": code, "recentCompleteShortlist": code in recent,
                       "unchangedSince2000Shortlist": code in historical,
                       "definitionMonths": len(dates), "firstDefinitionMonth": dates[0]["month"],
                       "missingDefinitionMonths": missing, "latestDefinitionUnchangedSince": suffix,
                       "fingerprints": len({d["fingerprint"] for d in dates}),
                       "firstDefinition": dates[0], "currentDefinition": dates[-1],
                       "currentSurveyMonths": survey_months(dates[-1]["spec"]),
                       "transitions": transitions})
    return {"cutoff": report["month"], "historicalMonths": len(monthly),
            "recentComplete": len(recent), "unchangedSince2000": len(historical),
            "overlap": sorted(recent & historical), "distinctCandidates": len(codes),
            "firstDefinitionCounts": dict(Counter(r["firstDefinitionMonth"] for r in result)),
            "candidates": result}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    result = audit(ROOT / "tmp/grocery-catalog-audit.json")
    print(json.dumps(result, ensure_ascii=False, indent=2))
