"""Construct the owner-authorized generic-food review from dated source evidence.

This command never downloads data or writes a fixture. It admits only the 69
audited candidate codes, retains materially different forms, and uses exact
physical quantities. An existing review is the fingerprint allowlist on reruns;
an unexpected definition therefore still needs an operator review.
"""

import argparse
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.review_recent_prices import normalized, specification_hash, survey_months

AUDITED_END = "2026-08"
OWNER_DECISION = "Owner generic-food comparison decision, 2026-10-10"
CONTINUITY_REASON = (
    "Owner-authorized comparison of the same generic food across dated brand, "
    "grade, packaging, size-selection and wording changes. Native prices and "
    "definitions are preserved; exact dated quantities are normalized. This "
    "nominal basket series is not a quality-adjusted official inflation index."
)
GENERIC_NOTE = {
    "en": "Survey brands, grades or definitions can change over time. Quantities "
          "are normalized where exact; this is a generic food-price comparison, "
          "not a quality-adjusted inflation index.",
    "ja": "調査対象の銘柄・等級・定義は時期により変わります。正確に換算できる数量は"
          "統一しています。一般的な食品の価格比較であり、品質調整済みの物価指数ではありません。",
}
PACKAGE_NOTE = {
    "en": "Compared per surveyed package. Permitted contents vary and no exact "
          "weight conversion is established; changes can include package size.",
    "ja": "調査対象の１包装当たりで比較します。内容量には幅があり、正確な重量換算は"
          "できません。価格の変化には包装の内容量の変化も含まれます。",
}

