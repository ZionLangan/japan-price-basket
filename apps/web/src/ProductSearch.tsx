import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  MAX_BASKET_ITEMS,
  type CityData,
  type Locale,
  type Product,
} from '../../../packages/domain/src/contracts';
import {
  monthNumber,
  productEligibility,
  searchProducts,
} from '../../../packages/domain/src/domain';
import type { DashboardText } from './dashboardMessages';

export function ProductSearch({
  products,
  selected,
  city,
  start,
  month,
  observedOnly,
  loading,
  historyStart,
  historyEnd,
  locale,
  t,
  onAdd,
  maxItems = MAX_BASKET_ITEMS,
}: {
  products: Product[];
  selected: string[];
  city?: CityData;
  start: string;
  month: string;
  observedOnly: boolean;
  loading: boolean;
  historyStart: string;
  historyEnd: string;
  locale: Locale;
  t: DashboardText;
  onAdd: (product: Product) => void;
  maxItems?: number;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const catalog = products.filter((product) => product.selectable !== false);
  const eligible = useMemo(
    () =>
      !city || loading || start > month
        ? []
        : products.filter(
            (product) =>
              product.selectable !== false &&
              productEligibility(product, city.series[product.id] ?? [], start, month, observedOnly)
                .eligible,
          ),
    [products, city, start, month, observedOnly, loading],
  );
  const range = { start, end: month };
  const matches = searchProducts(eligible, query, category, range);
  const catalogMatches = searchProducts(catalog, query, category, range);
  const atLimit = selected.length >= maxItems;
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
  const matchIds = matches.map((product) => product.id).join('|');
  useEffect(() => setActive(0), [matchIds]);
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  function choose(product: Product) {
    if (atLimit || selected.includes(product.id) || !eligible.some((p) => p.id === product.id))
      return;
    onAdd(product);
    setQuery('');
    setActive(0);
    input.current?.focus();
    setOpen(false);
  }
  return (
    <div
      ref={root}
      className="search-area"
      role="search"
      aria-label={t.searchTitle}
      aria-busy={loading}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor="search">{t.search}</label>
      <div className="search-input">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10" cy="10" r="6.5" />
          <path d="m15 15 6 6" />
        </svg>
        <input
          id="search"
          ref={input}
          role="combobox"
          autoComplete="off"
          disabled={loading || !city}
          value={query}
          placeholder={t.searchHint}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? `${id}-results` : undefined}
          aria-activedescendant={
            open && matches[activeIndex] ? `${id}-${matches[activeIndex].id}` : undefined
          }
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              const next = open
                ? (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) %
                  Math.max(1, matches.length)
                : 0;
              setActive(next);
              document
                .getElementById(`${id}-${matches[next]?.id}`)
                ?.scrollIntoView({ block: 'nearest' });
            }
            if (e.key === 'Enter' && open && matches[activeIndex]) {
              e.preventDefault();
              choose(matches[activeIndex]);
            }
          }}
        />
        {query && (
          <button
            className="text-button"
            aria-label={t.searchTitle + ' · ' + t.clear}
            onClick={() => {
              setQuery('');
              setActive(0);
              input.current?.focus();
              setOpen(true);
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && !loading && city && (
        <div className="search-menu">
          {atLimit && (
            <p className="notice" role="status">
              {t.basketLimit}
            </p>
          )}
          <div className="search-filter">
            <label htmlFor="category">{t.category}</label>
            <select
              id="category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setActive(0);
              }}
            >
              <option value="all">{t.all}</option>
              <option value="food">{t.food}</option>
              <option value="household">{t.household}</option>
            </select>
          </div>
          <div
            id={`${id}-results`}
            role="listbox"
            aria-label={t.productList}
            className="search-results"
          >
            {matches.map((p, index) => {
              const added = selected.includes(p.id);
              const observations = city?.series[p.id]?.filter(
                (r) => r.status === 'observed',
              ).length;
              const latestObserved = city.series[p.id]
                ?.filter((row) => row.status === 'observed' && row.month <= month)
                .at(-1)?.month;
              const segment = p.segments.find((s) => s.start <= month && s.end >= month);
              const first = p.segments[0].start;
              const last = p.segments.at(-1)!.end;
              const limited = first > historyStart || last < historyEnd;
              const interrupted = p.segments.some(
                (segment, index) =>
                  index > 0 &&
                  monthNumber(segment.start) > monthNumber(p.segments[index - 1].end) + 1,
              );
              return (
                <div
                  key={p.id}
                  id={`${id}-${p.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-disabled={added || atLimit}
                  aria-label={`${added ? t.alreadyAdded : t.add}: ${p.names[locale]}`}
                  className="search-result"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(p)}
                >
                  <div>
                    <strong>{p.names[locale]}</strong>
                    <span className="hint">
                      {segment?.quoteLabel?.[locale] ?? p.quoteLabel[locale]} · {p.code}
                      {limited ? ` · ${first} – ${last}` : ''}
                      {interrupted ? ` · ${t.interruptedPeriods}` : ''}
                      {segment && segment.surveyMonths.length < 12 ? ` · ${t.seasonalProduct}` : ''}
                      {latestObserved && latestObserved < month
                        ? ` · ${t.latestObserved}: ${latestObserved}`
                        : ''}
                      {observations === 0 ? ` · ${t.noCityPrices}` : ''}
                    </span>
                  </div>
                  <span className={added || atLimit ? 'hint' : 'add-label'}>
                    {added ? t.alreadyAdded : '+ ' + t.add}
                  </span>
                </div>
              );
            })}
          </div>
          {!matches.length && (
            <p className="notice" role="status">
              {catalogMatches.length || !eligible.length ? t.noEligibleResults : t.noResults}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
