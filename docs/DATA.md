# Data and methodology

Japan Price Basket compares the nominal cost of fixed quantities of goods in a selected Japanese
survey city. Prices come from the Statistics Bureau of Japan's **Retail Price Survey, Trend Survey**.
The application is independent of the Statistics Bureau and does not reproduce the official Consumer
Price Index (CPI). See [data attribution and reuse](../DATA_ATTRIBUTION.md) for terms.

## Sources and access

| Source                                                                                                                                    | Use                                                       | Access                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Retail Price Survey monthly archive](https://www.stat.go.jp/data/kouri/doukou/3.html)                                                    | Monthly city prices, dated basic and local specifications | Public XLS, XLSX and CSV downloads; no account required                                                 |
| [e-Stat city price database](https://www.e-stat.go.jp/dbview?sid=0003421913)                                                              | Table discovery and monthly city price distributions      | Public downloads; the [API](https://www.e-stat.go.jp/api/api-info/api-guide) requires an application ID |
| [Specification change register](https://www.stat.go.jp/data/kouri/doukou/zuhyou/shinkyu.xlsx)                                             | Effective dates and evidence for product changes          | Public workbook                                                                                         |
| [2025 Family Income and Expenditure Survey, Table 6-2](https://www.e-stat.go.jp/stat-search/files?layout=dataset&stat_infid=000040424635) | Starter basket quantity reference                         | Public workbook; contributes no prices                                                                  |

One official source family supplies histories, definitions, units and city rosters, avoiding mixed
collection methods or retailer promotions. Table IDs and URLs are retained as source locators;
their permanence is not assumed. Prices are city averages for specified products, including
consumption tax, rather than quotations from a named supermarket or a sales-weighted national average.
Fresh-food monthly averages combine observations from three parts of the month; ten-day and annual
observations cannot replace complete months. Local specifications can differ between cities.
See the [official table notes](https://www.stat.go.jp/english/data/kouri/doukou/15i1.html).

## Published coverage

The bundled release is `rps-2026-08-bb299a380848`: **January 2000–August 2026**,
320 monthly periods. Not every product or city has observations throughout this interval.
The survey predates 2000, but the [1950–2010 Tokyo history](https://www.stat.go.jp/data/kouri/doukou/zuhyou/kubu_chouki.xls)
contains annual prices for selected Tokyo goods, not earlier all-city monthly observations.

| Measure                                                   |      Reviewed release |
| --------------------------------------------------------- | --------------------: |
| Current city food and drink codes                         |                   218 |
| Historical food codes                                     |                    56 |
| Food forms with dated definitions                         |                   304 |
| All source codes / product forms / specification segments |       277 / 311 / 962 |
| Current cities / separate historical geographic scopes    |               81 / 16 |
| Published records / unique native source cells            | 5,279,889 / 5,261,365 |
| Actual numeric prices                                     |             4,192,674 |

The catalog covers grains, bread, noodles, meat, fish, dairy, eggs, vegetables, fruit, seaweed, oils,
seasonings, sweets, prepared foods and drinks, including alcohol. Some household goods are retained;
detergent is disabled. Restaurants, school meals and unreviewed national series are excluded.
Source codes, dated forms and eligible search results are different counts.

All actual prices were independently reconciled with their recorded cells in 760 original price
workbooks. This includes 119 supplementary workbooks contributing 97,216 native cells. Early Tokyo
observations remain Tokyo-only. Original units, definitions, raw tokens, hashes and cell locators
are retained.

Important coverage limits:

- Introductions, retirements and roster changes retain actual dates. Forty-seven current food codes
  lack a January 2000 definition.
- Tokyo special wards excludes the rest of Tokyo prefecture. Municipal predecessors and changed
  scopes remain separate. Toyohashi's absent January 2020–December 2024 roster is preserved.
- National codes 1924 (self-service coffee), 1972 (fermented milk drink) and 1984 (delivered water)
  need separate scope review; historical city observations do not establish continuing city prices.
- Regional codes 1061, 1121, 1122, 1291, 1439 and 1440 have 492 September 2000–June 2007 code-month rows
  excluded pending local-definition evidence.
- Retired lamb, caramel and imported chocolate have Tokyo prices for January–August 2000 only.

Search offers products usable across the entire selected city, interval and estimate mode.
Missing histories cannot be filled from other cities or hidden by omitting an unavailable item.

## Product identity and continuity

Stable product IDs have dated specification segments retaining original Japanese definitions,
official codes, quote quantities, local applicability and effective dates. A shared official code
does not establish comparability. Reviewed wording, brand, grade, size-selection and packaging changes
may continue a generic food history, with exact dated quantities normalized. Comparisons include
selection and quality effects; they are neither quality-adjusted CPI nor officially seasonally
adjusted prices. Unsupported form changes remain separate: wet versus dried wakame, whole fish versus
sashimi, and powder versus liquid detergent. Unresolved boundaries block basket comparisons.

Bilingual search uses names, reviewed aliases/readings, codes and dated specification terms, with
normalized Unicode width, case and whitespace. Reviewed readings support hiragana and katakana.
Brands match only applicable dated definitions; a brand mentioned in a generic definition does not
create a separately priced product. [searchMetadata.ts](../packages/domain/src/searchMetadata.ts)
records English spellings supported by [Kikkoman](https://www.kikkoman.com/en/),
[Yamasa](https://www.yamasa.com/brand/) and [Kewpie](https://www.kewpie.com/en/products/mayonnaise/).

## Quantity normalization

For native price `P`, quoted amount `U` and compatible selected amount `Q`, cost is `P × Q / U`.
Decimal precision is retained through summation; rounding is for display. Fractional packs express
cost for a fixed amount, rather than the minimum whole-package payment at a checkout. Mass, volume
and exact pack contents convert only within supported dimensions. A head, block, cup or weight range
does not establish exact mass; midpoint, edible-yield, density and rehydration factors are not inferred.

Egg count costs for January 2000–June 2002 use the actual kg quote and approximately **60 g per whole
egg**, from the [original specification](https://www.stat.go.jp/data/kouri/doukou/zuhyou/200001.xls).
This is explicitly estimated; later ten-egg packs have exact count conversions. Corn consistently
uses drained kernels. Bounded rice, cheese and wine caption conflicts retain estimated quantity
interpretations, while jelly keeps a cup unit where mass is uncertain. The
[quantity appendix](FOOD_QUANTITY_RECONCILIATION.md) records dates, divisors, evidence and verification;
these interpretations do not alter native prices or assert undocumented government corrections.

## Missing prices and estimates

[data_policy.json](data_policy.json) governs calculations. A blank or symbol is never a zero price,
and a `not surveyed` token alone does not establish seasonality.

| Situation                                                                              | Treatment                                                                                                 |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Valid complete monthly observation                                                     | Use the observed native price and its dated quantity definition                                           |
| Reviewed short gap, including approved `-` cells                                       | Carry the last actual price for at most two calendar months; the precise historical cause is not asserted |
| Published off-season cell under a dated survey calendar                                | Carry an actual observation from the preceding season, with an absolute age cap of 11 calendar months     |
| First complete month of a new survey season                                            | Require a new observation; stop the previous season's carry                                               |
| Longer unexplained gap, unresolved boundary, discontinued product or absent city scope | Unavailable                                                                                               |

Carries retain actual anchor month, age and native conversion. They never chain, precede the first
observation, cross unresolved changes or borrow another city/product. Observed-only mode disables
price carries; estimated quantity interpretations of actual prices remain estimated. Charts and
tables distinguish observed, estimated and unavailable costs.

## Basket interpretation and starter quantities

City, products and quantities stay fixed. A total includes every selected item: observed when all
costs are observed, estimated when any cost is estimated, unavailable when any item cannot be valued.
Percentage change requires positive usable endpoints and reviewed continuity; individual percentage
changes are not averaged. The index uses the selected baseline cost as 100.

The 16-food starter uses 2025 FIES annual purchases by nationwide households with two or more people,
divided by 12 and rounded. Households vary in size; this is neither a two-person meal plan, complete
food budget nor dietary recommendation. RPS choices are category proxies: Koshihikari for rice,
domestic pork for pork, chicken thigh for chicken and lean sashimi tuna for tuna.

| Food          | Fixed quantity | Food        | Fixed quantity |
| ------------- | -------------: | ----------- | -------------: |
| Rice          |           5 kg | Cabbage     |        1.25 kg |
| White bread   |         1.5 kg | Onions      |         1.2 kg |
| Domestic pork |           2 kg | Potatoes    |          700 g |
| Chicken thigh |         1.5 kg | Carrots     |          600 g |
| Tuna          |          150 g | Bananas     |         1.5 kg |
| Momen tofu    |           2 kg | Cooking oil |          600 g |
| Eggs          |        40 eggs | Soy sauce   |         300 mL |
| Carton milk   |            6 L | Miso        |          400 g |

FIES tofu blocks have no established weight; 2 kg is an illustrative mass. Forty eggs are approximately
2.4 kg under the disclosed assumption. [defaultBasket.ts](../packages/domain/src/defaultBasket.ts)
records quantities and stable IDs. Reset retains every food and chooses the city's latest common
continuous interval. With estimates, the starter supports the full published window of 80 of 81
current cities; 59 support January 2000–August 2026.

The [FIES workbook](https://www.e-stat.go.jp/stat-search/file-download?fileKind=4&statInfId=000040424635)
receipt is 71,797 bytes, SHA-256
`8c395ff18325c5923903e5e05889b2d22fca7fc3a88409507bc18cfdd117e402`.
Sheet `a06200`, year cell `H39`, name row 10 and unit row 12 identify the source.
Value cells are rice `I39`, bread `K39`, tuna `AA39`, pork `BF39`, chicken `BG39`,
milk `BM39`, eggs `BP39`, cabbage `BS39`, potatoes `CC39`, carrots `CF39`, onions
`CH39`, tofu `DA39`, bananas `DR39`, oil `DV39`, soy sauce `DY39` and miso `DZ39`.

## Freshness, review and reproducibility

Observation month, publication date, retrieval/check time and application build time are separate.
**Now** means the latest included complete month, not the calendar month. Retrieval does not prove
that later reports were checked or ingested; partial-month Tokyo releases cannot advance the city
cutoff. Visitors read versioned static data without contacting e-Stat.

Acquisition, native staging, review, normalization and publication are separate steps. New months
and corrections require explicit checks of definitions, units, rosters, calendars, tokens, duplicates
and large revisions. Downloads and parser success do not approve publication. Failed acquisition or
review leaves the published dataset intact. Evidence keeps original bytes, SHA-256 hashes and
immutable receipts; parser repairs never edit workbooks. Revisions retain source versions/locators,
estimates recalculate from actual anchors, and release/policy IDs accompany results. Saved baskets
retain dataset-change notices until acknowledged.

The approved [build input](../data/fixtures/recent-approved.json.gz) is 45,142,970 bytes, SHA-256
`bb299a3808481a237f1128513fe5859781ca5225969b01f96da688c751b26463`.
[Its manifest](../data/fixtures/recent-approved.manifest.json) records coverage and definitions.
Machine-readable reviews are
[catalog](../data/catalog-review.json), [food expansion](../data/food-expansion-review.json),
[remaining food](../data/remaining-food-review.json), [retired food](../data/retired-food-review.json)
and [geography](../data/legacy-geography-review.json). Raw caches, staging and detailed receipts stay
outside Git. A clean checkout builds the approved data; source auditing requires retained evidence.

See [architecture](ARCHITECTURE.md), [development](DEVELOPMENT.md) and [operations](OPERATIONS.md)
for partitions, checks and release procedures. The [official CPI methodology](https://www.stat.go.jp/english/data/cpi/1585.htm)
explains the different scope and weighting of Japan's official inflation index.
