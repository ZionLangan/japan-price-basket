"""Build the explicitly reviewed remaining city-food histories from cached evidence.

This command does not acquire prices or publish a fixture. Initial admission
requires --initialize; reruns enforce the tracked definition/unit allowlist.
"""
import argparse
import copy
import json
import re
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.build_food_expansion_review import (
    CONTINUITY_REASON, GENERIC_NOTE, PACKAGE_NOTE, append_run, label,
)
from scripts.review_recent_prices import conversion_hash, normalized, specification_hash, survey_months

AUDITED_END = "2026-08"

# Reviewed bilingual generic identities, with actual source code retained.
ROWS = """
1002|other-single-origin-rice|Rice, other single-origin varieties|うるち米（コシヒカリ以外）|kg|rice,米,こめ
1031|boiled-udon|Boiled udon noodles|ゆでうどん|kg|noodles,うどん
1041|dried-wheat-noodles|Dried wheat noodles (udon / somen)|干しうどん・そうめん|kg|noodles,udon,somen,素麺,うどん
1042|spaghetti|Spaghetti|スパゲッティ|kg|pasta,パスタ
1052|chinese-noodles|Chinese noodles|中華麺|kg|noodles,ラーメン,焼そば
1081|mochi|Mochi rice cakes|もち|kg|rice,餅,おもち
1090|cereal|Breakfast cereal|シリアル|kg|granola,グラノーラ
1101|tuna|Tuna|まぐろ|kg|fish,マグロ,鮪
1102|horse-mackerel|Horse mackerel|あじ|kg|fish,アジ,鯵
1103|sardines|Sardines|いわし|kg|fish,イワシ,鰯
1106|fresh-salmon|Fresh salmon|さけ（塩加工を除く）|kg|fish,サーモン,鮭
1107|mackerel|Mackerel|さば|kg|fish,サバ,鯖
1108|pacific-saury|Pacific saury|さんま|kg|fish,サンマ,秋刀魚
1110|sea-bream|Sea bream|たい|kg|fish,タイ,鯛
1112|squid|Squid|いか|kg|fish,イカ,烏賊
1113|octopus|Octopus|たこ|kg|fish,タコ,蛸
1114|shrimp|Shrimp|えび|kg|fish,prawn,エビ,海老
1116|bonito-tataki|Bonito tataki|かつお（たたき）|kg|fish,カツオ,鰹
1132|oysters|Oysters|かき（貝）|kg|fish,牡蠣,カキ
1133|scallops|Scallops|ほたて貝|kg|fish,ホタテ,帆立
1142|salted-cod-roe|Salted cod roe / tarako|たらこ|kg|fish,タラコ,鱈子
1144|dried-horse-mackerel|Dried horse mackerel|干しあじ|kg|fish,アジの開き
1150|shishamo|Shishamo smelt|ししゃも|kg|fish,シシャモ
1161|bonito-flakes|Bonito flakes|かつお節|kg|fish,dashi,鰹節
1165|marinated-fish|Marinated fish|魚介漬物|kg|fish,みそ漬,さわら
1166|fish-tsukudani|Fish tsukudani|魚介つくだ煮|kg|fish,佃煮,ちりめん
1167|salmon-roe|Salmon roe / ikura|いくら|kg|fish,イクラ
1168|salted-mackerel|Salted mackerel|塩さば|kg|fish,塩サバ
1173|canned-tuna|Canned tuna|まぐろ缶詰|kg|fish,canned,ツナ,シーチキン
1203|imported-beef|Imported beef|牛肉（輸入品）|kg|meat,ぎゅうにく,ビーフ
1211|domestic-pork|Pork|豚肉（国産品）|kg|meat,ぶたにく,ポーク
1214|imported-pork-loin|Imported pork loin|豚肉（輸入ロース）|kg|meat,ポーク,ぶたにく
1271|bacon|Bacon|ベーコン|kg|meat,べーこん
1292|seasoned-pork|Seasoned pork|味付け肉（豚肉）|kg|meat,豚肉
1311|infant-formula|Infant formula powder|粉ミルク|kg|dairy,milk powder,乳児用ミルク
1331|processed-cheese|Processed cheese|プロセスチーズ|kg|dairy,cheese,チーズ
1332|camembert|Camembert cheese|カマンベールチーズ|kg|dairy,cheese,チーズ
1333|plain-yogurt|Plain yogurt|プレーンヨーグルト|kg|dairy,yoghurt,ヨーグルト
1410|asparagus|Asparagus|アスパラガス|kg|vegetable,アスパラ
1413|taro|Taro|さといも|kg|vegetable,里芋,サトイモ
1421|ginger|Ginger|しょうが|kg|vegetable,生姜,ショウガ
1430|edamame|Edamame|えだまめ|kg|vegetable,枝豆,エダマメ
1444|cut-vegetables|Cut vegetables|カット野菜|kg|vegetable,ミックス野菜
1462|wakame|Wakame seaweed|わかめ|kg|seaweed,若布,ワカメ
1464|hijiki|Hijiki seaweed|ひじき|kg|seaweed,ヒジキ
1487|kimchi|Kimchi|キムチ|kg|pickle,きむち
1491|canned-vegetables|Canned vegetables / corn|野菜缶詰（コーン）|kg|vegetable,canned,corn,とうもろこし
1502|apples|Apples|りんご|kg|fruit,リンゴ,林檎,ふじ
1515|oranges|Oranges|オレンジ|kg|fruit,おれんじ
1517|shiranui|Shiranui citrus|しらぬひ|kg|fruit,citrus,不知火,デコポン
1521|japanese-pears|Japanese pears|梨|kg|fruit,nashi,なし,ナシ
1533|shine-muscat|Shine Muscat grapes|シャインマスカット|kg|fruit,grapes,ぶどう
1561|watermelon|Watermelon|すいか|kg|fruit,スイカ,西瓜
1581|bananas|Bananas|バナナ|kg|fruit,ばなな
1582|kiwifruit|Kiwifruit|キウイフルーツ|kg|fruit,kiwi,キウイ
1583|avocado|Avocado|アボカド|kg|fruit,vegetable,あぼかど
1584|cut-pineapple|Cut pineapple|カットパイナップル|kg|fruit,pineapple,パイン
1594|almonds|Almonds|アーモンド|kg|nuts,ナッツ
1601|cooking-oil|Cooking oil|食用油|kg|seasoning,salad oil,サラダ油
1611|salt|Salt|食塩|kg|seasoning,しお,塩
1621|soy-sauce|Soy sauce|しょう油|L|seasoning,醤油,しょうゆ
1633|grain-vinegar|Grain vinegar|穀物酢|L|seasoning,vinegar,酢
1642|ketchup|Ketchup|ケチャップ|kg|seasoning,tomato,けちゃっぷ
1643|mayonnaise|Mayonnaise|マヨネーズ|kg|seasoning,mayo,まよねーず
1644|strawberry-jam|Strawberry jam|いちごジャム|kg|seasoning,spread,jam,ジャム
1645|sesame-dressing|Sesame dressing|ごまドレッシング|L|seasoning,dressing,ドレッシング
1652|curry-roux-pack|Curry roux, surveyed box|カレールウ（調査対象の箱）|package|seasoning,curry,カレー,ルー
1653|dry-soup|Instant dry soup|乾燥スープ|kg|seasoning,soup,スープ
1654|bonito-dashi|Bonito dashi seasoning|風味調味料（かつおだし）|kg|seasoning,stock,dashi,ほんだし,だし
1655|yakiniku-sauce|Yakiniku sauce|焼肉のたれ|kg|seasoning,sauce,たれ
1656|furikake|Furikake rice seasoning|ふりかけ|kg|seasoning,のりたま
1657|mapo-tofu-sauce|Mapo tofu seasoning|麻婆豆腐の素|kg|seasoning,sauce,マーボー豆腐
1658|meat-pasta-sauce|Meat pasta sauce|ミートソース|kg|seasoning,pasta sauce,パスタソース
1659|men-tsuyu|Men-tsuyu noodle sauce|めんつゆ|L|seasoning,sauce,つゆ
1660|wasabi|Wasabi paste|わさび|kg|seasoning,ワサビ,山葵
1701|yokan|Yokan bean jelly|ようかん|kg|sweets,羊羹,ヨウカン
1702|manju|Manju buns|まんじゅう|kg|sweets,饅頭,マンジュウ
1703|daifuku|Daifuku rice cakes|だいふく餅|kg|sweets,大福,ダイフク
1711|castella|Castella sponge cake|カステラ|kg|sweets,cake,かすてら
1712|strawberry-shortcake|Strawberry shortcake|いちごショートケーキ|count|sweets,cake,ケーキ
1714|custard-pudding|Custard pudding, per cup|プリン（１カップ）|count|sweets,custard,ぷりん
1715|roll-cake|Roll cake|ロールケーキ|count|sweets,cake,ろーるけーき
1761|milk-chocolate|Milk chocolate|ミルクチョコレート|kg|sweets,chocolate,チョコ
1772|peanuts|Peanuts|落花生|kg|nuts,ピーナッツ,らっかせい
1783|potato-chips|Potato chips|ポテトチップス|kg|snacks,crisps,ポテチ
1785|gummies|Gummy candy, surveyed bag|グミ（調査対象の袋）|package|sweets,candy,ぐみ
1790|packaged-rice|Packaged cooked rice|無菌包装米飯|kg|prepared food,rice,パックご飯
1791|makunouchi-bento|Makunouchi bento|幕の内弁当|count|prepared food,bento,弁当
1792|sandwiches|Sandwiches|サンドイッチ|kg|prepared food,bread,タマゴサンド
1794|frozen-cooked-rice|Frozen cooked rice|冷凍米飯|kg|prepared food,rice,炒飯,ピラフ
1795|nigiri-sushi-pack|Nigiri sushi, surveyed pack|にぎりずし（調査対象のパック）|package|prepared food,sushi,寿司,すし
1796|prepared-pasta-pack|Prepared pasta, surveyed pack|調理パスタ（調査対象のパック）|package|prepared food,pasta,スパゲッティ
1797|karaage-bento|Karaage bento|からあげ弁当|count|prepared food,bento,弁当
1798|inari-sushi|Inari sushi, per piece|いなりずし（１個）|count|prepared food,sushi,寿司,すし
1799|prepared-pizza-pack|Prepared pizza, surveyed pack|調理ピザ（調査対象のパック）|package|prepared food,pizza,ぴざ
1801|grilled-eel|Grilled eel / kabayaki|うなぎかば焼き|kg|prepared food,fish,鰻,ウナギ
1802|grilled-fish|Grilled fish|焼き魚|kg|prepared food,fish,塩焼き
1812|simmered-beans|Simmered beans|煮豆|kg|prepared food,beans,金時豆
1813|kinpira|Kinpira burdock and carrot|きんぴら|kg|prepared food,vegetable,ごぼう,にんじん
1814|roast-pork|Roast pork|焼豚|kg|prepared food,meat,チャーシュー
1831|pork-cutlet|Pork cutlet / tonkatsu|豚カツ|kg|prepared food,meat,とんかつ,トンカツ
1842|karaage|Karaage fried chicken|からあげ|kg|prepared food,chicken,唐揚げ,から揚げ
1843|yakitori|Yakitori, per skewer|やきとり（１本）|count|prepared food,chicken,焼鳥,焼き鳥
1844|chilled-hamburger|Chilled hamburger steaks|ハンバーグ（チルド）|kg|prepared food,meat,ハンバーグ
1851|frozen-croquettes|Frozen potato croquettes|冷凍調理コロッケ|kg|prepared food,コロッケ
1852|frozen-hamburger|Frozen hamburger steaks|冷凍調理ハンバーグ|kg|prepared food,meat,ハンバーグ
1853|frozen-gyoza|Frozen gyoza|冷凍ぎょうざ|kg|prepared food,dumplings,餃子
1862|katsudon|Katsudon|カツ丼|count|prepared food,bento,かつどん
1863|frozen-takoyaki|Frozen takoyaki|たこ焼き（冷凍）|kg|prepared food,たこやき
1871|retort-curry|Retort curry|レトルトカレー|kg|prepared food,curry,カレー
1881|chilled-gyoza|Chilled gyoza|ぎょうざ（チルド）|kg|prepared food,dumplings,餃子
1891|mixed-rice-seasoning|Mixed-rice seasoning|混ぜごはんのもと|kg|seasoning,rice,釜めし,ちらし寿司
1892|salad-chicken|Salad chicken|サラダチキン|kg|prepared food,chicken,鶏肉
1893|oden|Oden|おでん|kg|prepared food,おでん種
1894|meatballs|Meatballs|ミートボール|kg|prepared food,meat,肉団子
1911|black-tea-bags|Black tea bags|紅茶（ティーバッグ）|count|drink,tea,こうちゃ
1915|tea-drink|Bottled tea drink|茶飲料|L|drink,tea,ペットボトル茶,緑茶
1922|coffee-beans|Coffee beans|コーヒー豆|kg|drink,coffee,珈琲
1923|coffee-drink|Packaged coffee drink|コーヒー飲料|L|drink,coffee,缶コーヒー
1930|orange-juice|Orange juice, 100%|オレンジジュース（果汁１００％）|L|drink,juice,果実飲料
1931|fruit-juice-drink|Fruit juice drink|果汁入り飲料|L|drink,juice,果実飲料
1941|vegetable-juice|Vegetable and fruit juice|野菜・果実ミックスジュース|L|drink,juice,野菜ジュース
1951|cola|Cola|コーラ|L|drink,soda,こーら
1952|nonalcoholic-beer|Non-alcoholic beer|ノンアルコールビール|L|drink,beer,ビール
1953|sparkling-water|Sparkling water|炭酸水|L|drink,water,たんさんすい
1981|sports-drink|Sports drink|スポーツドリンク|L|drink,ポカリスエット,アクエリアス
1982|mineral-water|Mineral water|ミネラルウォーター|L|drink,water,水
1983|soy-milk|Soy milk|豆乳|L|drink,milk,とうにゅう
1985|jelly-drink|Jelly drink|ゼリー飲料|kg|drink,ゼリー
2033|japanese-whisky|Japanese whisky|ウイスキー（国産品）|L|alcohol,whiskey,ウィスキー
2041|domestic-wine|Domestic wine|ワイン（国産品）|L|alcohol,wine,ぶどう酒
2042|imported-wine|Imported wine|ワイン（輸入品）|L|alcohol,wine,ぶどう酒
"""