# Code | stable ID | English | Japanese | preferred dimension | extra aliases.
# Product identity and the exceptional dates below are reviewed decisions, not
# generated translations or a rule admitting arbitrary future source items.
PRODUCT_ROWS = """
1022|anpan|Anpan / red-bean bun|あんパン|kg|bread,あんぱん,あずき
1023|curry-bread|Curry bread|カレーパン|kg|bread,かれーぱん
1051|cup-noodles|Cup noodles|カップ麺|kg|instant noodles,かっぷめん
1071|cake-flour|Wheat flour / cake flour|小麦粉（薄力粉）|kg|flour,こむぎこ,はくりきこ
1111|yellowtail-slices|Yellowtail slices|ぶり（切り身）|kg|fish,ブリ,鰤
1131|asari-clams|Asari clams, shell-on|あさり（殻付き）|kg|fish,clam,アサリ
1141|salted-salmon|Salted salmon|塩さけ|kg|fish,しおざけ,塩鮭
1143|dried-whitebait|Dried whitebait|しらす干し|kg|fish,しらす,シラス
1146|dried-anchovies|Dried anchovies|煮干し|kg|fish,にぼし,いりこ
1151|satsuma-age|Satsuma-age / fried fish cakes|揚げかまぼこ（さつま揚げ）|kg|fish cake,さつまあげ
1152|chikuwa|Chikuwa / grilled fish cakes|ちくわ|kg|fish cake,竹輪
1153|kamaboko|Kamaboko / steamed fish cake|かまぼこ|kg|fish cake,蒲鉾
1201|beef-loin|Beef loin|牛肉（ロース）|kg|meat,ぎゅうにく,ビーフ
1221|chicken-thigh|Chicken thigh|鶏もも肉|kg|meat,chicken,とりにく,鶏肉
1252|loin-ham|Loin ham|ロースハム|kg|meat,ハム,はむ
1261|vienna-sausages|Vienna sausages|ウインナーソーセージ|kg|meat,sausage,ウィンナー
1321|butter|Butter|バター|kg|dairy,ばたー
1402|spinach|Spinach|ほうれんそう|kg|vegetable,ほうれん草,ホウレンソウ
1403|chinese-cabbage|Chinese cabbage|はくさい|kg|vegetable,白菜,ハクサイ
1405|negi|Negi / Japanese leek|ねぎ|kg|vegetable,leek,葱,ネギ
1406|head-lettuce|Head lettuce|レタス|kg|vegetable,lettuce,れたす
1416|burdock-root|Burdock root|ごぼう|kg|vegetable,ゴボウ,牛蒡
1419|lotus-root|Lotus root|れんこん|kg|vegetable,レンコン,蓮根
1420|nagaimo|Nagaimo / Japanese yam|ながいも|kg|vegetable,長芋,ナガイモ
1432|green-beans|Green beans|さやいんげん|kg|vegetable,いんげん,インゲン
1433|pumpkin|Pumpkin|かぼちゃ|kg|vegetable,カボチャ,南瓜
1435|eggplant|Eggplant|なす|kg|vegetable,aubergine,ナス,茄子
1437|green-peppers|Green peppers|ピーマン|kg|vegetable,pepper,ぴーまん
1438|fresh-shiitake|Fresh shiitake mushrooms|生しいたけ|kg|vegetable,mushroom,しいたけ,椎茸
1442|enoki|Enoki mushrooms|えのきたけ|kg|vegetable,mushroom,えのき,エノキ
1443|buna-shimeji|Buna-shimeji mushrooms|しめじ|kg|vegetable,mushroom,ぶなしめじ,シメジ
1453|dried-shiitake|Dried shiitake mushrooms|干ししいたけ|kg|mushroom,干し椎茸,ほししいたけ
1461|roasted-nori|Roasted nori sheets|焼きのり|count|seaweed,のり,海苔,ノリ
1463|stock-kombu|Kombu / kelp for stock|こんぶ（だし用）|kg|seaweed,kelp,昆布,コンブ
1471|momen-tofu|Momen tofu|木綿豆腐|kg|tofu,とうふ,豆腐,もめん
1472|aburaage|Aburaage / fried tofu|油揚げ|kg|tofu,あぶらあげ,あげ
1473|natto-three-pack|Natto, three-pack|納豆（３個入り）|package|soybeans,なっとう,ナットウ
1481|konnyaku|Konnyaku blocks|こんにゃく|kg|konjac,コンニャク,蒟蒻
1482|umeboshi|Umeboshi / pickled plums|梅干し|kg|pickle,うめぼし,ウメボシ
1483|takuan|Takuan / pickled daikon|たくあん漬|kg|pickle,だいこん漬,タクアン
1485|kombu-tsukudani|Kombu tsukudani|こんぶつくだ煮|kg|seaweed,昆布佃煮,つくだに
1486|pickled-chinese-cabbage|Salt-pickled Chinese cabbage|はくさい漬|kg|pickle,白菜漬け,はくさいづけ
1531|delaware-grapes|Delaware grapes|ぶどう（デラウェア）|kg|fruit,grape,デラウェア,葡萄
1532|kyoho-grapes|Kyoho grapes|ぶどう（巨峰）|kg|fruit,grape,きょほう,巨峰
1541|persimmons|Persimmons|柿|kg|fruit,かき,カキ
1551|peaches|Peaches|桃|kg|fruit,もも,モモ
1563|melons|Melons|メロン|kg|fruit,めろん
1571|strawberries|Strawberries|いちご|kg|fruit,strawberry,イチゴ,苺
1602|margarine|Margarine / fat spread|マーガリン|kg|spread,まーがりん
1631|miso|Miso|みそ|kg|seasoning,味噌,ミソ
1641|japanese-sauce|Japanese brown sauce|ソース|L|seasoning,sauce,ウスターソース,そーす
1713|cream-puffs|Cream puffs|シュークリーム|kg|sweets,choux,しゅーくりーむ
1721|marie-biscuits|Marie biscuits|ビスケット|kg|sweets,biscuit,びすけっと
1732|throat-lozenge-bag|Throat lozenges, bag|のど飴（袋）|package|sweets,candy,キャンデー,あめ
1741|senbei|Senbei / rice crackers|せんべい|kg|sweets,rice cracker,煎餅,センベイ
1781|sugarless-gum|Sugarless chewing gum|シュガーレスガム|package|sweets,chewing gum,ガム,がむ
1782|vanilla-ice-cream|Vanilla ice cream|バニラアイスクリーム|L|dairy,sweets,ice cream,あいすくりーむ
1784|fruit-jelly|Fruit jelly|フルーツゼリー|kg|sweets,jelly,ゼリー,ぜりー
1793|salmon-onigiri|Salmon onigiri|鮭おにぎり|count|prepared food,rice ball,おにぎり,おむすび
1811|potato-salad|Potato salad|ポテトサラダ|kg|prepared food,salad,ぽてとさらだ
1821|potato-croquettes|Potato croquettes|コロッケ|kg|prepared food,croquette,ころっけ
1902|sencha|Green tea / sencha|緑茶（煎茶）|kg|drink,tea,せんちゃ,りょくちゃ,緑茶
1921|instant-coffee|Instant coffee|インスタントコーヒー|kg|drink,coffee,こーひー
2003|sake|Sake|清酒|L|alcohol,にほんしゅ,日本酒,さけ
2011|single-distilled-shochu|Single-distilled shochu|本格焼酎|L|alcohol,しょうちゅう,焼酎
2012|chu-hai|Canned chu-hai|チューハイ|L|alcohol,chuhai,ちゅーはい
2021|beer|Beer|ビール|L|alcohol,びーる
2026|happoshu|Low-malt beer / happoshu|発泡酒|L|alcohol,はっぽうしゅ,happoshu
2027|beer-flavored-alcohol|Beer-flavored alcoholic drinks|ビール風アルコール飲料|L|alcohol,new genre,新ジャンル
"""
BASE = {}
for line in PRODUCT_ROWS.strip().splitlines():
    code, slug, english, japanese, unit, aliases = line.split("|")
    BASE[code] = {"code": code, "id": slug, "en": english, "ja": japanese,
                  "unit": unit, "aliases": aliases.split(",")}


