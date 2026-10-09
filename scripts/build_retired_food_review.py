"""Build bounded retired food mappings, preserving actual scopes and end dates."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from scripts import build_remaining_food_review as candidate
ROWS = """
1003|mixed-origin-rice|Rice, mixed-origin|うるち米（複数原料米）|kg|rice,米,こめ
1005|designated-standard-rice|Rice, designated standard grade|うるち米（指定標準米）|kg|rice,米,こめ
1007|imported-rice|Imported rice|うるち米（外国産）|kg|rice,米,こめ
1011|glutinous-rice|Glutinous rice|もち米|kg|rice,mochi,餅米
1043|imported-spaghetti|Imported spaghetti|スパゲッティ（輸入品）|kg|pasta,パスタ
1061|okinawa-soba|Boiled Okinawa soba|ゆで沖縄そば|kg|noodles,沖縄そば
1104|fresh-bonito|Fresh bonito|かつお（生）|kg|fish,カツオ,鰹
1105|flounder|Flounder|かれい|kg|fish,カレイ,鰈
1109|salted-cod|Lightly salted cod|たら（甘塩）|kg|fish,タラ,鱈
1121|hamadai|Hamadai / flame snapper|はまだい|kg|fish,アカマチ
1122|takasago|Takasago / fusilier|たかさご|kg|fish,グルクン
1145|whole-dried-sardines|Whole dried sardines|丸干しいわし|kg|fish,鰯,イワシ
1162|smoked-squid|Smoked squid|いかくん製|kg|fish,イカ,燻製
1163|squid-shiokara|Squid shiokara|いかの塩辛|kg|fish,しおから,塩辛
1171|canned-salmon|Canned salmon|さけ缶詰|kg|fish,canned,鮭
1202|beef-shoulder|Beef shoulder|牛肉（肩）|kg|meat,ぎゅうにく,ビーフ
1212|pork-thigh|Pork thigh|豚肉（もも）|kg|meat,ぶたにく,ポーク
1231|lamb|Lamb|羊肉（ラム）|kg|meat,lamb,ラム肉
1241|pork-liver|Pork liver|豚レバー|kg|meat,liver,レバー
1251|pressed-ham|Pressed ham|プレスハム|kg|meat,ham,ハム
1291|canned-pork|Canned pork|ポーク缶詰|kg|meat,canned,スパム
1301|delivered-milk|Delivered bottled milk|牛乳（配達）|L|dairy,milk,ミルク
1418|turnips|Turnips|かぶ|kg|vegetable,蕪,カブ
1431|snow-peas|Snow peas|さやえんどう|kg|vegetable,絹さや,エンドウ
1439|bitter-melon-regional|Bitter melon, regional series|にがうり（地域品目）|kg|vegetable,goya,ゴーヤ,苦瓜
1440|winter-melon|Winter melon|とうが|kg|vegetable,冬瓜,とうがん
1441|bitter-melon|Bitter melon|にがうり|kg|vegetable,goya,ゴーヤ,苦瓜
1451|adzuki-beans|Adzuki beans|あずき|kg|beans,小豆,アズキ
1452|soybeans|Soybeans|だいず|kg|beans,大豆,ダイズ
1484|fukujinzuke|Fukujinzuke pickles|福神漬|kg|pickle,ふくじんづけ
1501|tsugaru-apples|Tsugaru apples|りんご（つがる）|kg|fruit,apple,リンゴ
1512|natsu-citrus|Natsu citrus|なつみかん|kg|fruit,citrus,夏みかん
1513|lemons|Lemons|レモン|kg|fruit,citrus,れもん
1514|grapefruit|Grapefruit|グレープフルーツ|kg|fruit,citrus,ぐれーぷふるーつ
1516|iyokan|Iyokan citrus|いよかん|kg|fruit,citrus,伊予柑
1562|prince-melon|Prince melon|メロン（プリンスメロン）|kg|fruit,melon,めろん
1591|canned-mandarin|Canned mandarin oranges|みかん缶詰|kg|fruit,canned,ミカン
1592|canned-pineapple-pack|Canned pineapple, surveyed can|パイナップル缶詰（調査対象の缶）|package|fruit,canned,pineapple,パイン
1593|canned-peaches|Canned peaches, surveyed can|もも缶詰（調査対象の缶）|package|fruit,canned,桃
1651|umami-seasoning|Umami seasoning / MSG|うま味調味料|kg|seasoning,味の素
1731|milk-caramel|Milk caramel, per piece|ミルクキャラメル（１粒）|count|sweets,candy,キャラメル
1742|kawara-senbei|Kawara senbei, wheat crackers|かわらせんべい|kg|sweets,crackers,瓦煎餅
1762|imported-milk-chocolate|Imported milk chocolate|チョコレート（輸入品）|kg|sweets,chocolate,チョコ
1841|fried-horse-mackerel|Fried horse mackerel|あじフライ|kg|prepared food,fish,アジフライ
1901|bancha|Bancha green tea|緑茶（番茶）|kg|drink,tea,ばんちゃ
1912|imported-leaf-tea|Imported loose-leaf black tea|紅茶（輸入リーフティー）|kg|drink,tea,こうちゃ
1914|oolong-drink|Oolong tea drink|ウーロン茶飲料|L|drink,tea,烏龍茶
1961|clear-soda|Clear soda|サイダー|L|drink,soda,炭酸飲料
1971|lactic-drink-concentrate|Lactic acid drink concentrate|乳酸菌飲料（希釈用）|L|drink,カルピス
1972|delivered-fermented-milk-city|Delivered fermented milk, historical city series|乳酸菌飲料（配達・過去の市別）|L|drink,dairy,ヤクルト
2001|premium-sake|Premium sake|清酒（特撰）|L|alcohol,日本酒,さけ
2002|josen-sake|Josen sake|清酒（上撰）|L|alcohol,日本酒,さけ
2025|imported-beer|Imported beer|ビール（輸入品）|L|alcohol,beer,びーる
2031|scotch-whisky|Scotch whisky|ウイスキー（スコッチ）|L|alcohol,whiskey,スコッチ
2032|reserve-whisky|Japanese reserve whisky|ウイスキー（リザーブ）|L|alcohol,whiskey,リザーブ
2034|red-whisky|Japanese Red whisky|ウイスキー（レッド）|L|alcohol,whiskey,レッド
"""

META = {}
for line in ROWS.strip().splitlines():
    code, slug, en, ja, unit, aliases = line.split("|")
    META[code] = {"code": code, "id": slug, "en": en, "ja": ja,
                  "unit": unit, "aliases": aliases.split(",")}
VARIANTS = {
    "1914": [("2000-01", "2000-12", "canned-oolong-by-weight", "kg"),
             ("2001-01", "2004-12", "oolong-drink", "L")],
}
VARIANT_LABELS = {"canned-oolong-by-weight": (
    "Canned oolong tea by weight", "ウーロン茶缶飲料（重量）")}
FALLBACKS = {**candidate.FALLBACKS, **{
    "1291": [("2007-07", "0.34")],
    "1591": [("2000-01", "0.435"), ("2001-01", "0.425")],
    "1972": [("2000-01", "0.065"), ("2007-01", "0.08")],
}}
UNREVIEWED_SOURCE_PERIODS = [{"code": code, "start": "2000-09", "end": "2007-06",
    "reason": "Unresolved local basic definition", "requireMissingBasicDefinition": True}
    for code in ["1061", "1121", "1122", "1291", "1439", "1440"]]

def build_review(staging, current, first, previous=None, initialize=False):
    last_codes = {p["code"] for p in staging["snapshots"][-1]["prices"] if 1000 <= int(p["code"]) < 2100}
    historic_codes = {p["code"] for snapshot in staging["snapshots"] for p in snapshot["prices"]
                      if 1000 <= int(p["code"]) < 2100}
    done = {p["code"] for p in current["products"] + first["products"]}
    needed = historic_codes - last_codes - done
    return candidate.build(staging, current, first, previous, initialize, meta=META,
                           variants=VARIANTS, variant_labels=VARIANT_LABELS,
                           fallbacks=FALLBACKS, expected_codes=needed,
                           unreviewed_periods=UNREVIEWED_SOURCE_PERIODS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staging", type=Path, default=ROOT / "data/staging/food-history-complete.json")
    parser.add_argument("--current", type=Path, default=ROOT / "data/catalog-review.json")
    parser.add_argument("--first-expansion", type=Path, default=ROOT / "data/food-expansion-review.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/retired-food-review.json")
    parser.add_argument("--audit", type=Path)
    parser.add_argument("--initialize", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    staging = json.loads(args.staging.read_text(encoding="utf8"))
    current = json.loads(args.current.read_text(encoding="utf8"))
    first = json.loads(args.first_expansion.read_text(encoding="utf8"))
    previous = json.loads(args.output.read_text(encoding="utf8")) if args.output.exists() else None
    review, audit, unresolved = build_review(staging, current, first, previous, args.initialize)
    if unresolved:
        raise ValueError(f"Unresolved retired-food quantities: {unresolved[:5]}")
    if len({p["id"] for p in review["products"]}) != len(review["products"]):
        raise ValueError("Duplicate retired food form IDs")
    payload = json.dumps(review, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf8") != payload:
            raise ValueError("Tracked retired-food review differs from dated source evidence")
    else:
        args.output.write_text(payload, encoding="utf8", newline="\n")
    if args.audit:
        args.audit.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
    print(f"Reviewed {len(review['products'])} forms for {len(META)} retired source food codes")


if __name__ == "__main__":
    main()