META = {}
for line in ROWS.strip().splitlines():
    code, slug, en, ja, unit, aliases = line.split("|")
    META[code] = {"code": code, "id": slug, "en": en, "ja": ja,
                  "unit": unit, "aliases": aliases.split(",")}

# Each range is a native dimension form. No estimated range midpoint is used.
# Large food-form replacements are separate, rather than a false quality index.
VARIANTS = {
    "1031": [("2000-01", "2002-12", "boiled-udon", "kg"),
             ("2003-01", "2007-09", "boiled-udon-serving", "package"),
             ("2007-10", "2026-08", "boiled-udon", "kg")],
    "1052": [("2000-01", "2007-09", "raw-chinese-noodle-pack", "package"),
             ("2007-10", "2015-12", "raw-chinese-noodles", "kg"),
             ("2016-01", "2026-08", "yakisoba-noodles", "kg")],
    "1110": [("2000-01", "2006-12", "whole-sea-bream", "kg"),
             ("2007-01", "2026-08", "sea-bream-sashimi", "kg")],
    "1333": [("2000-01", "2002-12", "plain-yogurt-tub", "package"),
             ("2003-01", "2026-08", "plain-yogurt", "kg")],
    "1462": [("2000-01", "2026-02", "fresh-salted-wakame", "kg"),
             ("2026-03", "2026-08", "dried-cut-wakame", "kg")],
    "1712": [("2000-01", "2014-12", "strawberry-shortcake-by-weight", "kg"),
             ("2015-01", "2026-08", "strawberry-shortcake", "count")],
    "1796": [("2005-01", "2009-06", "microwave-pasta-pack", "package"),
             ("2009-07", "2026-08", "frozen-pasta-pack", "package")],
    "1799": [("2015-01", "2022-07", "frozen-pizza-pack", "package"),
             ("2022-08", "2026-08", "chilled-pizza-pack", "package")],
    "1831": [("2000-01", "2010-10", "pork-cutlet-per-piece", "count"),
             ("2010-11", "2026-08", "pork-cutlet", "kg")],
    "1852": [("2005-01", "2008-10", "frozen-hamburger-pack", "package"),
             ("2008-11", "2026-08", "frozen-hamburger", "kg")],
    "1871": [("2000-01", "2001-06", "retort-curry-pack", "package"),
             ("2001-07", "2026-08", "retort-curry", "kg")],
    "1891": [("2000-01", "2004-12", "kamameshi-seasoning", "kg"),
             ("2005-01", "2024-09", "chirashi-sushi-seasoning", "kg"),
             ("2024-10", "2026-08", "kamameshi-seasoning", "kg")],
    "1923": [("2000-01", "2012-06", "canned-coffee-by-weight", "kg"),
             ("2012-07", "2026-08", "coffee-drink", "L")],
    "1931": [("2000-01", "2000-06", "canned-fruit-drink-by-weight", "kg"),
             ("2000-07", "2026-08", "fruit-juice-drink", "L")],
    "1941": [("2000-01", "2009-10", "tomato-juice-by-weight", "kg"),
             ("2009-11", "2026-08", "vegetable-juice", "L")],
    "1981": [("2000-01", "2000-06", "sports-drink-can", "package"),
             ("2000-07", "2026-08", "sports-drink", "L")],
}

