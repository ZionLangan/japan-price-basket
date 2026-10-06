import type { Basket, Release } from '../../../packages/domain/src/contracts';
import type { Result } from '../../../packages/domain/src/domain';

const cell = (value: unknown) => {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export function makeCsv(basket: Basket, release: Release, rows: Result[]) {
  const header = [
    'release_id',
    'basket_name',
    'city_code',
    'month',
    'baseline_month',
    'basket_cost_jpy',
    'basket_status',
    'basket_change_percent',
    'baseline_index',
    'comparison_status',
    'comparison_estimated_endpoint',
    'year_over_year_percent',
    'year_over_year_estimated',
    'product_id',
    'source_code',
    'quantity',
    'quantity_unit',
    'item_cost_jpy',
    'item_status',
    'source_price_jpy',
    'source_quoted_unit',
    'source_sheet',
    'source_excel_row',
    'segment_id',
    'reason',
    'actual_anchor_month',
    'age_months',
    'item_change_from_baseline_jpy',
    'source_url',
  ];
  const records = rows.flatMap((r) =>
    r.items.map((i) => {
      const selection = basket.items.find((b) => b.productId === i.productId)!;
      const product = release.products.find((p) => p.id === i.productId)!;
      return [
        release.releaseId,
        basket.name,
        basket.cityId,
        r.month,
        basket.start,
        r.cost,
        r.status,
        r.change,
        r.index,
        !r.comparable
          ? 'unresolved_break'
          : rows[0]?.cost === null
            ? 'unavailable_baseline'
            : r.cost === null
              ? 'unavailable_target'
              : 'comparable',
        r.change !== null && (r.status === 'estimated' || rows[0]?.status === 'estimated'),
        r.yoy,
        r.yoyEstimated,
        i.productId,
        product.code,
        selection.quantity,
        selection.unit,
        i.cost,
        i.status,
        i.price,
        i.sourceUnit,
        i.sourceSheet,
        i.sourceRow,
        i.segmentId,
        i.reason,
        i.anchor,
        i.age,
        r.contributions[i.productId],
        release.sources.find((s) => s.id === i.sourceId)?.url ?? '',
      ];
    }),
  );
  return '\uFEFF' + [header, ...records].map((r) => r.map(cell).join(',')).join('\r\n');
}
export function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
