"""Read original RPS XLS cells without deciding city or product continuity.

The acquisition adapter applies a separately reviewed dated geography resolver.
All labels, unit-header fragments and price tokens remain source evidence.
"""

import re
import unicodedata

import xlrd


MONTHS = {name: number for number, name in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"], 1)}


def normalized(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value or "")))


def period_value(value):
    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    match = re.fullmatch(r"(?:(平成|令和|昭和)(元|\d+)|(\d{4}))年\s*(\d{1,2})月(?:分)?", text)
    if match:
        era, year, gregorian, month = match.groups()
        year = int(gregorian) if gregorian else {"平成": 1988, "令和": 2018, "昭和": 1925}[era] + (1 if year == "元" else int(year))
        return f"{year:04}-{int(month):02}"
    match = re.fullmatch(r"([A-Za-z]+)\s+(\d{4})", text)
    if match and match[1] in MONTHS:
        return f"{int(match[2]):04}-{MONTHS[match[1]]:02}"
    return None


def check_period(rows, month):
    evidence = [str(value) for row in rows for value in row if period_value(value)]
    if not evidence:
        raise ValueError(f"No explicit workbook period for {month}")
    if any(period_value(value) != month for value in evidence):
        raise ValueError(f"Unexpected workbook period for {month}: {evidence}")
    return evidence