VARIANT_LABELS = {
    "boiled-udon-serving": ("Boiled udon, surveyed serving", "ゆでうどん（調査対象の１食）"),
    "raw-chinese-noodle-pack": ("Raw Chinese noodles, surveyed pack", "生中華麺（調査対象の袋）"),
    "raw-chinese-noodles": ("Raw Chinese noodles", "生中華麺"),
    "yakisoba-noodles": ("Yakisoba noodles", "焼そば麺"),
    "whole-sea-bream": ("Whole sea bream", "たい（丸）"),
    "sea-bream-sashimi": ("Sea bream sashimi blocks", "たい（刺身用さく）"),
    "plain-yogurt-tub": ("Plain yogurt, surveyed tub", "プレーンヨーグルト（調査対象の容器）"),
    "fresh-salted-wakame": ("Fresh salted wakame", "生わかめ（塩蔵品）"),
    "dried-cut-wakame": ("Dried cut wakame", "カットわかめ（乾燥品）"),
    "strawberry-shortcake-by-weight": ("Strawberry shortcake by weight", "いちごショートケーキ（重量）"),
    "microwave-pasta-pack": ("Microwave pasta, surveyed pack", "電子レンジ専用パスタ（調査対象のパック）"),
    "frozen-pasta-pack": ("Frozen pasta, surveyed pack", "冷凍パスタ（調査対象の袋）"),
    "frozen-pizza-pack": ("Frozen pizza, surveyed pack", "冷凍ピザ（調査対象の袋）"),
    "chilled-pizza-pack": ("Chilled pizza, surveyed pack", "チルドピザ（調査対象の袋）"),
    "pork-cutlet-per-piece": ("Pork cutlet, per piece", "豚カツ（１枚）"),
    "frozen-hamburger-pack": ("Frozen hamburger steaks, surveyed pack", "冷凍ハンバーグ（調査対象の袋）"),
    "retort-curry-pack": ("Retort curry, surveyed box", "レトルトカレー（調査対象の箱）"),
    "kamameshi-seasoning": ("Kamameshi rice seasoning", "釜めしの素"),
    "chirashi-sushi-seasoning": ("Chirashi sushi seasoning", "五目ずしの素"),
    "canned-coffee-by-weight": ("Canned coffee by weight", "缶コーヒー（重量）"),
    "canned-fruit-drink-by-weight": ("Canned fruit drink by weight", "果汁入り缶飲料（重量）"),
    "tomato-juice-by-weight": ("Tomato juice by weight", "トマトジュース（重量）"),
    "sports-drink-can": ("Sports drink, surveyed can", "スポーツドリンク（調査対象の缶）"),
}