def variants(code):
    """Keep real replacements and unresolved physical dimensions explicit."""
    base = BASE[code]
    bounds = [("2000-01", AUDITED_END, base)]

    def variant(start, end, slug, en, ja, unit):
        return start, end, {**base, "id": slug, "en": en, "ja": ja, "unit": unit}

    if code == "1051":
        bounds = [variant("2000-01", "2001-12", "bagged-instant-noodles",
                          "Bagged instant noodles", "即席袋めん", "count"),
                  ("2002-01", AUDITED_END, base)]
    elif code == "1463":
        bounds = [variant("2000-01", "2007-06", "tororo-kombu", "Tororo / shredded kombu",
                          "とろろこんぶ", "kg"), ("2007-07", AUDITED_END, base)]
    elif code == "1473":
        bounds = [variant("2000-01", "2009-08", "natto-by-weight", "Natto by weight",
                          "納豆（重量）", "kg"), ("2009-09", AUDITED_END, base)]
    elif code == "1732":
        bounds = [variant("2000-01", "2001-06", "hard-candy", "Hard candy",
                          "ハードキャンデー", "kg"),
                  variant("2001-07", "2007-09", "throat-lozenges-by-weight",
                          "Throat lozenges by weight", "のど飴（重量）", "kg"),
                  ("2007-10", AUDITED_END, base)]
    elif code == "1781":
        bounds = [variant("2000-01", "2002-06", "gum-stick-pack", "Chewing gum, nine-stick pack",
                          "板ガム（９枚入り）", "package"), ("2002-07", AUDITED_END, base)]
    elif code == "1782":
        bounds = [variant("2000-01", "2001-06", "vanilla-ice-cream-cup",
                          "Vanilla ice cream, surveyed cup", "バニラアイス（調査カップ）", "package"),
                  ("2001-07", AUDITED_END, base)]
    elif code == "1784":
        bounds = [variant("2000-01", "2019-10", "fruit-jelly-cup", "Fruit jelly, surveyed cup",
                          "フルーツゼリー（調査カップ）", "package"),
                  ("2019-11", AUDITED_END, base)]
    elif code == "1811":
        bounds = [variant("2000-01", "2000-12", "vegetable-salad-unspecified",
                          "Vegetable salad, unspecified", "野菜サラダ（種類未指定）", "kg"),
                  ("2001-01", AUDITED_END, base)]
    elif code == "2011":
        bounds = [variant("2000-01", "2001-06", "continuous-distilled-shochu",
                          "Continuous-distilled shochu", "甲類焼酎", "L"),
                  ("2001-07", AUDITED_END, base)]
    return bounds


def exact_quote(code, period, spec, row, preferred_unit):
    """Reviewed native-to-physical quote divisor; no range-midpoint inference."""
    if preferred_unit == "package":
        return "1"
    unit = normalized(spec.get("unit")).lower()
    basic = {"100g": "0.1", "1kg": "1"}
    if unit in basic and preferred_unit == "kg":
        return basic[unit]
    # Count and fixed package dimensions need explicit per-code source evidence.
    if code == "1051":
        return ("1" if period < "2001-01" else "5") if preferred_unit == "count" else (
            "0.077" if period < "2019-11" else "0.078")
    if code == "1071":
        return "1"
    if code == "1321":
        return "0.2"
    if code == "1461":
        return "10"
    if code == "1473" and preferred_unit == "kg":
        return "0.1" if period < "2002-07" else "0.15"
    if code == "1602":
        if period < "2008-03":
            return "0.45"
        if period < "2009-04":
            return "0.4"
        if period < "2013-11":
            return "0.32"
        return "0.3"  # Published per-kg quotes above take precedence from Sep 2014.
    if code == "1631":
        return "1" if period < "2009-07" else "0.75"
    if code == "1641":
        return "0.5"
    if code == "1732":
        return "0.155" if period < "2001-07" else "0.12"
    if code == "1782":
        return "0.12" if period < "2014-07" else "0.11"
    if code == "1793":
        return "1"
    if code == "1921":
        return "0.1" if period < "2013-09" else "0.09"
    if code == "2003":
        return "1.8" if period < "2003-07" else "2"
    if code == "2011":
        return "1.8"
    if code == "2012":
        return "0.35"
    if code in {"2021", "2027"}:
        return "2.1"
    if code == "2026":
        return "0.35" if period < "2002-07" else "2.1"
    raise ValueError(f"No reviewed exact quote: {code}, {period}, {spec}, {row['unit']}")