def integer_code(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value == int(value):
        value = str(int(value))
    return str(value) if re.fullmatch(r"\d{4}", str(value)) else None


def city_ordinal(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, str) and re.fullmatch(r"\d{1,3}", value.strip()):
        return int(value)
    if isinstance(value, (int, float)) and value == int(value) and value > 0:
        return int(value)
    return None


def parse_wide(sheet, month, selected_codes):
    rows = [sheet.row_values(i) for i in range(sheet.nrows)]
    header_index = next((i for i, row in enumerate(rows) if "銘柄符号" in row), None)
    if header_index is None:
        raise ValueError("No legacy wide item-code header")
    code_column = rows[header_index].index("銘柄符号")
    header = rows[header_index]
    labels = rows[header_index + 1]
    positions = [(i, ordinal, str(labels[i])) for i, value in enumerate(header)
                 if i > code_column + 3 and (ordinal := city_ordinal(value)) is not None]
    if [number for _, number, _ in positions] != list(range(1, len(positions) + 1)):
        raise ValueError("Broken legacy wide city-number sequence")
    if not positions or any(not normalized(label) for _, _, label in positions):
        raise ValueError("Missing legacy city headers")
    first_data = next((i for i in range(header_index + 1, len(rows))
                       if integer_code(rows[i][code_column])), None)
    if first_data is None:
        raise ValueError("No legacy wide price records")
    evidence = check_period(rows[:first_data], month)
    cities = [{"rawLabel": label, "number": number} for _, number, label in positions]
    result, seen = [], set()
    for index in range(first_data, len(rows)):
        row = rows[index]
        code = integer_code(row[code_column])
        if not code or selected_codes is not None and code not in selected_codes:
            continue
        if code in seen:
            raise ValueError(f"Duplicate legacy wide item {code}, {month}")
        seen.add(code)
        result.append({"code": code, "name": row[code_column + 1],
                       "unit": row[code_column + 2], "revision": row[code_column + 3],
                       "row": index + 1, "sheet": sheet.name, "format": "legacy-wide-xls",
                       "periodEvidence": evidence,
                       "values": {label: row[column] for column, _, label in positions},
                       "locations": {label: {"row": index + 1, "column": column + 1}
                                     for column, _, label in positions}})
    return cities, result


def printed_unit(rows, start, end, column, code, city_column):
    candidates = []
    english_start = next((i for i in range(start, end)
                          if normalized(rows[i][city_column]).lower() == "cities"), end)
    for index in range(start, end):
        text = str(rows[index][column] or "")
        if not re.match(r"^[（(]\s*\d", unicodedata.normalize("NFKC", text)):
            continue
        fragments, locations = [text], [{"row": index + 1, "column": column + 1}]
        cursor = index
        while ")" not in unicodedata.normalize("NFKC", "".join(fragments)) and cursor + 1 < end:
            cursor += 1
            if rows[cursor][column]:
                fragments.append(str(rows[cursor][column]))
                locations.append({"row": cursor + 1, "column": column + 1})
        joined = "".join(fragments)
        if ")" in unicodedata.normalize("NFKC", joined):
            english_count = re.match(r"^[（(]\s*\d+(?:\.\d+)?\s*(?:packs?|pieces?|rolls?|bags?|bottles?|boxes|box|eggs?)\b",
                                     unicodedata.normalize("NFKC", joined), re.I)
            # In the January 2000 rice columns the Japanese quantity wraps
            # onto the same row as the shared English Cities label.
            candidates.append((joined, locations, index <= english_start and not english_count))
    primary = [candidate for candidate in candidates if candidate[2]]
    # Some old headers print their sole physical quantity beneath Cities.
    # Preserve it verbatim; admitting its meaning is the later catalog review.
    if not primary and len(candidates) == 1:
        primary = candidates
    # These two printed food headers split package count and its contents into
    # adjacent parentheticals. Both fragments and their cells are evidence.
    if len(primary) == 2 and code in {"1161", "1331"}:
        first, second = primary
        if second[1][0]["row"] == first[1][-1]["row"] + 1:
            primary = [(first[0] + second[0], first[1] + second[1], True)]
    if len(primary) != 1:
        raise ValueError(f"Ambiguous printed quote unit {code}: {[x[0] for x in candidates]}")
    unit, locations, _ = primary[0]
    alternatives = [{"text": text, "locations": cells} for text, cells, is_primary in candidates
                    if not is_primary]
    return unit, locations, alternatives


def parse_printed(sheet, month, selected_codes):
    rows = [sheet.row_values(i) for i in range(sheet.nrows)]
    blocks = []
    for index, row in enumerate(rows):
        codes = {column: match[1] for column, value in enumerate(row)
                 if (match := re.fullmatch(r"\((\d{4})\)", str(value).strip()))}
        if codes:
            blocks.append((index, codes))
    if not blocks:
        raise ValueError("No printed item-code blocks")
    roster, result, seen = None, [], set()
    for number, (index, codes) in enumerate(blocks):
        end = blocks[number + 1][0] if number + 1 < len(blocks) else len(rows)
        city_headers = {column for header in rows[index + 1:min(index + 12, end)]
                        for column, value in enumerate(header) if normalized(value) == "都市"}
        if len(city_headers) != 1:
            raise ValueError(f"Ambiguous printed city-label header at {index + 1}")
        city_column = next(iter(city_headers))
        entries = []
        for row_number in range(index + 1, end):
            raw = str(rows[row_number][city_column] or "")
            match = re.fullmatch(r"\s*(\d{1,3})\s+(.+?)\s*", raw)
            if match and re.search(r"[一-龯ぁ-んァ-ヶ]", match[2]):
                entries.append((row_number, int(match[1]), match[2]))
        if not entries:
            raise ValueError(f"Printed block has no numbered city rows at {index + 1}")
        numbers = [city_number for _, city_number, _ in entries]
        if numbers != list(range(1, len(entries) + 1)):
            raise ValueError(f"Broken printed city-number sequence at {index + 1}: {numbers}")
        cities = [{"rawLabel": label, "number": city_number} for _, city_number, label in entries]
        if roster is not None and cities != roster:
            raise ValueError(f"Inconsistent printed city roster at {index + 1}")
        roster = cities
        first_data = entries[0][0]
        evidence = check_period(rows[index + 1:first_data], month)
        for column, code in codes.items():
            if selected_codes is not None and code not in selected_codes:
                continue
            if code in seen:
                raise ValueError(f"Duplicate printed item {code}, {month}")
            seen.add(code)
            unit, unit_locations, alternatives = printed_unit(
                rows, index + 1, first_data, column, code, city_column)
            result.append({"code": code, "name": rows[index + 1][column], "unit": unit,
                           "headerText": [rows[i][column] for i in range(index + 1, first_data)],
                           "unitLocations": unit_locations, "alternateUnitHeaders": alternatives,
                           "revision": None,
                           "row": index + 1, "sheet": sheet.name, "format": "printed-block-xls",
                           "periodEvidence": evidence,
                           "values": {label: rows[row_number][column] for row_number, _, label in entries},
                           "locations": {label: {"row": row_number + 1, "column": column + 1}
                                         for row_number, _, label in entries}})
    return roster, result


def read_legacy_prices(data, month, selected_codes=None):
    book = xlrd.open_workbook(file_contents=data)
    try:
        if book.nsheets != 1:
            raise ValueError("Unreviewed multiple-sheet legacy price workbook")
        sheet = book.sheet_by_index(0)
        if sheet.ncols > 50:
            return parse_wide(sheet, month, selected_codes)
        return parse_printed(sheet, month, selected_codes)
    finally:
        book.release_resources()
