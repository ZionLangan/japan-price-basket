"""Print selected raw rows for manual review of the public-download pilot."""
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / "data" / "audit" / "2026-10-05"
CODES = {1001, 1071, 1303, 1341, 1401, 1402, 1412, 1415, 1417, 1601, 1611, 1501, 4413, 4441}

for stem in ["rps_specs_2000", "rps_specs_2026"]:
    doc = json.loads((AUDIT / f"{stem}.extracted.json").read_text(encoding="utf-8"))
    for sheet in doc["sheets"]:
        rows = sheet["nonempty_rows"]
        for i, row in enumerate(rows):
            vals = row["values"]
            if any(isinstance(v, (int, float)) and v in CODES for v in vals[:3]):
                print(stem, json.dumps(rows[i:i+3], ensure_ascii=False))

for stem in ["rps_jan2000_city_a", "rps_jan2000_city_b"]:
    doc = json.loads((AUDIT / f"{stem}.extracted.json").read_text(encoding="utf-8"))
    codes = {}
    for row in doc["sheets"][0]["nonempty_rows"]:
        vals = row["values"]
        found = {col: int(m.group(1)) for col, v in enumerate(vals)
                 if isinstance(v, str) and (m := re.fullmatch(r"\((\d{4})\)", v.strip()))}
        if found:
            codes = found
        if "東京都区部" in str(vals[7]):
            for col, code in codes.items():
                if code in CODES:
                    print(stem, "row", row["row"], "col", col+1, "code", code, "value", vals[col])

for stem in ["rps_food_sep2026_tokyo", "rps_household_sep2026_tokyo"]:
    doc = json.loads((AUDIT / f"{stem}.extracted.json").read_text(encoding="utf-8"))
    rows = doc["sheets"][0]["nonempty_rows"]
    code_row = next(r for r in rows if "銘柄符号" in r["values"])
    for col, v in enumerate(code_row["values"]):
        if str(v) in {str(c) for c in CODES}:
            print(stem, "col", col+1, "code", v,
                  json.dumps([{ "row": r["row"], "labels": r["values"][7:12], "value": r["values"][col] }
                              for r in rows if r["row"] >= code_row["row"]], ensure_ascii=False))
