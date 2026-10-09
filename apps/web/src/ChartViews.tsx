import { useMemo, useRef, useState } from 'react';
import type {
  Basket,
  CityData,
  Locale,
  Product,
  Release,
} from '../../../packages/domain/src/contracts';
import { evaluate, type Result } from '../../../packages/domain/src/domain';
import { PriceChart } from './PriceChart';
import type { DashboardText } from './dashboardMessages';

export function ChartViews({
  basket,
  release,
  city,
  rows,
  locale,
  observedOnly,
  t,
  yen,
  percent,
}: {
  basket: Basket;
  release: Release;
  city?: CityData;
  rows: Result[];
  locale: Locale;
  observedOnly: boolean;
  t: DashboardText;
  yen: (v: string | null | undefined) => string;
  percent: (v: string | null | undefined) => string;
}) {
  const [tab, setTab] = useState('cost');
  const [chosen, setChosen] = useState('');
  const tabs = [
    { id: 'cost', label: t.tabCost },
    { id: 'breakdown', label: t.tabBreakdown },
    { id: 'product', label: t.tabProduct },
    { id: 'index', label: t.tabIndex },
    { id: 'data', label: t.tabData },
  ];
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const products = basket.items.map((i) => release.products.find((p) => p.id === i.productId)!);
  const selected = products.find((p) => p.id === chosen) ?? products[0];
  const productRows = useMemo(
    () =>
      selected && rows.length && city
        ? evaluate(
            {
              ...basket,
              items: basket.items.filter((i) => i.productId === selected.id),
            },
            release,
            city,
            observedOnly,
          )
        : [],
    [selected, basket, release, city, observedOnly, rows.length],
  );
  const last = rows.at(-1);
  const shown = tab === 'product' ? productRows : rows;
  const measure = tab === 'index' ? 'index' : 'cost';
  const text = (key: string) => t[key as keyof DashboardText] ?? key;
  function quality(row: Result) {
    const notes = row.items
      .filter((i) => i.status !== 'observed')
      .map((i) => {
        const p = products.find((p) => p.id === i.productId)!;
        return `${p.names[locale]}: ${text(i.reason)}${i.anchor ? ` · ${t.anchor} ${i.anchor} · ${i.age} ${t.age}` : ''}`;
      });
    if (!row.comparable) notes.push(t.breakWarning);
    if (row.yoyEstimated) notes.push(t.yoyEstimated);
    if (row.change !== null && (row.status === 'estimated' || rows[0]?.status === 'estimated'))
      notes.push(t.estimatedChange);
    return notes.join(' · ');
  }
  return (
    <div className="chart-views">
      <div className="chart-tabs" role="tablist" aria-label={t.chartViews}>
        {tabs.map((view, index) => (
          <button
            key={view.id}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            role="tab"
            id={`tab-${view.id}`}
            aria-controls={`panel-${view.id}`}
            aria-selected={view.id === tab}
            tabIndex={view.id === tab ? 0 : -1}
            onClick={() => setTab(view.id)}
            onKeyDown={(e) => {
              let next = index;
              if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
              else if (e.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
              else if (e.key === 'Home') next = 0;
              else if (e.key === 'End') next = tabs.length - 1;
              else return;
              e.preventDefault();
              setTab(tabs[next].id);
              buttons.current[next]?.focus();
            }}
          >
            {view.label}
          </button>
        ))}
      </div>
      {tabs.map((view) => (
        <div
          key={view.id}
          role="tabpanel"
          id={`panel-${view.id}`}
          aria-labelledby={`tab-${view.id}`}
          hidden={tab !== view.id}
          className="chart-panel"
          tabIndex={0}
        >
          {tab === view.id &&
            (tab === 'breakdown' ? (
              <>
                <div className="view-heading">
                  <h3>{t.latestItems}</h3>
                  <span className="hint">{basket.end} · JPY</span>
                </div>
                <div className="breakdown-list" tabIndex={0} role="region" aria-label={t.breakdown}>
                  {!products.length && <p className="notice">{t.empty}</p>}
                  {products.map((p) => {
                    const item = last?.items.find((i) => i.productId === p.id);
                    const max = Math.max(1, ...(last?.items.map((i) => Number(i.cost ?? 0)) ?? []));
                    const difference = last?.contributions[p.id];
                    return (
                      <div className="breakdown-row" key={p.id}>
                        <div className="breakdown-label">
                          <strong>{p.names[locale]}</strong>
                          <span className="breakdown-value">{yen(item?.cost)}</span>
                        </div>
                        <div className="bar-track" aria-hidden="true">
                          <div
                            className={`bar ${item?.status === 'estimated' ? 'estimated-bar' : ''}`}
                            style={{
                              width: `${Math.max(0, (Number(item?.cost ?? 0) / max) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="hint breakdown-note">
                          <span>
                            {text(item?.status ?? 'unavailable')}
                            {item?.anchor ? ` · ${t.anchor} ${item.anchor}` : ''}
                          </span>
                          <span>
                            {t.contribution}:{' '}
                            {difference == null
                              ? '—'
                              : `${Number(difference) > 0 ? '+' : ''}${yen(difference)}`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : tab === 'data' ? (
              <div className="table-scroll" tabIndex={0} role="region" aria-label={t.table}>
                <table className="monthly-table">
                  <caption>
                    {release.cities.find((c) => c.id === basket.cityId)!.names[locale]} ·{' '}
                    {basket.start} – {basket.end}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{t.month}</th>
                      <th scope="col">{t.cost}</th>
                      <th scope="col">{t.change}</th>
                      <th scope="col">{t.yoy}</th>
                      <th scope="col">{t.status}</th>
                      <th scope="col">{t.notes}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.month}>
                        <th scope="row">{row.month}</th>
                        <td className="numeric">{yen(row.cost)}</td>
                        <td className="numeric">{percent(row.change)}</td>
                        <td className="numeric">{percent(row.yoy)}</td>
                        <td>{text(row.status)}</td>
                        <td className="quality-notes">{quality(row) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                {tab === 'product' && (
                  <div className="view-heading">
                    <div className="product-series">
                      <label htmlFor="chart-series">{t.series}</label>
                      <select
                        id="chart-series"
                        value={selected?.id ?? ''}
                        onChange={(e) => setChosen(e.target.value)}
                      >
                        {!products.length && <option value="">—</option>}
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.names[locale]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="hint">
                      {basket.start} – {basket.end}
                    </span>
                  </div>
                )}
                <div className="chart-canvas">
                  <PriceChart
                    rows={shown}
                    measure={measure}
                    products={tab === 'product' && selected ? [selected] : products}
                    locale={locale}
                    label={`${tab === 'product' ? (selected?.names[locale] ?? t.series) : t.total} · ${measure === 'index' ? t.index : t.yen}`}
                    empty={t.noGraph}
                    t={t}
                    seriesKey={JSON.stringify([
                      release.releaseId,
                      basket.cityId,
                      measure,
                      tab === 'product' ? selected?.id : basket.items.map((item) => item.productId),
                      basket.start,
                      basket.end,
                      observedOnly,
                    ])}
                  />
                </div>
              </>
            ))}
        </div>
      ))}
    </div>
  );
}
