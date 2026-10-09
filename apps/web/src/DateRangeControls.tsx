import type { Basket, Locale } from '../../../packages/domain/src/contracts';
import { months } from '../../../packages/domain/src/domain';
import type { DashboardText } from './dashboardMessages';

export type EndMode = 'latest' | 'fixed';

export function DateRangeControls({
  start,
  end,
  minimum,
  maximum,
  endMode,
  locale,
  t,
  observedOnly,
  onRange,
  onObservedOnly,
}: {
  start: string;
  end: string;
  minimum: string;
  maximum: string;
  endMode: EndMode;
  locale: Locale;
  t: DashboardText;
  observedOnly: boolean;
  onRange: (range: Pick<Basket, 'start' | 'end'>, mode: EndMode) => void;
  onObservedOnly: (value: boolean) => void;
}) {
  const firstYear = Number(minimum.slice(0, 4));
  const lastYear = Number(maximum.slice(0, 4));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, {
      month: locale === 'en' ? 'short' : 'long',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2020, month - 1, 1)));
  const latestLabel = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: locale === 'en' ? 'short' : 'long',
    timeZone: 'UTC',
  }).format(new Date(`${maximum}-01T00:00:00Z`));
  const monthOptions = (year: number) =>
    Array.from({ length: 12 }, (_, i) => i + 1).filter((month) => {
      const value = `${year}-${String(month).padStart(2, '0')}`;
      return value >= minimum && value <= maximum;
    });
  function change(endpoint: 'start' | 'end', year: number, month: number) {
    const allowed = monthOptions(year);
    const boundedMonth = Math.max(allowed[0], Math.min(allowed.at(-1)!, month));
    const value = `${year}-${String(boundedMonth).padStart(2, '0')}`;
    onRange({ start, end, [endpoint]: value }, endpoint === 'end' ? 'fixed' : endMode);
  }
  const span = months(minimum, maximum).length;
  function preset(count: number) {
    const available = months(minimum, end);
    onRange({ start: available[Math.max(0, available.length - count)], end }, endMode);
  }
  return (
    <div className="date-controls">
      {(['start', 'end'] as const).map((endpoint) => {
        const value = endpoint === 'start' ? start : end;
        const year = Number(value.slice(0, 4));
        const month = value.slice(5);
        return (
          <fieldset className="month-range" key={endpoint}>
            <legend>{endpoint === 'start' ? t.start : t.end}</legend>
            <div className="month-fields">
              <label className="sr-only" htmlFor={`${endpoint}-year`}>
                {endpoint === 'start' ? t.fromYear : t.toYear}
              </label>
              <select
                id={`${endpoint}-year`}
                value={year}
                onChange={(event) => change(endpoint, Number(event.target.value), Number(month))}
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {locale === 'ja' ? `${year}年` : year}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`${endpoint}-month`}>
                {endpoint === 'start' ? t.fromMonth : t.toMonth}
              </label>
              <select
                id={`${endpoint}-month`}
                value={month}
                onChange={(event) => change(endpoint, year, Number(event.target.value))}
              >
                {monthOptions(year).map((month) => (
                  <option key={month} value={String(month).padStart(2, '0')}>
                    {monthName(month)}
                  </option>
                ))}
              </select>
              {endpoint === 'end' && (
                <>
                  <button
                    id="end-latest"
                    className="latest-month"
                    aria-pressed={endMode === 'latest'}
                    aria-describedby="latest-month-description"
                    onClick={() => onRange({ start, end: maximum }, 'latest')}
                  >
                    {t.now} · {latestLabel}
                  </button>
                  <span id="latest-month-description" className="sr-only">
                    {t.nowDescription}
                  </span>
                </>
              )}
            </div>
          </fieldset>
        );
      })}
      <div className="range-presets" role="group" aria-label={t.rangePresets}>
        {span >= 12 && (
          <button
            id="range-1y"
            className="text-button"
            aria-label={`${t.oneYear} · ${t.lastYear}`}
            onClick={() => preset(12)}
          >
            {t.oneYear}
          </button>
        )}
        {span >= 60 && (
          <button
            id="range-5y"
            className="text-button"
            aria-label={`${t.fiveYears} · ${t.lastFiveYears}`}
            onClick={() => preset(60)}
          >
            {t.fiveYears}
          </button>
        )}
        <button
          id="range-all"
          className="text-button"
          aria-label={`${t.allHistory} · ${t.fullHistory}`}
          disabled={start === minimum && end === maximum && endMode === 'latest'}
          onClick={() => onRange({ start: minimum, end: maximum }, 'latest')}
        >
          {t.allHistory}
        </button>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={observedOnly}
          onChange={(event) => onObservedOnly(event.target.checked)}
        />
        {t.observedOnly}
      </label>
    </div>
  );
}