COUNT_NOTE = {
    "en": "Compared per surveyed item or portion. Its size can change over time; "
          "this count comparison does not assert a constant weight.",
    "ja": "調査対象の１個・１食分当たりで比較します。大きさは時期により変わります。"
          "個数での比較であり、重量が一定であるとは限りません。",
}
PRICE_QUOTE_NOTE = {
    "en": "Some historical price-table captions disagree with the dated basic "
          "definition. The reviewed conversion follows that definition and is "
          "marked estimated for affected months; both original texts are retained.",
    "ja": "過去の一部の価格表で数量表記が時期別の基本銘柄と一致しません。確認した換算は"
          "基本銘柄を採用し、該当月を推計として表示します。両方の原文を保存しています。",
}
CORN_NOTE = {
    "en": "Compared per weight of drained corn kernels. Before September 2014, "
          "each can is converted using its dated solid contents, excluding liquid; "
          "later prices are published per kg. Historical gross-weight captions are retained.",
    "ja": "液汁を除くコーンの固形量当たりで比較します。２０１４年９月より前の１缶価格は"
          "時期別の固形量で換算し、その後は公表された１ｋｇ価格を使用します。過去の総量表記も保存しています。",
}
CORN_BASIS_EVIDENCE = "https://www.stat.go.jp/info/today/127.htm"
DRIED_NOODLES_NOTE = {
    "en": "The survey changes from dried udon to hand-stretched somen in January "
          "2020. This broad dried-wheat-noodle history keeps the same dry-weight "
          "basis; its change also reflects the surveyed type and quality.",
    "ja": "２０２０年１月に調査対象が干しうどんから手延べそうめんに変わります。"
          "乾麺重量で統一した広い食品分類であり、価格の変化には種類・品質の変化も含みます。",
}
CONFLICT_CAPACITIES = {
    "1331": [("2000-01", "2000-01", "0.225"), ("2000-03", "2000-03", "0.225"),
             ("2005-05", "2005-10", "0.18")],
    "2042": [("2000-01", "2006-12", "0.75")],
    "1011": [("2002-01", "2002-01", "1")],
}

