import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { z } from 'zod';
import {
  CityDataSchema,
  ReleaseSchema,
  PositiveDecimal,
  validateBasket,
  type Basket,
  type CityData,
  type Locale,
  type Product,
  type Release,
} from '../../../packages/domain/src/contracts';
import {
  evaluate,
  months,
  searchProducts,
  convertQuantity,
  type Result,
} from '../../../packages/domain/src/domain';
import { en, ja, type MessageKey } from './messages';
import { readState, writeState, parseImport } from './storage';
import { download, makeCsv } from './downloads';
import { PriceChart } from './PriceChart';

async function loadRelease(): Promise<Release> {
  const response = await fetch('/data/current.json');
  if (!response.ok) throw new Error('loadError');
  const pointer = z
    .object({
      releaseId: z.string().regex(/^rps-20\d{2}-\d{2}-[a-f0-9]{12}$/),
      manifest: z.string(),
    })
    .parse(await response.json());
  if (pointer.manifest !== `${pointer.releaseId}/manifest.json`) throw new Error('loadError');
  const data = await fetch(`/data/${pointer.manifest}`);
  if (!data.ok) throw new Error('loadError');
  const release = ReleaseSchema.parse(await data.json());
  if (release.releaseId !== pointer.releaseId) throw new Error('loadError');
  return release;
}
async function loadCity(release: Release, cityId: string, signal: AbortSignal): Promise<CityData> {
  const city = release.cities.find((c) => c.id === cityId)!;
  const response = await fetch(`/data/${release.releaseId}/${city.file}`, { signal });
  if (!response.ok) throw new Error('loadError');
  const bytes = await response.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (hash !== city.sha256) throw new Error('loadError');
  const data = CityDataSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (data.releaseId !== release.releaseId || data.cityId !== cityId || data.scopeId !== cityId)
    throw new Error('loadError');
  return data;
}
function example(release: Release, cityId = '13100', kind = 'staples'): Basket {
  const ids =
    kind === 'home'
      ? ['cling-film', 'dishwashing-liquid', 'liquid-laundry-detergent']
      : kind === 'curry'
        ? ['potatoes', 'onions', 'carrots']
        : ['white-bread', 'white-sugar', 'cabbage', 'potatoes', 'carrots'];
  const items = ids.map((productId) => ({
    productId,
    quantity: kind === 'curry' ? (productId === 'carrots' ? '0.3' : '0.5') : '1',
    unit: release.products.find((p) => p.id === productId)!.unit,
  }));
  const boundary =
    kind === 'home'
      ? ids
          .flatMap((id) => release.products.find((p) => p.id === id)!.segments)
          .map((s) => s.start)
          .sort()
          .at(-1)!
      : release.start;
  return {
    schemaVersion: 1,
    name:
      kind === 'home'
        ? 'Household / 家庭用消耗品'
        : kind === 'curry'
          ? 'Curry vegetables / カレー用の野菜'
          : 'Staples / 基本食材',
    cityId,
    start: boundary,
    end: release.end,
    items,
  };
}

