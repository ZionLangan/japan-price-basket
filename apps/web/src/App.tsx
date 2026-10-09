import { useEffect, useMemo, useRef, useState } from 'react';
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
  type Release,
} from '../../../packages/domain/src/contracts';
import { evaluate, months, productEligibility } from '../../../packages/domain/src/domain';
import { readState, writeState } from './storage';
import { dashboardMessages } from './dashboardMessages';
import { ProductSearch } from './ProductSearch';
import { LiveBasket } from './LiveBasket';
import { ChartViews } from './ChartViews';
import { DateRangeControls, type EndMode } from './DateRangeControls';

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
function example(release: Release, cityId = '13100'): Basket {
  return {
    schemaVersion: 1,
    name: 'Staples / 基本食材',
    cityId,
    start: release.start,
    end: release.end,
    items: ['white-bread', 'white-sugar', 'cabbage', 'potatoes', 'carrots'].map((productId) => ({
      productId,
      quantity: '1',
      unit: release.products.find((p) => p.id === productId)!.unit,
    })),
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
      <main className="boot">
        <h1>{dashboardMessages.en.title} / 日本の買い物かご価格</h1>
        <p role={error ? 'alert' : 'status'}>
          {error
            ? `${dashboardMessages.en.loadError} / ${dashboardMessages.ja.loadError}`
            : `${dashboardMessages.en.loading} / ${dashboardMessages.ja.loading}`}
        </p>
        {error && (
          <button onClick={() => setAttempt((a) => a + 1)}>
            {dashboardMessages.en.retry} / {dashboardMessages.ja.retry}
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
  // Preserve old named records while the public interface edits one current basket.
  const [saved] = useState(initial.state?.saved ?? []);
  const [basket, setBasket] = useState<Basket>(initial.state?.current ?? example(release));
  const [endMode, setEndMode] = useState<EndMode>(
    initial.state?.endMode ?? (initial.state ? 'fixed' : 'latest'),
  );
  const [locale, setLocale] = useState<Locale>(initial.state?.locale ?? 'en');
  const [observedOnly, setObservedOnly] = useState(initial.state?.observedOnly ?? false);
  const [storageIssue, setStorageIssue] = useState(initial.issue);
  const [preserveStored, setPreserveStored] = useState(initial.issue === 'storageInvalid');
  const [cityData, setCityData] = useState<CityData>();
  const [cityError, setCityError] = useState(false);
  const [candidateCityId, setCandidateCityId] = useState<string>();
  const [failedCityId, setFailedCityId] = useState<string>();
  const candidateController = useRef<AbortController | null>(null);
  const latest = useRef({ basket, observedOnly, endMode });
  latest.current = { basket, observedOnly, endMode };
  const [notice, setNotice] = useState<{ key: string; items?: string[]; range?: string }>();
  const [migration, setMigration] = useState(initial.state?.migration);
  const [retry, setRetry] = useState(0);
  const t = dashboardMessages[locale];
  const selectedCity = release.cities.find((c) => c.id === basket.cityId)!;
  const missingCityIntervals: string[] = [];
  if (selectedCity.start > basket.start) {
    const end =
      selectedCity.start > basket.end
        ? basket.end
        : months(basket.start, selectedCity.start).at(-2)!;
    missingCityIntervals.push(`${basket.start} – ${end}`);
  }
  if (selectedCity.end < basket.end) {
    const start =
      selectedCity.end < basket.start ? basket.start : months(selectedCity.end, basket.end)[1];
    missingCityIntervals.push(`${start} – ${basket.end}`);
  }
  const inputError = basket.items.some((i) => !PositiveDecimal.safeParse(i.quantity).success)
    ? t.invalidQuantity
    : basket.start > basket.end
      ? t.invalidRange
      : '';
  const ready = cityData?.cityId === basket.cityId && !inputError;
  const matchingCity = cityData?.cityId === basket.cityId ? cityData : undefined;
  const itemIssues = useMemo(() => {
    const issues: Record<string, string> = {};
    if (!matchingCity) return issues;
    for (const item of basket.items) {
      const product = release.products.find((p) => p.id === item.productId)!;
      const eligibility = productEligibility(
        product,
        matchingCity.series[product.id] ?? [],
        basket.start,
        basket.end,
        observedOnly,
      );
      if (!eligibility.eligible)
        issues[item.productId] =
          `${t.selectionUnavailable}${eligibility.firstUnavailable ? ` (${eligibility.firstUnavailable})` : ''}`;
    }
    return issues;
  }, [basket, matchingCity, release, observedOnly, t.selectionUnavailable]);
  const rows = useMemo(
    () => (ready ? evaluate(basket, release, cityData!, observedOnly) : []),
    [basket, release, cityData, observedOnly, ready],
  );
  const first = rows[0],
    last = rows.at(-1);
  const yen = (v: string | null | undefined) =>
    v == null
      ? '—'
      : new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ja-JP', {
          style: 'currency',
          currency: 'JPY',
          maximumFractionDigits: 0,
        }).format(Number(v));
  const percent = (v: string | null | undefined) =>
    v == null ? '—' : `${new Decimal(v).gt(0) ? '+' : ''}${new Decimal(v).toFixed(1)}%`;
  const text = (key: string) => t[key as keyof typeof t] ?? key;
  const lastIssues =
    last?.items
      .filter((i) => i.status !== 'observed')
      .map((i) => {
        const p = release.products.find((p) => p.id === i.productId)!;
        return `${p.names[locale]}: ${text(i.reason)}${i.anchor && ['seasonal', 'temporary', 'assumed-gap'].includes(i.reason) ? ` · ${t.anchor} ${i.anchor} · ${i.age} ${t.age}` : ''}`;
      }) ?? [];
  const breakItems = release.products.filter(
    (p) =>
      basket.items.some((i) => i.productId === p.id) &&
      p.segments.some(
        (s) => s.start > basket.start && s.start <= basket.end && !s.continuityFromPrevious,
      ),
  );
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.title;
  }, [locale, t.title]);
  useEffect(() => {
    if (cityData?.cityId === basket.cityId && cityData.releaseId === release.releaseId) return;
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
  useEffect(() => () => candidateController.current?.abort(), []);
  function blockedItems(candidate: Basket, data: CityData, mode: boolean) {
    return candidate.items
      .filter((item) => {
        const product = release.products.find((p) => p.id === item.productId)!;
        return !productEligibility(
          product,
          data.series[product.id] ?? [],
          candidate.start,
          candidate.end,
          mode,
        ).eligible;
      })
      .map((item) => item.productId);
  }
  function changeRange(range: Pick<Basket, 'start' | 'end'>, mode: EndMode) {
    if (range.start > range.end) {
      setBasket((previous) => ({ ...previous, ...range }));
      setEndMode(mode);
      setNotice(undefined);
      return;
    }
    if (!matchingCity || candidateCityId) {
      setNotice({ key: 'waitForCity' });
      return;
    }
    const blocked = blockedItems({ ...basket, ...range }, matchingCity, observedOnly);
    if (blocked.length) {
      setNotice({ key: 'rangeBlocked', items: blocked });
      return;
    }
    setBasket((previous) => ({ ...previous, ...range }));
    setEndMode(mode);
    setNotice(undefined);
  }
  function changeObservedOnly(mode: boolean) {
    if (!matchingCity || candidateCityId) {
      setNotice({ key: 'waitForCity' });
      return;
    }
    const blocked = blockedItems(basket, matchingCity, mode);
    if (blocked.length) {
      setNotice({ key: 'modeBlocked', items: blocked });
      return;
    }
    setObservedOnly(mode);
    setNotice(undefined);
  }
  async function changeCity(cityId: string) {
    candidateController.current?.abort();
    setFailedCityId(undefined);
    if (cityId === basket.cityId) {
      setCandidateCityId(undefined);
      return;
    }
    const controller = new AbortController();
    candidateController.current = controller;
    setCandidateCityId(cityId);
    setNotice(undefined);
    try {
      const data = await loadCity(release, cityId, controller.signal);
      if (controller.signal.aborted) return;
      const current = latest.current;
      const meta = release.cities.find((city) => city.id === cityId)!;
      const clamp = (month: string) =>
        month < meta.start ? meta.start : month > meta.end ? meta.end : month;
      const range = { start: clamp(current.basket.start), end: clamp(current.basket.end) };
      if (range.start > range.end) {
        setNotice({ key: 'invalid-range' });
        setCandidateCityId(undefined);
        return;
      }
      const candidate = { ...current.basket, ...range, cityId };
      const blocked = blockedItems(candidate, data, current.observedOnly);
      if (blocked.length) {
        setNotice({ key: 'cityBlocked', items: blocked });
        setCandidateCityId(undefined);
        return;
      }
      const clamped = range.start !== current.basket.start || range.end !== current.basket.end;
      setBasket(candidate);
      setCityData(data);
      setCityError(false);
      if (range.end !== release.end) setEndMode('fixed');
      setNotice(
        clamped ? { key: 'cityClamped', range: `${range.start} – ${range.end}` } : undefined,
      );
      setCandidateCityId(undefined);
    } catch {
      if (controller.signal.aborted) return;
      setFailedCityId(cityId);
      setCandidateCityId(undefined);
    }
  }
  useEffect(() => {
    if (preserveStored || inputError) return;
    try {
      writeState(
        {
          schemaVersion: 1,
          releaseId: release.releaseId,
          locale,
          observedOnly,
          endMode,
          current: validateBasket(basket, release),
          saved,
        },
        window.localStorage,
      );
      setStorageIssue('');
    } catch {
      setStorageIssue('storageUnavailable');
    }
  }, [basket, saved, locale, observedOnly, endMode, release, inputError, preserveStored]);
  function resetBasket() {
    if (!matchingCity || candidateCityId) {
      setNotice({ key: 'waitForCity' });
      return;
    }
    const reset = example(release, basket.cityId);
    reset.start = selectedCity.start;
    reset.end = selectedCity.end;
    if (matchingCity)
      reset.items = reset.items.filter(
        (item) => !blockedItems({ ...reset, items: [item] }, matchingCity, observedOnly).length,
      );
    setBasket(reset);
    setEndMode(reset.end === release.end ? 'latest' : 'fixed');
    setPreserveStored(false);
    setStorageIssue('');
    setMigration(undefined);
    setNotice(undefined);
  }
  return (
    <div className="dashboard-shell">
      <a className="skip" href="#price-workspace">
        {t.skip}
      </a>
      <header className="site-header">
        <h1>{t.title}</h1>
        <div className="city-control">
          <label htmlFor="city">{t.city}</label>
          <select
            id="city"
            value={candidateCityId ?? basket.cityId}
            onChange={(e) => void changeCity(e.target.value)}
          >
            {[false, true].map((historical) => (
              <optgroup
                key={String(historical)}
                label={historical ? t.historicalCities : t.currentCities}
              >
                {release.cities
                  .filter((c) => Boolean(c.historical) === historical)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.names[locale]}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="header-tools">
          <button className="text-button" popoverTarget="source-information">
            {t.dataSource}
          </button>
          <div className="language" role="group" aria-label="Language / 言語">
            <button lang="en" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>
              English
            </button>
            <button lang="ja" aria-pressed={locale === 'ja'} onClick={() => setLocale('ja')}>
              日本語
            </button>
          </div>
        </div>
      </header>
      <div
        className="source-popover"
        id="source-information"
        popover="auto"
        role="region"
        aria-labelledby="source-heading"
      >
        <div className="popover-heading">
          <h2 id="source-heading">{t.dataSource}</h2>
          <button
            className="text-button"
            popoverTarget="source-information"
            popoverTargetAction="hide"
            aria-label={locale === 'en' ? 'Close data source' : '出典を閉じる'}
          >
            ×
          </button>
        </div>
        <p>{t.independent}</p>
        <p>
          {release.sourceName[locale]} · {release.start} – {release.end}
        </p>
        <a href="https://www.e-stat.go.jp/dbview?sid=0003421913" target="_blank" rel="noreferrer">
          {t.sourceLink}
        </a>
        <p>{t.method1}</p>
        <p>{t.method3}</p>
        <p>{t.definitionNote}</p>
        <p>{t.quantityNote}</p>
        <p>{t.carryNote}</p>
        <p>{t.catalogLimit}</p>
        <p>{t.nowDescription}</p>
        <p>
          {t.coverage}: {selectedCity.start} – {selectedCity.end}
        </p>
        <p className="hint">
          {t.release}: {release.releaseId}
        </p>
      </div>
      <ProductSearch
        products={release.products}
        selected={basket.items.map((i) => i.productId)}
        city={matchingCity}
        start={basket.start}
        month={basket.end}
        observedOnly={observedOnly}
        loading={Boolean(candidateCityId)}
        historyStart={release.start}
        historyEnd={release.end}
        locale={locale}
        t={t}
        onAdd={(p) => {
          if (
            !matchingCity ||
            candidateCityId ||
            p.selectable === false ||
            !productEligibility(
              p,
              matchingCity.series[p.id] ?? [],
              basket.start,
              basket.end,
              observedOnly,
            ).eligible
          ) {
            setNotice({ key: 'noEligibleResults' });
            return;
          }
          setBasket((b) =>
            b.items.some((i) => i.productId === p.id)
              ? b
              : {
                  ...b,
                  items: [...b.items, { productId: p.id, quantity: p.presets[0], unit: p.unit }],
                },
          );
        }}
      />
      {storageIssue && (
        <p className="notice storage-notice" role="status">
          {text(storageIssue)}
        </p>
      )}
      {migration && (
        <p className="notice storage-notice" role="status">
          {migration.removedDetergents ? t.detergentRemoved : ''}{' '}
          {migration.convertedEggs ? t.eggsMigrated : ''}
        </p>
      )}
      {notice && (
        <p className="notice storage-notice" role="status" data-testid="compatibility-notice">
          {text(notice.key)}{' '}
          {notice.items
            ?.map((id) => release.products.find((p) => p.id === id)!.names[locale])
            .join(', ')}
          {notice.range}
          {notice.items?.length ? ` ${t.selectionRecovery}` : ''}
        </p>
      )}
      <main className="workspace" id="price-workspace" tabIndex={-1}>
        <section className="analysis" aria-labelledby="results-heading">
          <h2 id="results-heading" className="sr-only">
            {t.results}
          </h2>
          <DateRangeControls
            start={basket.start}
            end={basket.end}
            minimum={release.start}
            maximum={release.end}
            endMode={endMode}
            locale={locale}
            t={t}
            observedOnly={observedOnly}
            onRange={changeRange}
            onObservedOnly={changeObservedOnly}
          />
          {inputError && (
            <p className="error" role="alert">
              {inputError}
            </p>
          )}
          {(cityError || failedCityId) && (
            <div className="notice" role="alert">
              {t.loadError}{' '}
              {failedCityId && release.cities.find((c) => c.id === failedCityId)!.names[locale]}{' '}
              <button
                onClick={() =>
                  failedCityId ? void changeCity(failedCityId) : setRetry((r) => r + 1)
                }
              >
                {t.retry}
              </button>
            </div>
          )}
          {((!cityData && !cityError) || candidateCityId) && (
            <p role="status" className="notice">
              {t.loadingCity}
            </p>
          )}
          <div className="totals" role="status" aria-live="polite" aria-atomic="true">
            <div>
              <span>
                {t.lastCost} · {basket.end}
              </span>
              <strong data-testid="latest-cost">{yen(last?.cost)}</strong>
              <small>{text(last?.status ?? 'unavailable')}</small>
            </div>
            <div>
              <span>
                {t.firstCost} · {basket.start}
              </span>
              <strong>{yen(first?.cost)}</strong>
              <small>{text(first?.status ?? 'unavailable')}</small>
            </div>
            <div>
              <span>{t.change}</span>
              <strong data-testid="basket-change">{percent(last?.change)}</strong>
              <small>
                {last?.change == null
                  ? t.compareBlocked
                  : first?.status === 'estimated' || last?.status === 'estimated'
                    ? t.estimatedEndpoint
                    : null}
              </small>
            </div>
            <div>
              <span>
                {t.yoy} · {basket.end}
              </span>
              <strong>{percent(last?.yoy)}</strong>
              <small>
                {last?.yoyEstimated ? t.estimatedEndpoint : last?.yoy == null ? t.noChange : null}
              </small>
            </div>
          </div>
          {(lastIssues.length > 0 ||
            breakItems.length > 0 ||
            selectedCity.start > basket.start ||
            selectedCity.end < basket.end) && (
            <details className="quality-summary">
              <summary>
                {breakItems.length
                  ? `${t.compareBlocked} · ${breakItems.map((p) => p.names[locale]).join(', ')}`
                  : lastIssues.length
                    ? `${t.status}: ${text(last?.status ?? 'unavailable')}`
                    : `${t.coverage}: ${selectedCity.start} – ${selectedCity.end}`}
              </summary>
              {breakItems.length > 0 && (
                <p>
                  {t.breakWarning}{' '}
                  {breakItems
                    .map(
                      (p) =>
                        `${p.names[locale]} (${p.segments
                          .filter(
                            (s) =>
                              s.start > basket.start &&
                              s.start <= basket.end &&
                              !s.continuityFromPrevious,
                          )
                          .map((s) => s.start)
                          .join(', ')})`,
                    )
                    .join(' · ')}
                </p>
              )}
              {(selectedCity.start > basket.start || selectedCity.end < basket.end) && (
                <p>
                  {t.coverage}: {selectedCity.start} – {selectedCity.end} · {t['not-surveyed']}:{' '}
                  {missingCityIntervals.join(' · ')}
                </p>
              )}
              {lastIssues.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </details>
          )}
          <ChartViews
            basket={basket}
            release={release}
            city={ready ? cityData : undefined}
            rows={rows}
            locale={locale}
            observedOnly={observedOnly}
            t={t}
            yen={yen}
            percent={percent}
          />
        </section>
        <LiveBasket
          basket={basket}
          products={release.products}
          locale={locale}
          t={t}
          issues={itemIssues}
          update={setBasket}
          onClear={() => setBasket((b) => ({ ...b, items: [] }))}
          onReset={resetBasket}
        />
      </main>
    </div>
  );
}
