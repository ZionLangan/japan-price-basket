import { useEffect, useId, useRef, useState } from 'react';
import type { CityData, Locale, Product } from '../../../packages/domain/src/contracts';
import { searchProducts } from '../../../packages/domain/src/domain';
import type { DashboardText } from './dashboardMessages';

export function ProductSearch({
  products,
  selected,
  city,
  locale,
  t,
  onAdd,
}: {
  products: Product[];
  selected: string[];
  city?: CityData;
  locale: Locale;
  t: DashboardText;
  onAdd: (product: Product) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const matches = searchProducts(products, query, category);
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  function choose(product: Product) {
    if (selected.includes(product.id)) return;
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
          value={query}
          placeholder={t.searchHint}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? `${id}-results` : undefined}
          aria-activedescendant={
            open && matches[active] ? `${id}-${matches[active].id}` : undefined
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
                ? (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) %
                  Math.max(1, matches.length)
                : 0;
              setActive(next);
              document
                .getElementById(`${id}-${matches[next]?.id}`)
                ?.scrollIntoView({ block: 'nearest' });
            }
            if (e.key === 'Enter' && open && matches[active]) {
              e.preventDefault();
              choose(matches[active]);
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
      {open && (
        <div className="search-menu">
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
              return (
                <div
                  key={p.id}
                  id={`${id}-${p.id}`}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={added}
                  aria-label={`${added ? t.alreadyAdded : t.add}: ${p.names[locale]}`}
                  className="search-result"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(p)}
                >
                  <div>
                    <strong>{p.names[locale]}</strong>
                    <span className="hint">
                      {p.quoteLabel[locale]} · {p.code}
                      {observations === 0 ? ` · ${t.noCityPrices}` : ''}
                    </span>
                  </div>
                  <span className={added ? 'hint' : 'add-label'}>
                    {added ? t.alreadyAdded : '+ ' + t.add}
                  </span>
                </div>
              );
            })}
          </div>
          {!matches.length && (
            <p className="notice" role="status">
              {t.noResults}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
