import { convertQuantity } from '../../../packages/domain/src/domain';
import {
  PositiveDecimal,
  type Basket,
  type Locale,
  type Product,
} from '../../../packages/domain/src/contracts';
import type { DashboardText } from './dashboardMessages';

export function LiveBasket({
  basket,
  products,
  locale,
  t,
  issues,
  update,
  onClear,
  onReset,
}: {
  basket: Basket;
  products: Product[];
  locale: Locale;
  t: DashboardText;
  issues: Record<string, string>;
  update: (basket: Basket) => void;
  onClear: () => void;
  onReset: () => void;
}) {
  const unitLabel = (unit: string) =>
    unit === 'package' ? t.package : unit === 'count' ? t.count : unit;
  function patch(id: string, change: Partial<Basket['items'][number]>) {
    update({
      ...basket,
      items: basket.items.map((i) =>
        i.productId === id ? { ...i, ...change, quantityEstimated: undefined } : i,
      ),
    });
  }
  return (
    <aside className="live-basket" aria-labelledby="basket-heading">
      <div className="basket-heading">
        <h2 id="basket-heading">{t.basketTitle}</h2>
        <span className="hint">
          {basket.items.length} {t.itemCount}
        </span>
        <button className="text-button" disabled={!basket.items.length} onClick={onClear}>
          {t.clear}
        </button>
      </div>
      <div className="quantity-column-labels quantity-controls" aria-hidden="true">
        <span>{t.quantity}</span>
        <span>{t.unit}</span>
        <span>{t.presets}</span>
      </div>
      <div
        className="basket-items"
        tabIndex={0}
        role="region"
        aria-label={t.basketTitle + ' · ' + t.quantity}
      >
        {!basket.items.length && <p className="notice">{t.empty}</p>}
        {basket.items.map((item) => {
          const p = products.find((p) => p.id === item.productId)!;
          const valid = PositiveDecimal.safeParse(item.quantity).success;
          return (
            <div className="basket-row" key={p.id}>
              <div className="basket-row-heading">
                <strong>{p.names[locale]}</strong>
                <button
                  className="text-button definition-button"
                  popoverTarget={`definition-${p.id}`}
                  aria-label={`${t.definition}: ${p.names[locale]}`}
                >
                  {t.details}
                </button>
                <button
                  className="text-button remove"
                  aria-label={`${t.remove}: ${p.names[locale]}`}
                  onClick={() =>
                    update({ ...basket, items: basket.items.filter((i) => i.productId !== p.id) })
                  }
                >
                  ×
                </button>
              </div>
              <div className="quantity-controls">
                <div>
                  <label className="sr-only" htmlFor={`qty-${p.id}`}>
                    {p.names[locale]} · {t.quantity}
                  </label>
                  <input
                    id={`qty-${p.id}`}
                    inputMode="decimal"
                    value={item.quantity}
                    aria-invalid={!valid}
                    aria-describedby={!valid ? `error-${p.id}` : undefined}
                    onChange={(e) => patch(p.id, { quantity: e.target.value })}
                  />
                </div>
                <div>
                  <label className="sr-only" htmlFor={`unit-${p.id}`}>
                    {p.names[locale]} · {t.unit}
                  </label>
                  <select
                    id={`unit-${p.id}`}
                    value={item.unit}
                    onChange={(e) => {
                      const unit = e.target.value as Product['unit'];
                      patch(p.id, {
                        unit,
                        quantity: valid
                          ? convertQuantity(item.quantity, item.unit, unit)
                          : item.quantity,
                      });
                    }}
                  >
                    {p.units.map((u) => (
                      <option key={u} value={u}>
                        {unitLabel(u)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="sr-only" htmlFor={`preset-${p.id}`}>
                    {p.names[locale]} · {t.presets}
                  </label>
                  <select
                    id={`preset-${p.id}`}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) patch(p.id, { quantity: e.target.value });
                    }}
                  >
                    <option value="">—</option>
                    {p.presets.map((q) => {
                      const value = convertQuantity(q, p.unit, item.unit);
                      return (
                        <option key={q} value={value}>
                          {value} {unitLabel(item.unit)}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
              {!valid && (
                <p className="error" id={`error-${p.id}`}>
                  {t.invalidQuantity}
                </p>
              )}
              {issues[p.id] && <p className="notice">{issues[p.id]}</p>}
              {item.quantityEstimated && <p className="notice">{t.eggQuantityEstimate}</p>}
              <div
                className="source-popover product-definition"
                id={`definition-${p.id}`}
                popover="auto"
                role="region"
                aria-label={`${t.definition}: ${p.names[locale]}`}
              >
                <div className="popover-heading">
                  <h2>
                    {p.names[locale]} · {t.definition}
                  </h2>
                  <button
                    className="text-button"
                    popoverTarget={`definition-${p.id}`}
                    popoverTargetAction="hide"
                    aria-label={locale === 'en' ? 'Close product details' : '銘柄を閉じる'}
                  >
                    ×
                  </button>
                </div>
                {p.comparisonNote && <p className="notice">{p.comparisonNote[locale]}</p>}
                {p.segments.map((s, index) => (
                  <div key={s.id}>
                    <p className="hint">
                      {s.start} – {s.end} · {p.code}
                    </p>
                    <p>
                      {t.quote}: {s.quoteLabel?.[locale] ?? p.quoteLabel[locale]}
                    </p>
                    {s.quantityConversion?.estimated && (
                      <p className="notice">{s.quantityConversion.description[locale]}</p>
                    )}
                    {index > 0 && !s.continuityFromPrevious && (
                      <p className="notice">{t.breakWarning}</p>
                    )}
                    <p lang="ja">{s.definition}</p>
                    <p lang="ja">{s.detail}</p>
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer">
                      {t.officialSpec}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="basket-bottom">
        <button className="text-button" onClick={onReset}>
          {t.reset}
        </button>
      </div>
    </aside>
  );
}
