# Quantity evidence appendix

This appendix documents bounded quantity interpretations for the January 2000–August 2026 food
archive. It supports [data_policy.json](data_policy.json) and the [data methodology](DATA.md).
Original observations, captions, specifications, missing tokens and source cells remain unchanged.
Calculations use dated quoted quantities; uncertain interpretations are explicitly estimated.

## Caption and specification conflicts

A printed package caption can disagree with the dated basic specification. A resolution requires
the specification, applicable change register and adjacent source observations together. Matching
prices alone cannot establish a package size. These decisions are calculation interpretations,
not claims that the government issued an undocumented correction.

| Code / food            | Affected months                   | Printed caption   | Reviewed calculation                                                                                                                                                       |
| ---------------------- | --------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1011 glutinous rice    | January 2002                      | One 5 kg bag      | The dated specification establishes a 1 kg bag. Use a 1 kg divisor; mark derived quantity costs estimated.                                                                 |
| 1331 cheese            | January and March 2000            | One 200 g box     | The dated specification establishes 225 g. Use 225 g; mark derived quantity costs estimated. February and April captions also say 225 g.                                   |
| 1331 cheese            | May–October 2005                  | One 190 g bag     | The May specification and register establish 180 g. Use 180 g; mark derived quantity costs estimated. The caption changes in November.                                     |
| 1491 canned sweet corn | January–October and December 2003 | One 435 g can     | The July 2002 definition establishes 230 g gross / 145 g drained. Use the documented 145 g of kernels. November 2003 also prints 230 g.                                    |
| 1784 jelly             | April 2010                        | One 180–260 g cup | The effective definition establishes 150–200 g. Retain a cup quantity; neither range establishes actual mass. March and May captions also give 150–200 g.                  |
| 2042 imported wine     | January 2000–December 2006        | One 720 mL bottle | Corresponding basic specifications establish 750 mL. Use 750 mL; mark derived quantity costs estimated. The January 2007 caption changes without a retained size revision. |

Rice, cheese and wine use an estimated conversion marker with factor 1: the dated quote quantity
already supplies the divisor, so the marker communicates uncertainty without changing the price a
second time. Native numeric prices remain observed. This quantity uncertainty is distinct from
missing-price carry-forward and persists in observed-only mode.

## Evidence for the bounded interpretations

For rice, the [January 2002 specification](https://www.stat.go.jp/data/kouri/doukou/zuhyou/200201.xls)
and 2002 register establish a 1 kg bag. The isolated 5 kg caption is cell `M10`, sheet `A001-1`, in
the [January price workbook](https://www.e-stat.go.jp/stat-search/file-download?statInfId=000000680568&fileKind=0).
Tokyo's native quotes are ¥592, ¥587 and ¥582 in December 2001–February 2002; Sapporo quotes ¥587
throughout and Osaka quotes ¥523, ¥493 and ¥493. Applying the isolated 5 kg caption would create an
artificial approximately 80% price fall and reversal, unsupported by the dated definition.

For cheese, the [January 2000 specification](https://www.stat.go.jp/data/kouri/doukou/zuhyou/200001.xls)
establishes 225 g. Osaka's native price is ¥362 in each of January–April despite alternating captions.
The [May 2005 specification](https://www.stat.go.jp/data/kouri/doukou/zuhyou/200505.xls) and the register's
May revision establish the later 180 g amount.

For wine, the [January 2000](https://www.stat.go.jp/data/kouri/doukou/zuhyou/200001.xls) and
[January 2007](https://www.stat.go.jp/data/kouri/doukou/zuhyou/200701.xls) specifications both say 750 mL.
Sapporo's ¥1,680 and Osaka's ¥1,413 quotes are unchanged across December 2006–January 2007; Tokyo moves
from ¥1,149 to ¥1,144. Treating the caption as an actual bottle-size revision would add an artificial
approximately 4% change. The interpretation remains estimated because no retained official correction
explains the disagreement.

The [official change register](https://www.stat.go.jp/data/kouri/doukou/zuhyou/shinkyu.xlsx) provides
additional locators: rice, 2002 sheet row 7; cheese, 2005 row 54; corn, 2002 row 57; jelly, 2010 row 89.
Merged month cells belong to their containing month group; a blank child cell is not an unknown date.

## Corn: drained kernels across reporting changes

[Statistical Today No.127](https://www.stat.go.jp/info/today/127.htm), reference table 1, explicitly
describes the September 2014 change from a 130 g solid-content can to a 120–130 g solid-content product
reported per kg. The same table appears in the [February 2018 report](https://www.stat.go.jp/info/headline/pdf/201802.pdf),
page 15. Gross contents including liquid are not a comparable kernel quantity.

| Effective period         | Original quoted package    | Divisor for drained kernels |
| ------------------------ | -------------------------- | --------------------------: |
| January 2000–June 2002   | 435 g gross / 275 g solids |                    0.275 kg |
| July 2002–December 2003  | 230 g gross / 145 g solids |                    0.145 kg |
| January 2004–August 2014 | 190 g gross / 130 g solids |                    0.130 kg |
| September 2014 onward    | Published per-kg price     |                        1 kg |

Tokyo's August 2014 ¥142 can therefore costs approximately ¥1,092.31/kg of kernels, followed by
September's published ¥1,049/kg. Using the old 190 g gross mass would give ¥747.37/kg and manufacture
a large increase at the reporting change. Permitted package ranges do not authorize an inferred
midpoint when a per-kg quote is already published.

## Physically different forms

| Code / boundary                  | Unsupported equivalence                                                                       | Treatment                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1462 wakame, March 2026          | Wet salted and dried cut wakame both quote 100 g, but dehydration changes the usable amount   | Separate forms; no inferred rehydration factor. [Specification](https://www.stat.go.jp/data/kouri/doukou/zuhyou/202603.xlsx) |
| 1110 red sea bream, January 2007 | Whole fish includes head and bones; a 100 g sashimi block does not have the same edible yield | Separate forms; no inferred yield factor. [Specification](https://www.stat.go.jp/data/kouri/doukou/zuhyou/200701.xls)        |

## Verification and reproducibility

The conflict review independently checked all **105 affected product-months** from **96 distinct
price workbooks**, their **315 city price cells** in Tokyo, Sapporo and Osaka, original captions and
dated definitions from **42 specification files**. Evidence SHA-256 hashes and byte lengths matched
receipts. Direct XLS cell reads used the retained one-based sheet, row and column locators; raw
evidence was not modified. These checks establish faithful transcription and the stated evidence,
not certainty about an undocumented government correction.

Detailed verification receipts are retained separately from the source repository.
The committed
[food expansion](../data/food-expansion-review.json), [remaining food](../data/remaining-food-review.json)
and [retired food](../data/retired-food-review.json) mappings retain dated quantities, source URLs,
conflict windows and uncertainty notes. The [approved manifest](../data/fixtures/recent-approved.manifest.json)
retains the corresponding reviewed segments. Offline builds reproduce those decisions; revising
them requires new dated evidence and the normal review gates.