def label(quantity, unit):
    if unit == "kg":
        text = f"{float(quantity) * 1000:g} g" if float(quantity) < 1 else f"{quantity} kg"
        return {"en": text, "ja": text}
    if unit == "L":
        text = f"{float(quantity) * 1000:g} mL" if float(quantity) < 1 else f"{quantity} L"
        return {"en": text, "ja": text}
    if unit == "count":
        return {"en": f"{quantity} item(s)", "ja": f"{quantity} 個"}
    return {"en": "1 surveyed package", "ja": "調査対象の１包装"}


def append_run(runs, value, period, comparable_fields):
    if runs and all(runs[-1].get(k) == value.get(k) for k in comparable_fields):
        runs[-1]["end"] = period
    else:
        runs.append({"start": period, "end": period, **value})


def build_product(meta, snapshots, start, end, accepted_hashes=None, accepted_units=None):
    code = meta["code"]
    product = {**meta, "familyId": BASE[code]["id"], "quoteQuantity": "1",
               "presets": {"kg": ["0.1", "0.5", "1"], "L": ["0.25", "0.5", "1"],
                           "count": ["1", "5", "10"], "package": ["1", "2", "3"]}[meta["unit"]],
               "comparisonNote": PACKAGE_NOTE if meta["unit"] == "package" else GENERIC_NOTE,
               "missingPriceEstimate": {"maxMonths": 2, "tokens": ["-"], "allowEquivalentSegments": True},
               "sourceNameSegments": [], "reviewedSpecifications": []}
    for snapshot in snapshots:
        period = snapshot["month"]
        if not start <= period <= end:
            continue
        row_list = [r for r in snapshot["prices"] if r["code"] == code]
        if len(row_list) > 1:
            raise ValueError(f"Duplicate source code {code}, {period}")
        if not row_list:
            continue  # Actual later starts remain later; no observation is invented.
        if code not in snapshot["specs"]:
            raise ValueError(f"Missing dated definition {code}, {period}")
        row, spec = row_list[0], snapshot["specs"][code]
        fingerprint = specification_hash(spec)
        if accepted_hashes is not None and fingerprint not in accepted_hashes.get(code, set()):
            raise ValueError(f"Unreviewed future specification {code}, {period}, {fingerprint}")
        if accepted_units is not None and normalized(row["unit"]) not in accepted_units.get(
                (code, fingerprint), set()):
            raise ValueError(f"Unreviewed source quote unit {code}, {period}, {row['unit']}")
        append_run(product["sourceNameSegments"], {"name": row["name"], "specName": spec["name"]},
                   period, ["name", "specName"])
        quote = exact_quote(code, period, spec, row, meta["unit"])
        value = {"specificationHash": fingerprint, "quoteQuantity": quote,
                 "quoteUnit": meta["unit"], "quoteLabel": label(quote, meta["unit"]),
                 "surveyMonths": survey_months(spec), "sourceUnits": [row["unit"]],
                 "continuityFromPrevious": True, "continuityReason": CONTINUITY_REASON,
                 "continuityEvidence": [snapshot["specSource"]["url"]]}
        approvals = product["reviewedSpecifications"]
        equivalent = ["specificationHash", "quoteQuantity", "quoteUnit", "surveyMonths"]
        if approvals and all(approvals[-1][k] == value[k] for k in equivalent):
            approvals[-1]["end"] = period
            if row["unit"] not in approvals[-1]["sourceUnits"]:
                approvals[-1]["sourceUnits"].append(row["unit"])
        else:
            if not approvals:
                value["continuityFromPrevious"] = False
                value["continuityReason"] = "First observed reviewed period for this food form."
            approvals.append({"start": period, "end": period, **value})
    if not product["reviewedSpecifications"]:
        return None
    product["quoteQuantity"] = product["reviewedSpecifications"][-1]["quoteQuantity"]
    return product