# Only used when a printed price header says just one pack. These quantities are
# independently present in the dated specification, rather than guessed.
FALLBACKS = {
    "1042": [("2000-01", "0.3")],
    "1161": [("2000-01", "0.015"), ("2008-07", "0.03"), ("2013-06", "0.025"),
             ("2023-07", "0.02")],
    "1173": [("2000-01", "0.08"), ("2013-06", "0.07")],
    "1311": [("2000-01", "0.98"), ("2005-07", "0.93"), ("2008-03", "0.85"),
             ("2012-11", "0.8"), ("2026-01", "0.78")],
    "1331": [("2000-01", "0.225"), ("2000-07", "0.15"), ("2002-01", "0.19"),
             ("2005-05", "0.18"), ("2008-03", "0.144")],
    "1332": [("2000-01", "0.125")],
    "1333": [("2003-01", "0.5"), ("2018-04", "0.4")],
    "1491": [("2000-01", "0.435"), ("2002-07", "0.23"), ("2004-01", "0.19")],
    "1601": [("2000-01", "1.5"), ("2006-01", "1"), ("2024-11", "0.9")],
    "1611": [("2000-01", "1")],
    "1621": [("2000-01", "1"), ("2024-01", "0.45")],
    "1633": [("2000-01", "0.5")],
    "1642": [("2000-01", "0.5")],
    "1643": [("2000-01", "0.5"), ("2013-11", "0.45")],
    "1644": [("2000-01", "0.17"), ("2010-03", "0.165"), ("2016-03", "0.15")],
    "1654": [("2000-01", "0.15"), ("2007-10", "0.12")],
    "1653": [("2000-01", "0.068"), ("2000-07", "0.0696"), ("2003-01", "0.08"),
             ("2005-01", "0.076"), ("2006-10", "0.0784"), ("2009-09", "0.0576"),
             ("2012-01", "0.1536"), ("2012-10", "0.1408"), ("2020-09", "0.1456"),
             ("2023-10", "0.1488")],
    "1655": [("2000-01", "0.21"), ("2008-11", "0.4"), ("2017-07", "0.36")],
    "1656": [("2000-01", "0.062"), ("2015-07", "0.058"), ("2024-03", "0.052")],
    "1657": [("2005-01", "0.162")],
    "1761": [("2002-07", "0.07"), ("2008-05", "0.065"), ("2009-10", "0.058"),
             ("2012-10", "0.055"), ("2014-10", "0.05")],
    "1871": [("2001-07", "0.21"), ("2008-10", "0.2"), ("2021-09", "0.18")],
    "1891": [("2000-01", "0.12"), ("2001-01", "0.134"), ("2005-01", "0.2828"),
             ("2009-10", "0.2954"), ("2013-09", "0.2644"), ("2014-10", "0.23"),
             ("2021-10", "0.21"), ("2024-10", "0.134")],
    "1922": [("2000-01", "0.2"), ("2000-07", "0.25")],
    "1923": [("2000-01", "0.19")],
    "1951": [("2000-01", "0.35"), ("2001-01", "0.5")],
}


