import type { Result } from '../../../packages/domain/src/domain';
import type { Locale, Product } from '../../../packages/domain/src/contracts';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DashboardText } from './dashboardMessages';
import { chartFrame, useChartTransition } from './chartGeometry';

type Selection = { month: string; mode: 'hover' | 'keyboard' | 'pinned' };

export function PriceChart({
  rows,
  measure,
  products,
  locale,
  label,
  empty,
  seriesKey,
  t,
}: {
  rows: Result[];
  measure: 'cost' | 'index';
  products: Product[];
  locale: Locale;
  label: string;
  empty: string;
  seriesKey: string;
  t: DashboardText;
}) {
  const [size, setSize] = useState({ width: 900, height: 270 });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const ref = useRef<SVGSVGElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const suppressHover = useRef(false);
  const pointerFocus = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const descriptionId = useId();
  const target = useMemo(
    () => chartFrame(rows, measure, products, size.width, size.height, seriesKey),
    [rows, measure, products, size, seriesKey],
  );
  const { frame, transitioning } = useChartTransition(target);
  const values = rows.map((row) => (row[measure] === null ? null : Number(row[measure])));
  const hasData = values.some((value) => value !== null);
  const activeIndex = rows.findIndex((row) => row.month === selection?.month);
  const active = rows[activeIndex];
  const activePoint = frame.points[activeIndex];
  const format = (value: number) =>
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: measure === 'index' ? 1 : 0,
    }).format(value);
  const currency = (value: string | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: 'JPY',
          maximumFractionDigits: 0,
        }).format(Number(value));
  const percentage = (value: string | null) =>
    value === null
      ? '—'
      : `${Number(value) > 0 ? '+' : ''}${new Intl.NumberFormat(locale, {
          maximumFractionDigits: 1,
        }).format(Number(value))}%`;
  const text = (key: string) => t[key as keyof DashboardText] ?? key;
  const shownValue = (row: Result) =>
    measure === 'cost' ? currency(row.cost) : row.index === null ? '—' : format(Number(row.index));
  function notes(row: Result) {
    const result = row.items
      .filter((item) => item.status !== 'observed')
      .map((item) => {
        const product = products.find((product) => product.id === item.productId);
        return `${product?.names[locale] ?? item.productId}: ${text(item.reason)}${
          item.anchor ? ` · ${t.anchor} ${item.anchor} · ${item.age} ${t.age}` : ''
        }`;
      });
    if (!row.comparable) result.push(t.notComparable);
    if (rows[0]?.cost === null && row.cost !== null) result.push(t.baselineUnavailable);
    if (row.change !== null && (row.status === 'estimated' || rows[0].status === 'estimated'))
      result.push(t.estimatedChange);
    if (row.yoyEstimated) result.push(t.yoyEstimated);
    return result;
  }
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(280, entry.contentRect.width);
      const height = Math.max(160, entry.contentRect.height);
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [rows.length > 0]);
  useEffect(() => {
    setSelection(null);
    setAnnouncement('');
    suppressHover.current = false;
  }, [seriesKey]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        suppressHover.current = true;
        if (readoutRef.current?.contains(document.activeElement)) ref.current?.focus();
        setSelection(null);
        setAnnouncement('');
      }
    };
    document.addEventListener('keydown', dismiss);
    const endPointer = () => {
      pointerFocus.current = false;
      pointerStart.current = null;
    };
    document.addEventListener('pointerup', endPointer);
    document.addEventListener('pointercancel', endPointer);
    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerup', endPointer);
      document.removeEventListener('pointercancel', endPointer);
    };
  }, []);
  function selectKeyboard(index: number) {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    setSelection({ month: row.month, mode: 'keyboard' });
    setAnnouncement(
      `${row.month} · ${shownValue(row)} · ${text(row.status)} · ${notes(row).join(' · ')}`,
    );
  }
  function nearest(clientX: number) {
    const bounds = ref.current!.getBoundingClientRect();
    const x = ((clientX - bounds.left) / bounds.width) * size.width;
    return Math.max(
      0,
      Math.min(
        rows.length - 1,
        Math.round(((x - target.left) / (target.right - target.left)) * (rows.length - 1)),
      ),
    );
  }
  function estimated(row: Result) {
    return row.status === 'estimated' || (measure === 'index' && rows[0].status === 'estimated');
  }
  const positions =
    size.width < 480
      ? [...new Set([0, rows.length - 1])]
      : [
          ...new Set([
            0,
            Math.floor((rows.length - 1) / 3),
            Math.floor((2 * (rows.length - 1)) / 3),
            rows.length - 1,
          ]),
        ];
  if (!rows.length) return <p className="notice">{empty}</p>;
  return (
    <div
      className="interactive-chart"
      data-transitioning={String(transitioning)}
      onPointerLeave={() => {
        suppressHover.current = false;
        setSelection((previous) => (previous?.mode === 'hover' ? null : previous));
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setSelection((previous) => (previous?.mode === 'keyboard' ? null : previous));
      }}
    >
      <div className={`chart-inspector ${active ? 'has-selection' : ''}`}>
        {active ? (
          <div
            data-testid="chart-tooltip"
            ref={readoutRef}
            id={descriptionId}
            role="region"
            aria-label={t.chartDetails}
            tabIndex={0}
            className="chart-readout"
            onFocus={() =>
              setSelection((previous) =>
                previous?.mode === 'hover' ? { ...previous, mode: 'keyboard' } : previous,
              )
            }
          >
            <div className="chart-readout-summary">
              <strong>{active.month}</strong>
              <strong className="chart-readout-value">{shownValue(active)}</strong>
              <span className={`chart-status ${active.status}`}>{text(active.status)}</span>
              {measure === 'index' && <span>{t.indexUnit}</span>}
              {selection?.mode === 'pinned' && <span className="hint">{t.pinned}</span>}
            </div>
            <div className="chart-readout-details">
              <span>
                {t.change}: <strong>{percentage(active.change)}</strong>
              </span>
              <span>
                {t.yoy}: <strong>{percentage(active.yoy)}</strong>
              </span>
            </div>
            {notes(active).length > 0 && (
              <p className="chart-quality">{notes(active).join(' · ')}</p>
            )}
          </div>
        ) : (
          <div
            className="chart-idle"
            id={descriptionId}
            tabIndex={0}
            role="region"
            aria-label={t.chartViews}
          >
            <div className="chart-idle-heading">
              <strong>{label}</strong>
            </div>
            <div className="chart-legend hint">
              <span>
                <i className="legend-line" />
                {t.graphObserved}
              </span>
              <span>
                <i className="legend-line estimated-line" />
                {t.graphEstimated}
              </span>
              {frame.connected.slice(1).some((connected) => !connected) && (
                <span>{t.graphBreaks}</span>
              )}
            </div>
            <p className="hint">{t.chartHint}</p>
          </div>
        )}
      </div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      <svg
        ref={ref}
        className="price-chart"
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="img"
        aria-label={label}
        aria-describedby={descriptionId}
        tabIndex={0}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Escape"
        onFocus={() => {
          if (!pointerFocus.current && !suppressHover.current && selection?.mode !== 'pinned')
            selectKeyboard(activeIndex < 0 ? rows.length - 1 : activeIndex);
        }}
        onKeyDown={(event) => {
          let next = activeIndex < 0 ? rows.length - 1 : activeIndex;
          if (event.key === 'ArrowLeft') next--;
          else if (event.key === 'ArrowRight') next++;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = rows.length - 1;
          else return;
          event.preventDefault();
          selectKeyboard(next);
        }}
      >
        <desc>
          {t.chartInstructions} {t.graphBreaks} {t.table}
        </desc>
        {hasData &&
          Array.from({ length: 5 }, (_, i) => {
            const value = frame.lower + ((frame.upper - frame.lower) * i) / 4;
            const y = frame.bottom - ((frame.bottom - frame.top) * i) / 4;
            return (
              <g key={i}>
                <line x1={frame.left} x2={frame.right} y1={y} y2={y} stroke="#D7DCE2" />
                <text x={frame.left - 12} y={y + 5} textAnchor="end">
                  {measure === 'cost' ? '¥' : ''}
                  {format(value)}
                </text>
              </g>
            );
          })}
        {positions.map((i) => (
          <text
            key={i}
            x={frame.points[i].x}
            y={size.height - 10}
            textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}
          >
            {rows[i].month}
          </text>
        ))}
        {!hasData && (
          <text x={(frame.left + frame.right) / 2} y={size.height / 2} textAnchor="middle">
            {t.unavailable}
          </text>
        )}
        {rows.slice(1).map((row, index) => {
          const i = index + 1;
          if (!frame.connected[i]) return null;
          const isEstimated = estimated(row) || estimated(rows[index]);
          return (
            <line
              key={row.month}
              x1={frame.points[index].x}
              y1={frame.points[index].y!}
              x2={frame.points[i].x}
              y2={frame.points[i].y!}
              stroke={isEstimated ? '#174EA6' : '#1F2933'}
              strokeWidth="2.5"
              strokeDasharray={isEstimated ? '7 5' : undefined}
            />
          );
        })}
        {rows.map((row, i) =>
          frame.points[i].y === null ||
          (frame.points.length > 1 &&
            frame.points[1].x - frame.points[0].x < 9 &&
            i > 0 &&
            i < rows.length - 1 &&
            frame.connected[i] &&
            frame.connected[i + 1]) ? null : (
            <circle
              key={row.month}
              data-month={row.month}
              cx={frame.points[i].x}
              cy={frame.points[i].y!}
              r={3.5}
              fill={estimated(row) ? 'white' : '#1F2933'}
              stroke={estimated(row) ? '#174EA6' : '#1F2933'}
              strokeWidth={2}
            />
          ),
        )}
        {activePoint && (
          <line
            data-testid="chart-crosshair"
            x1={activePoint.x}
            x2={activePoint.x}
            y1={frame.top}
            y2={frame.bottom}
            stroke="#174EA6"
            strokeWidth="1"
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}
        {activePoint?.y !== null && activePoint?.y !== undefined && (
          <ellipse
            data-testid="chart-active-point"
            cx={activePoint.x}
            cy={activePoint.y}
            rx={6}
            ry={6}
            fill="white"
            stroke="#174EA6"
            strokeWidth={2.5}
            pointerEvents="none"
          />
        )}
        <rect
          data-testid="chart-hit-area"
          x={frame.left}
          y={frame.top}
          width={frame.right - frame.left}
          height={frame.bottom - frame.top}
          fill="transparent"
          className="chart-hit-area"
          onPointerMove={(event) => {
            if (
              event.pointerType === 'touch' ||
              suppressHover.current ||
              selection?.mode === 'pinned'
            )
              return;
            setSelection({ month: rows[nearest(event.clientX)].month, mode: 'hover' });
          }}
          onPointerDown={(event) => {
            pointerFocus.current = true;
            pointerStart.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerCancel={() => {
            pointerStart.current = null;
            pointerFocus.current = false;
          }}
          onPointerUp={(event) => {
            const start = pointerStart.current;
            pointerStart.current = null;
            pointerFocus.current = false;
            if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
            const month = rows[nearest(event.clientX)].month;
            const dismiss = selection?.mode === 'pinned' && selection.month === month;
            setSelection(dismiss ? null : { month, mode: 'pinned' });
            suppressHover.current = dismiss;
          }}
        />
      </svg>
    </div>
  );
}