def current_product_updates(current):
    """Existing exact quotes remain; modest generic changes stop blocking baskets."""
    updates = []
    for product in current["products"]:
        if int(product["code"]) >= 3000:
            continue
        product = copy.deepcopy(product)
        code = product["code"]
        product["missingPriceEstimate"] = {
            "maxMonths": 2, "tokens": ["-"], "allowEquivalentSegments": True}
        for approval in product["reviewedSpecifications"]:
            approval["continuityEvidence"] = [
                source for source in approval["continuityEvidence"] if source != OWNER_DECISION]
        if code != "1341":
            product["comparisonNote"] = GENERIC_NOTE
            for index, approval in enumerate(product["reviewedSpecifications"]):
                approval["continuityFromPrevious"] = index > 0
                if index:
                    approval["continuityReason"] = CONTINUITY_REASON
        updates.append(product)
    return updates


def build_review(staging, current, previous=None, initialize=False):
    snapshots = staging["snapshots"]
    if not snapshots or snapshots[0]["month"] != "2000-01":
        raise ValueError("Expansion staging must begin January 2000")
    if snapshots[-1]["month"] > AUDITED_END:
        raise ValueError("Newer source cutoff requires a new dated food review")
    accepted, accepted_units = None, None
    if previous is not None:
        accepted, accepted_units = {}, {}
        for product in previous["products"]:
            accepted.setdefault(product["code"], set()).update(
                s["specificationHash"] for s in product["reviewedSpecifications"])
            for segment in product["reviewedSpecifications"]:
                accepted_units.setdefault((product["code"], segment["specificationHash"]), set()).update(
                    normalized(unit) for unit in segment["sourceUnits"])
    elif not initialize:
        raise ValueError("Initial mapping requires --initialize after dated definition review")
    products = []
    for code in BASE:
        for start, end, meta in variants(code):
            product = build_product(meta, snapshots, start, end, accepted, accepted_units)
            if product is not None:
                products.append(product)
    represented = {p["code"] for p in products}
    if represented != set(BASE):
        raise ValueError(f"Missing candidate price histories: {sorted(set(BASE) - represented)}")
    if len({p["id"] for p in products}) != len(products):
        raise ValueError("Duplicate public food form IDs")
    return {"schemaVersion": 1, "reviewedAt": "2026-10-10", "policyVersion": "1.2",
            "approvedWindow": {"start": snapshots[0]["month"], "end": snapshots[-1]["month"]},
            "policy": "Owner-authorized generic food continuity across modest changes; exact dated "
                      "mass/volume/count normalization. Real product-form replacements and unresolved "
                      "pack dimensions retain separate histories. Original observations are untouched. "
                      "Missing data and geography are governed by the separate publication policy.",
            "reviewedMissingTokens": current["reviewedMissingTokens"], "candidateSourceCodes": list(BASE),
            "ownerAuthorization": OWNER_DECISION,
            "products": products, "existingProductUpdates": (
                current_product_updates({"products": previous["existingProductUpdates"]}) if previous is not None
                else current_product_updates(current)),
            "notAdmitted": {"localSpecifications": "Unresolved Y or local unit definitions remain unpriced.",
                            "sourceAbsence": "No prices before a source row first appears.",
                            "unresolvedWeights": "No mean or midpoint inferred from permitted pack ranges."}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staging", type=Path, default=ROOT / "data/staging/food-history.json")
    parser.add_argument("--current", type=Path, default=ROOT / "data/catalog-review.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/food-expansion-review.json")
    parser.add_argument("--initialize", action="store_true",
                        help="Explicit initial dated review; subsequent builds enforce tracked fingerprints")
    parser.add_argument("--check", action="store_true", help="Verify reproducibility without writing")
    args = parser.parse_args()
    staging = json.loads(args.staging.read_text(encoding="utf-8"))
    current = json.loads(args.current.read_text(encoding="utf-8"))
    previous = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else None
    review = build_review(staging, current, previous, args.initialize)
    payload = json.dumps(review, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != payload:
            raise ValueError("Tracked food review differs from the current dated staging")
    else:
        args.output.write_text(payload, encoding="utf-8", newline="\n")
    print(f"Reviewed {len(review['products'])} forms for {len(BASE)} candidate codes; "
          f"{len(review['existingProductUpdates'])} existing food updates")


if __name__ == "__main__":
    main()