def scalar(value):
    return format(Decimal(value).normalize(), "f")


def quote(code, period, spec, row, dimension, fallbacks=None):
    fallbacks = FALLBACKS if fallbacks is None else fallbacks
    if dimension == "package":
        return "1", "Native surveyed package; no physical conversion inferred."
    if dimension == "count":
        if code == "1714":
            return ("3" if "2002-07" <= period <= "2010-10" else "1"), \
                "Dated pudding cups: three-cup pack or one cup."
        if code == "1911":
            return ("25" if period < "2013-07" else "1" if period < "2014-01" else "10"), \
                "Dated quotation: 25 tea bags per box, then one tea bag, then ten tea bags."
        if code == "1731":
            return "12", "Dated caramel box contains twelve pieces."
        return "1", "Source quotes one surveyed item, portion or skewer."

    for start, end, quantity in CONFLICT_CAPACITIES.get(code, []):
        if start <= period <= end:
            return quantity, "Reviewed dated definition overrides an inconsistent historical quantity caption."
    if code == "1491" and period < "2014-09":
        # Statistics Bureau's February 2018 headline, p15, explicitly identifies
        # the September 2014 transition as solid-contents/1 can -> solid-contents/1kg.
        quantity = "0.275" if period < "2002-07" else "0.145" if period < "2004-01" else "0.13"
        return quantity, "Exact dated drained-solid contents per can; liquid is excluded from the common weight basis."

    # Direct physical survey quote takes precedence over any contents/ranges in
    # the definition (e.g. 100 g cheese selected from 126 g or 144 g packages).
    source_unit = normalized(spec.get("unit")).lower().replace(",", "")
    direct = {"100g": "0.1", "1kg": "1", "10kg": "10"} if dimension == "kg" else {
        "100ml": "0.1", "1000ml": "1"}
    if source_unit in direct:
        return direct[source_unit], "Dated specification explicitly quotes a standard physical quantity."

    header = normalized(row["unit"]).lower().replace(",", "")
    if not any(t in header for t in ("~", "～", "又は", "or")):
        unit_pattern = r"(\d+(?:\.\d+)?)(kg|g)" if dimension == "kg" else r"(\d+(?:\.\d+)?)(ml|l)"
        matches = list(re.finditer(unit_pattern, header))
        if len(matches) == 1:
            match = matches[0]
            value = Decimal(match[1])
            if match[2] in {"g", "ml"}:
                value /= 1000
            suffix, prefix = header[match.end():], header[:match.start()]
            multiplier = re.match(r"(?:袋|本|個|枚|包|pieces?|pouches?)?[×x](\d+)", suffix)
            preceding = re.search(r"(\d+)(?:袋|本|個|枚|包|pieces?|pouches?)[×x]$", prefix)
            consumed = 0
            if multiplier:
                value *= Decimal(multiplier[1])
                consumed += 1
            if preceding:
                value *= Decimal(preceding[1])
                consumed += 1
            multiplication_marks = header.count("×") + len(re.findall(r"(?<=\d)x|x(?=\d)", header))
            if multiplication_marks != consumed:
                raise ValueError(f"Unreviewed multiplication in native quotation {code}, {period}, {row['unit']}")
            return scalar(value), "Native price header explicitly gives this exact physical quotation."

    if code in fallbacks:
        approved = [q for start, q in fallbacks[code] if start <= period]
        if approved:
            return approved[-1], "Printed price header omits capacity; exact dated definition supplies it."
    raise ValueError(f"Unresolved quote {code} {period}: {row['unit']} / {spec}")