export function App() {
  const [release, setRelease] = useState<Release>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    loadRelease()
      .then((r) => {
        if (active) setRelease(r);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (!release)
    return (
      <main className="container boot">
        <h1>{en.title} / 日本の買い物かご価格</h1>
        <p role={error ? 'alert' : 'status'}>
          {error ? `${en.loadError} / ${ja.loadError}` : `${en.loading} / ${ja.loading}`}
        </p>
        {error && (
          <button onClick={() => setAttempt((a) => a + 1)}>
            {en.retry} / {ja.retry}
          </button>
        )}
      </main>
    );
  return <Workbench release={release} />;
}

function Workbench({ release }: { release: Release }) {
  const [initial] = useState(() => {
    try {
      return { state: readState(release, window.localStorage), issue: '' };
    } catch (err) {
      return {
        state: null,
        issue:
          err instanceof z.ZodError || (err instanceof Error && err.message === 'storageInvalid')
            ? 'storageInvalid'
            : 'storageUnavailable',
      };
    }
  });
  const [basket, setBasket] = useState<Basket>(initial.state?.current ?? example(release));
  const [locale, setLocale] = useState<Locale>(initial.state?.locale ?? 'en');
  const [saved, setSaved] = useState<Basket[]>(initial.state?.saved ?? []);
  const [observedOnly, setObservedOnly] = useState(initial.state?.observedOnly ?? false);
  const [storageIssue, setStorageIssue] = useState(initial.issue);
  const [preserveStored, setPreserveStored] = useState(initial.issue === 'storageInvalid');
  const [cityData, setCityData] = useState<CityData>();
  const [cityError, setCityError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [chartProduct, setChartProduct] = useState('basket');
  const [measure, setMeasure] = useState<'cost' | 'index'>('cost');
  const [message, setMessage] = useState<MessageKey | ''>('');
  const [exampleKind, setExampleKind] = useState('staples');
  const [selectedSaved, setSelectedSaved] = useState(initial.state?.current.name ?? '');
  const t = locale === 'en' ? en : ja;
  const text = (key: string) => t[key as MessageKey] ?? key;
  const selectedCity = release.cities.find((c) => c.id === basket.cityId)!;
  const products = basket.items.map((i) => release.products.find((p) => p.id === i.productId)!);
  const inputError: MessageKey | '' = basket.items.some(
    (i) => !PositiveDecimal.safeParse(i.quantity).success,
  )
    ? 'invalidQuantity'
    : basket.start > basket.end
      ? 'invalidRange'
      : !basket.name.trim() || basket.name.trim().length > 80
        ? 'invalidName'
        : '';
  const ready = cityData?.cityId === basket.cityId && !inputError;
  const results = useMemo(
    () => (ready ? evaluate(basket, release, cityData!, observedOnly) : []),
    [basket, release, cityData, observedOnly, ready],
  );
  const shownBasket = useMemo(
    () =>
      chartProduct === 'basket'
        ? basket
        : {
            ...basket,
            items: basket.items.filter((i) => i.productId === chartProduct),
          },
    [basket, chartProduct],
  );
  const shownProducts = products.filter((p) => chartProduct === 'basket' || p.id === chartProduct);
  const shownRows = useMemo(
    () => (ready ? evaluate(shownBasket, release, cityData!, observedOnly) : []),
    [shownBasket, ready, release, cityData, observedOnly],
  );
  const last = results.at(-1);
  const yen = (value: string | null | undefined) =>
    value == null
      ? '—'
      : new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ja-JP', {
          style: 'currency',
          currency: 'JPY',
          maximumFractionDigits: 0,
        }).format(Number(value));
  const percent = (value: string | null) =>
    value === null
      ? '—'
      : `${new Decimal(value).gt(0) ? '+' : ''}${new Decimal(value).toFixed(1)}%`;
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.title;
  }, [locale, t.title]);
  useEffect(() => {
    const controller = new AbortController();
    setCityData(undefined);
    setCityError(false);
    loadCity(release, basket.cityId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setCityData(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCityError(true);
      });
    return () => controller.abort();
  }, [release, basket.cityId, retry]);
  useEffect(() => {
    if (!basket.items.some((i) => i.productId === chartProduct)) setChartProduct('basket');
  }, [basket.items, chartProduct]);
  useEffect(() => {
    if (preserveStored || inputError) return;
    try {
      writeState(
        {
          schemaVersion: 1,
          releaseId: release.releaseId,
          locale,
          observedOnly,
          current: validateBasket(basket, release),
          saved,
        },
        window.localStorage,
      );
    } catch {
      setStorageIssue('storageUnavailable');
    }
  }, [basket, saved, locale, observedOnly, release, inputError, preserveStored]);
  function updateItem(id: string, patch: Partial<Basket['items'][number]>) {
    setBasket((b) => ({
      ...b,
      items: b.items.map((i) => (i.productId === id ? { ...i, ...patch } : i)),
    }));
  }
  function changeUnit(id: string, unit: Product['unit']) {
    const item = basket.items.find((i) => i.productId === id)!;
    const quantity =
      PositiveDecimal.safeParse(item.quantity).success && item.unit !== unit
        ? convertQuantity(item.quantity, item.unit, unit)
        : item.quantity;
    updateItem(id, { unit, quantity });
  }
  function saveBasket() {
    if (inputError) return;
    if (saved.length >= 10 && !saved.some((b) => b.name === basket.name.trim())) {
      setMessage('saveLimit');
      return;
    }
    const valid = validateBasket(basket, release);
    const nextSaved = [...saved.filter((b) => b.name !== valid.name), valid];
    setSaved(nextSaved);
    setSelectedSaved(valid.name);
    setPreserveStored(false);
    if (storageIssue === 'storageInvalid') setStorageIssue('');
    try {
      writeState(
        {
          schemaVersion: 1,
          releaseId: release.releaseId,
          locale,
          observedOnly,
          current: valid,
          saved: nextSaved,
        },
        window.localStorage,
      );
      setMessage('savedSuccess');
    } catch {
      setStorageIssue('storageUnavailable');
      setMessage('storageUnavailable');
    }
  }
  async function importBasket(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 64 * 1024) throw new Error('invalidBasket');
      setBasket(parseImport(await file.text(), release));
      setMessage('imported');
    } catch {
      setMessage('invalidBasket');
    }
  }
  function quality(row: Result) {
    const notes = row.items
      .filter((i) => i.status !== 'observed')
      .map((i) => {
        const p = release.products.find((p) => p.id === i.productId)!;
        return `${p.names[locale]}: ${text(i.reason)}${i.anchor ? ` · ${t.anchor} ${i.anchor} · ${i.age} ${t.age}` : ''}`;
      });
    if (!row.comparable) notes.push(t.breakWarning);
    if (row.yoyEstimated) notes.push(t.yoyEstimated);
    if (row.change !== null && (row.status === 'estimated' || shownRows[0]?.status === 'estimated'))
      notes.push(t.estimatedChange);
    return notes;
  }
  const visibleProducts = searchProducts(release.products, query, category);
  return (
    <>
      <a className="skip" href="#builder">
        {t.skip}
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <span className="site-name">{t.title}</span>
          <nav className="site-nav">
            <a href="#basket-heading">{t.basketTitle}</a>
            <a href="#results-heading">{t.results}</a>
          </nav>
          <div className="language" aria-label="Language / 言語">
            <button
              className="secondary"
              lang="en"
              aria-pressed={locale === 'en'}
              onClick={() => setLocale('en')}
            >
              English
            </button>
            <button
              className="secondary"
              lang="ja"
              aria-pressed={locale === 'ja'}
              onClick={() => setLocale('ja')}
            >
              日本語
            </button>
          </div>
        </div>
      </header>
      <main className="container" id="builder">
        <div className="opening">
          <p className="eyebrow">{t.prototype}</p>
          <h1>{t.title}</h1>
          <p>{t.intro}</p>
          <p className="metadata">
            {t.months}:{' '}
            <strong>
              {release.start} – {release.end}
            </strong>{' '}
            · {t.source}: {release.sourceName[locale]}
          </p>
          <div className="city-control">
            <label htmlFor="city">{t.city}</label>
            <select
              id="city"
              value={basket.cityId}
              onChange={(e) => setBasket((b) => ({ ...b, cityId: e.target.value }))}
            >
              {release.cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.names[locale]}
                  {locale === 'en' ? ` / ${c.names.ja}` : ''}
                </option>
              ))}
            </select>
            <span className="metadata">
              {t.coverage}: {selectedCity.start} – {selectedCity.end}
            </span>
          </div>
        </div>
        <p className="feedback" role="status" aria-live="polite">
          {message && t[message]}
        </p>
        {storageIssue && (
          <p className="notice" role="status">
            {text(storageIssue)}
          </p>
        )}
        {cityError ? (
          <div className="notice" role="alert">
            <p>{t.loadError}</p>
            <button onClick={() => setRetry((r) => r + 1)}>{t.retry}</button>
          </div>
        ) : (
          !cityData && <p role="status">{t.loadingCity}</p>
        )}
        <div className="builder-grid">
          <section aria-labelledby="search-heading">
            <h2 id="search-heading">{t.searchTitle}</h2>
            <label htmlFor="search">{t.search}</label>
            <input
              id="search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-describedby="search-hint"
            />
            <p className="hint" id="search-hint">
              {t.searchHint}
            </p>
            <label htmlFor="category">{t.category}</label>
            <select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">{t.all}</option>
              <option value="food">{t.food}</option>
              <option value="household">{t.household}</option>
            </select>
            <div className="catalog" role="region" tabIndex={0} aria-label={t.productList}>
              {!visibleProducts.length && <p>{t.noResults}</p>}
              {visibleProducts.map((p) => {
                const count = cityData?.series[p.id]?.filter((o) => o.status === 'observed').length;
                const inBasket = basket.items.some((i) => i.productId === p.id);
                return (
                  <div className="product-row" key={p.id}>
                    <div className="product-summary">
                      <div>
                        <strong>{p.names[locale]}</strong>
                        {locale === 'en' && (
                          <span className="secondary-name" lang="ja">
                            {p.names.ja}
                          </span>
                        )}
                        <span className="metadata">
                          {p.code} · {t.quote}: {p.quoteLabel[locale]}
                        </span>
                        <span className="metadata">
                          {count === undefined
                            ? t.loadingCity
                            : count
                              ? `${count}/${months(release.start, release.end).length} ${t.observations}`
                              : t.noCityPrices}
                        </span>
                      </div>
                      <button
                        className="secondary"
                        disabled={inBasket || count === 0 || count === undefined}
                        aria-label={`${inBasket ? t.alreadyAdded : t.add}: ${p.names[locale]}`}
                        onClick={() => {
                          setBasket((b) => ({
                            ...b,
                            items: [...b.items, { productId: p.id, quantity: '1', unit: p.unit }],
                          }));
                          setMessage('added');
                        }}
                      >
                        {inBasket ? t.alreadyAdded : t.add}
                      </button>
                    </div>
                    <details>
                      <summary>{t.definition}</summary>
                      {p.segments.length > 1 && <p className="notice">{t.breakWarning}</p>}
                      {p.segments.map((s) => (
                        <div key={s.id} className="specification">
                          <strong>
                            {s.start} – {s.end}
                          </strong>
                          <p lang="ja">
                            {s.definition || p.names.ja}
                            {s.detail ? ` · ${s.detail}` : ''}
                          </p>
                          <a href={s.sourceUrl}>{t.officialSpec}</a>
                        </div>
                      ))}
                    </details>
                  </div>
                );
              })}
            </div>
          </section>
          <section aria-labelledby="basket-heading">
            <h2 id="basket-heading">{t.basketTitle}</h2>
            <label htmlFor="basket-name">{t.basketName}</label>
            <input
              id="basket-name"
              value={basket.name}
              maxLength={80}
              onChange={(e) => setBasket((b) => ({ ...b, name: e.target.value }))}
            />
            <div className="example-control">
              <label htmlFor="example-kind">{t.exampleKind}</label>
              <select
                id="example-kind"
                value={exampleKind}
                onChange={(e) => setExampleKind(e.target.value)}
              >
                <option value="staples">{t.staples}</option>
                <option value="curry">{t.curry}</option>
                <option value="home">{t.home}</option>
              </select>
            </div>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => setBasket(example(release, basket.cityId, exampleKind))}
              >
                {t.useExample}
              </button>
              <button
                className="text-button"
                disabled={!basket.items.length}
                onClick={() => setBasket((b) => ({ ...b, items: [] }))}
              >
                {t.clear}
              </button>
            </div>
            <p className="hint">{t.exampleHint}</p>
            {!basket.items.length && <p className="notice">{t.empty}</p>}
            <div className="basket-items">
              {basket.items.map((item, index) => {
                const p = products[index],
                  valid = PositiveDecimal.safeParse(item.quantity).success;
                return (
                  <div className="basket-row" key={p.id}>
                    <div className="basket-row-heading">
                      <strong>{p.names[locale]}</strong>
                      <button
                        className="text-button"
                        aria-label={`${t.remove}: ${p.names[locale]}`}
                        onClick={() =>
                          setBasket((b) => ({
                            ...b,
                            items: b.items.filter((i) => i.productId !== p.id),
                          }))
                        }
                      >
                        {t.remove}
                      </button>
                    </div>
                    <div className="quantity-controls">
                      <div>
                        <label htmlFor={`qty-${p.id}`}>{t.quantity}</label>
                        <input
                          id={`qty-${p.id}`}
                          inputMode="decimal"
                          value={item.quantity}
                          aria-invalid={!valid}
                          aria-describedby={!valid ? `error-${p.id}` : undefined}
                          onChange={(e) => updateItem(p.id, { quantity: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`unit-${p.id}`}>{t.unit}</label>
                        <select
                          id={`unit-${p.id}`}
                          value={item.unit}
                          onChange={(e) => changeUnit(p.id, e.target.value as Product['unit'])}
                        >
                          {p.units.map((u) => (
                            <option key={u} value={u}>
                              {u === 'package' ? t.package : u}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`preset-${p.id}`}>{t.presets}</label>
                        <select
                          id={`preset-${p.id}`}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) updateItem(p.id, { quantity: e.target.value });
                          }}
                        >
                          <option value="">—</option>
                          {p.presets.map((q) => {
                            const value = convertQuantity(q, p.unit, item.unit);
                            return (
                              <option key={q} value={value}>
                                {value} {item.unit === 'package' ? t.package : item.unit}
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
                    {p.segments.length > 1 && (
                      <p className="hint">
                        {t.breakWarning} {p.segments[1].start}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="hint">{t.quantityNote}</p>
            <div className="saved-baskets">
              <label htmlFor="saved">{t.saved}</label>
              <select
                id="saved"
                value=""
                onChange={(e) => {
                  const found = saved.find((s) => s.name === e.target.value);
                  if (found) {
                    setBasket(found);
                    setSelectedSaved(found.name);
                  }
                }}
              >
                <option value="">{t.selectSaved}</option>
                {saved.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
              <div className="actions">
                <button disabled={Boolean(inputError)} onClick={saveBasket}>
                  {t.save}
                </button>
                <button
                  className="secondary"
                  disabled={
                    Boolean(inputError) ||
                    selectedSaved === basket.name ||
                    !saved.some((s) => s.name === selectedSaved)
                  }
                  onClick={() => {
                    if (saved.some((s) => s.name === basket.name.trim())) {
                      setMessage('nameExists');
                      return;
                    }
                    const valid = validateBasket(basket, release);
                    setSaved((s) => s.map((b) => (b.name === selectedSaved ? valid : b)));
                    setSelectedSaved(valid.name);
                    setMessage('savedSuccess');
                  }}
                >
                  {t.rename}
                </button>
                <button
                  className="secondary"
                  disabled={!saved.some((b) => b.name === basket.name)}
                  onClick={() => {
                    setSaved((s) => s.filter((b) => b.name !== basket.name));
                    setMessage('deleted');
                  }}
                >
                  {t.deleteSaved}
                </button>
              </div>
            </div>
          </section>
        </div>
        <section className="results" aria-labelledby="results-heading">
          <h2 id="results-heading">{t.results}</h2>
          <div className="date-controls">
            <div>
              <label htmlFor="start">{t.start}</label>
              <select
                id="start"
                value={basket.start}
                onChange={(e) => setBasket((b) => ({ ...b, start: e.target.value }))}
              >
                {months(release.start, release.end).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="end">{t.end}</label>
              <select
                id="end"
                value={basket.end}
                onChange={(e) => setBasket((b) => ({ ...b, end: e.target.value }))}
              >
                {months(release.start, release.end).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={observedOnly}
                onChange={(e) => setObservedOnly(e.target.checked)}
              />
              {t.observedOnly}
            </label>
          </div>
          <p className="hint">{t.carryNote}</p>
          {inputError && (
            <p className="error" role="alert">
              {t[inputError]} {t.inputFix}
            </p>
          )}
          <div className="totals" aria-live="polite">
            <div>
              <span>
                {t.lastCost} · {basket.end}
              </span>
              <strong>{yen(last?.cost)}</strong>
              <span>{last && text(last.status)}</span>
            </div>
            <div>
              <span>
                {t.change} · {basket.start}
              </span>
              <strong>{last ? percent(last.change) : '—'}</strong>
              {last && last.change === null && basket.items.length > 0 && (
                <span>{t.notComparable}</span>
              )}
              {last?.change !== null &&
                (last?.status === 'estimated' || results[0]?.status === 'estimated') && (
                  <span>{t.estimatedChange}</span>
                )}
            </div>
          </div>
          {last && (
            <p>
              {t.yoy}: <strong>{percent(last.yoy)}</strong>
              {last.yoyEstimated && ` · ${t.yoyEstimated}`}
            </p>
          )}
          {last && basket.items.length > 0 && (
            <details className="breakdown">
              <summary>{t.breakdown}</summary>
              <div className="table-scroll" tabIndex={0} role="region" aria-label={t.breakdown}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t.item}</th>
                      <th scope="col">{t.cost}</th>
                      <th scope="col">{t.difference}</th>
                      <th scope="col">{t.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {last.items.map((i) => (
                      <tr key={i.productId}>
                        <th scope="row">
                          {release.products.find((p) => p.id === i.productId)!.names[locale]}
                        </th>
                        <td className="numeric">{yen(i.cost)}</td>
                        <td className="numeric">
                          {yen(last.contributions[i.productId])}
                          {last.contributions[i.productId] !== null &&
                            (i.status === 'estimated' ||
                              results[0]?.items.find((item) => item.productId === i.productId)
                                ?.status === 'estimated') && (
                              <div className="hint">{t.estimatedChange}</div>
                            )}
                        </td>
                        <td>{text(i.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <div className="chart-controls">
            <div>
              <label htmlFor="chart-series">{t.chartSeries}</label>
              <select
                id="chart-series"
                value={chartProduct}
                onChange={(e) => setChartProduct(e.target.value)}
              >
                <option value="basket">{t.total}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.names[locale]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="measure">{t.chartMeasure}</label>
              <select
                id="measure"
                value={measure}
                onChange={(e) => setMeasure(e.target.value as 'cost' | 'index')}
              >
                <option value="cost">{t.yen}</option>
                <option value="index">{t.index}</option>
              </select>
            </div>
          </div>
          <h3>
            {chartProduct === 'basket'
              ? t.total
              : products.find((p) => p.id === chartProduct)?.names[locale]}{' '}
            · {selectedCity.names[locale]}
          </h3>
          <p className="hint">{measure === 'cost' ? t.yen : t.index}</p>
          <PriceChart
            rows={shownRows}
            measure={measure}
            products={shownProducts}
            locale={locale}
            label={t.chart}
            empty={t.noGraph}
          />
          <p className="hint">{t.graphNote}</p>
          <details className="monthly-table" open>
            <summary>{t.table}</summary>
            <div className="table-scroll" tabIndex={0} role="region" aria-label={t.table}>
              <table>
                <caption>
                  {t.table} · {selectedCity.names[locale]} · {basket.start} – {basket.end}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t.month}</th>
                    <th scope="col">{t.cost}</th>
                    <th scope="col">{t.status}</th>
                    <th scope="col">%</th>
                    <th scope="col">{t.yoy}</th>
                    <th scope="col">{t.notes}</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((row) => (
                    <tr key={row.month}>
                      <th scope="row">{row.month}</th>
                      <td className="numeric">{yen(row.cost)}</td>
                      <td>{text(row.status)}</td>
                      <td className="numeric">{percent(row.change)}</td>
                      <td className="numeric">{percent(row.yoy)}</td>
                      <td>
                        {quality(row).map((note, i) => (
                          <div key={i}>{note}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className="downloads" aria-labelledby="download-heading">
          <h2 id="download-heading">{t.downloadTitle}</h2>
          <div className="actions">
            <button
              className="secondary"
              disabled={Boolean(inputError)}
              onClick={() =>
                download(
                  JSON.stringify(validateBasket(basket, release), null, 2),
                  'japan-basket.json',
                  'application/json',
                )
              }
            >
              {t.exportBasket}
            </button>
            <label className="file-button">
              {t.importBasket}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  void importBasket(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              className="secondary"
              disabled={!shownRows.length || !basket.items.length}
              onClick={() =>
                download(
                  makeCsv(shownBasket, release, shownRows),
                  'japan-basket-prices.csv',
                  'text/csv;charset=utf-8',
                )
              }
            >
              {t.exportCsv}
            </button>
          </div>
          <p className="hint">{t.storageNote}</p>
          <button
            className="text-button"
            onClick={() => {
              setSaved([]);
              setBasket(example(release));
              setLocale('en');
              setObservedOnly(false);
              setPreserveStored(false);
              setSelectedSaved('');
              setMessage('resetSuccess');
              if (storageIssue === 'storageInvalid') setStorageIssue('');
            }}
          >
            {t.reset}
          </button>
        </section>
        <section className="methodology" aria-labelledby="method-heading">
          <h2 id="method-heading">{t.methodology}</h2>
          {[t.method1, t.method2, t.method3, t.method4, t.method5].map((p) => (
            <p key={p}>{p}</p>
          ))}
          <a href="https://www.e-stat.go.jp/dbview?sid=0003421913">{t.sourceLink}</a>
          <p className="metadata">
            {t.release}: {release.releaseId}
            <br />
            {t.built}: {release.builtAt}
          </p>
        </section>
      </main>
      <footer className="container">
        <p>
          {release.sourceName[locale]} · {release.start} – {release.end}
        </p>
      </footer>
    </>
  );
}