def build(staging, current, existing, previous=None, initialize=False, *,
          meta=None, variants=None, variant_labels=None, fallbacks=None,
          expected_codes=None, unreviewed_periods=None):
    meta = META if meta is None else meta
    variants = VARIANTS if variants is None else variants
    variant_labels = VARIANT_LABELS if variant_labels is None else variant_labels
    fallbacks = FALLBACKS if fallbacks is None else fallbacks
    unreviewed_periods = [] if unreviewed_periods is None else unreviewed_periods
    snapshots = staging["snapshots"]
    if not snapshots or snapshots[0]["month"] != "2000-01" or snapshots[-1]["month"] != AUDITED_END:
        raise ValueError("A changed source cutoff requires a new dated review")
    done = {p["code"] for p in current["products"] + existing["products"]}
    needed = expected_codes if expected_codes is not None else {
        p["code"] for p in snapshots[-1]["prices"] if 1000 <= int(p["code"]) < 2100} - done
    if set(meta) != needed:
        raise ValueError(f"Metadata mismatch extra={set(meta)-needed}, missing={needed-set(meta)}")
    accepted_hashes, accepted_units = {}, {}
    if previous is None and not initialize:
        raise ValueError("Initial dated mapping requires --initialize")
    if previous is not None:
        if previous.get("unreviewedSourcePeriods", []) != unreviewed_periods:
            raise ValueError("Unreviewed source period allowlist changed; a new dated review is required")
        for p in previous["products"]:
            for approval in p["reviewedSpecifications"]:
                h = approval["specificationHash"]
                accepted_hashes.setdefault(p["code"], set()).add(h)
                accepted_units.setdefault((p["code"], h), set()).update(
                    normalized(u) for u in approval["sourceUnits"])
    for rule in unreviewed_periods:
        if rule["code"] not in meta or rule.get("requireMissingBasicDefinition") is not True or not rule.get("reason"):
            raise ValueError("Invalid unreviewed source-period rule")
        if not "2000-01" <= rule["start"] <= rule["end"] <= AUDITED_END:
            raise ValueError("Unreviewed source-period rule outside audited window")
        covered = [snapshot for snapshot in snapshots if rule["start"] <= snapshot["month"] <= rule["end"]]
        if not covered or covered[0]["month"] != rule["start"] or covered[-1]["month"] != rule["end"]:
            raise ValueError("Unreviewed source-period bounds not present in staging")
        for snapshot in covered:
            rows = [r for r in snapshot["prices"] if r["code"] == rule["code"]]
            if len(rows) != 1 or rule["code"] in snapshot["specs"]:
                raise ValueError(f"Unreviewed-period evidence changed {rule['code']} {snapshot['month']}")
    products, audit, unresolved = [], [], []
    for code, base in meta.items():
        bounds = variants.get(code, [("2000-01", AUDITED_END, base["id"], base["unit"])])
        forms = {}
        for start, end, slug, dimension in bounds:
            if slug not in forms:
                en, ja = variant_labels.get(slug, (base["en"], base["ja"]))
                note = PACKAGE_NOTE if dimension == "package" else (
                    COUNT_NOTE if dimension == "count" else GENERIC_NOTE)
                if code in {"1331", "2042", "1011"}:
                    note = {language: note[language] + " " + PRICE_QUOTE_NOTE[language]
                            for language in ("en", "ja")}
                if code == "1491":
                    note = {language: note[language] + " " + CORN_NOTE[language]
                            for language in ("en", "ja")}
                if code == "1041":
                    note = {language: note[language] + " " + DRIED_NOODLES_NOTE[language]
                            for language in ("en", "ja")}
                forms[slug] = {**base, "id": slug, "en": en, "ja": ja, "unit": dimension,
                    "familyId": base["id"], "quoteQuantity": "1",
                    "presets": {"kg": ["0.1", "0.5", "1"], "L": ["0.25", "0.5", "1"],
                                "count": ["1", "5", "10"], "package": ["1", "2", "3"]}[dimension],
                    "comparisonNote": note,
                    "missingPriceEstimate": {"maxMonths": 2, "tokens": ["-"], "allowEquivalentSegments": True},
                    "sourceNameSegments": [], "reviewedSpecifications": []}
            p = forms[slug]
            for snapshot_index, snapshot in enumerate(staging["snapshots"]):
                period = snapshot["month"]
                if not start <= period <= end:
                    continue
                rows = [row for row in snapshot["prices"] if row["code"] == code]
                if not rows:
                    continue
                if len(rows) != 1:
                    raise ValueError(f"Duplicate {code} {period}")
                if code not in snapshot["specs"]:
                    permitted = [rule for rule in unreviewed_periods if rule["code"] == code
                                 and rule["start"] <= period <= rule["end"]]
                    if len(permitted) != 1:
                        raise ValueError(f"Missing dated basic definition {code}, {period}")
                    continue
                row, spec = rows[0], snapshot["specs"][code]
                h = specification_hash(spec)
                if previous is not None and h not in accepted_hashes.get(code, set()):
                    raise ValueError(f"Unreviewed specification {code}, {period}, {h}")
                if previous is not None and normalized(row["unit"]) not in accepted_units.get((code, h), set()):
                    raise ValueError(f"Unreviewed native quote unit {code}, {period}, {row['unit']}")
                try:
                    q, reason = quote(code, period, spec, row, dimension, fallbacks)
                except ValueError as error:
                    unresolved.append(str(error)); continue
                append_run(p["sourceNameSegments"], {"name": row["name"], "specName": spec["name"]},
                           period, ["name", "specName"])
                value = {"specificationHash": h, "quoteQuantity": q, "quoteUnit": dimension,
                         "quoteLabel": label(q, dimension), "surveyMonths": survey_months(spec),
                         "sourceUnits": [row["unit"]], "continuityFromPrevious": True,
                         "continuityReason": CONTINUITY_REASON,
                         "continuityEvidence": [snapshot["specSource"]["url"]]}
                if code == "1491":
                    value["continuityEvidence"].append(CORN_BASIS_EVIDENCE)
                conflict = any(start <= period <= end for start, end, _ in CONFLICT_CAPACITIES.get(code, []))
                if conflict:
                    conversion = {"from": dimension, "to": dimension, "factor": "1", "estimated": True,
                                  "basis": "dated-specification-over-conflicting-price-caption",
                                  "evidenceUrl": snapshot["specSource"]["url"],
                                  "description": PRICE_QUOTE_NOTE}
                    value["quantityConversion"] = conversion
                    value["quantityConversionHash"] = conversion_hash(conversion)
                approvals = p["reviewedSpecifications"]
                equivalent = ["specificationHash", "quoteQuantity", "quoteUnit", "surveyMonths", "quantityConversionHash"]
                if approvals and all(approvals[-1].get(k) == value.get(k) for k in equivalent) and \
                        approvals[-1]["end"] == staging["snapshots"][snapshot_index-1]["month"]:
                    approvals[-1]["end"] = period
                    if row["unit"] not in approvals[-1]["sourceUnits"]:
                        approvals[-1]["sourceUnits"].append(row["unit"])
                else:
                    if not approvals:
                        value["continuityFromPrevious"] = False
                        value["continuityReason"] = "First observed reviewed period for this food form."
                    elif approvals[-1]["end"] != snapshots[snapshot_index-1]["month"]:
                        value["continuityFromPrevious"] = False
                        value["continuityReason"] = "This form returns after an inactive or separately defined period; no intervening history is inferred."
                    approvals.append({"start": period, "end": period, **value})
                audit.append({"code": code, "id": slug, "month": period, "specificationHash": h,
                              "sourceUnit": row["unit"], "spec": spec, "quoteQuantity": q,
                              "quoteUnit": dimension, "reason": reason,
                              "priceSources": [s["url"] for s in snapshot["sources"]],
                              "specSource": snapshot["specSource"]["url"]})
        for p in forms.values():
            if p["reviewedSpecifications"]:
                p["quoteQuantity"] = p["reviewedSpecifications"][-1]["quoteQuantity"]
                products.append(p)
    return {"schemaVersion": 1, "reviewedAt": "2026-10-10", "policyVersion": "1.2",
            "approvedWindow": {"start": "2000-01", "end": "2026-08"},
            "policy": existing["policy"], "reviewedMissingTokens": existing["reviewedMissingTokens"],
            "ownerAuthorization": existing["ownerAuthorization"], "candidateSourceCodes": list(meta),
            "products": products, "existingProductUpdates": [],
            "notAdmitted": existing["notAdmitted"], **({
                "unreviewedSourcePeriods": unreviewed_periods} if unreviewed_periods else {})}, audit, unresolved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staging", type=Path, default=ROOT / "data/staging/food-history-complete.json")
    parser.add_argument("--current", type=Path, default=ROOT / "data/catalog-review.json")
    parser.add_argument("--first-expansion", type=Path, default=ROOT / "data/food-expansion-review.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/remaining-food-review.json")
    parser.add_argument("--audit", type=Path, help="Optional ignored detailed conversion evidence")
    parser.add_argument("--initialize", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    staging = json.loads(args.staging.read_text(encoding="utf8"))
    current = json.loads(args.current.read_text(encoding="utf8"))
    existing = json.loads(args.first_expansion.read_text(encoding="utf8"))
    previous = json.loads(args.output.read_text(encoding="utf8")) if args.output.exists() else None
    review, audit, unresolved = build(staging, current, existing, previous, args.initialize)
    if unresolved:
        raise ValueError(f"Unresolved conversions: {unresolved[:5]}")
    if len({p["id"] for p in review["products"]}) != len(review["products"]):
        raise ValueError("Duplicate public food form IDs")
    payload = json.dumps(review, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf8") != payload:
            raise ValueError("Tracked remaining-food review differs from dated source evidence")
    else:
        args.output.write_text(payload, encoding="utf8", newline="\n")
    if args.audit:
        args.audit.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
    print(f"Reviewed {len(review['products'])} forms for {len(META)} remaining current food codes")


if __name__ == "__main__":
    main()
