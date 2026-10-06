import type { Result } from '../../../packages/domain/src/domain';
import type { Locale, Product } from '../../../packages/domain/src/contracts';
import { hasBreak } from '../../../packages/domain/src/domain';
import { useEffect, useRef, useState } from 'react';

export function PriceChart({
  rows,
  measure,
  products,
  locale,
  label,
  empty,
}: {
  rows: Result[];
  measure: 'cost' | 'index';
  products: Product[];
  locale: Locale;
  label: string;
  empty: string;
}) {
  const values = rows.map((r) => (r[measure] === null ? null : Number(r[measure])));
  const present = values.filter((v): v is number => v !== null);
  const [width, setWidth] = useState(900);
  const ref = useRef<SVGSVGElement>(null);
  const hasData = present.length > 0;
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.max(280, entries[0].contentRect.width));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [hasData]);
  if (!present.length) return <p className="notice">{empty}</p>;
  const height = 310,
    left = 70,
    top = 20,
    bottom = 265,
    right = width - 20;
  const lower = Math.max(0, Math.min(...present) * 0.9);
  const upper = Math.max(...present) * 1.1 || 1;
  const x = (i: number) => left + (i * (right - left)) / Math.max(1, rows.length - 1);
  const y = (v: number) => bottom - ((v - lower) / (upper - lower)) * (bottom - top);
  const format = (v: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v);
  const ticks = Array.from({ length: 5 }, (_, i) => lower + ((upper - lower) * i) / 4);
  const positions =
    width < 480
      ? [...new Set([0, rows.length - 1])]
      : [
          ...new Set([
            0,
            Math.floor((rows.length - 1) / 3),
            Math.floor((2 * (rows.length - 1)) / 3),
            rows.length - 1,
          ]),
        ];
  return (
    <svg
      ref={ref}
      className="price-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <desc>
        {locale === 'en'
          ? 'Monthly values with gaps and specification boundaries. The equivalent table follows.'
          : '欠測と銘柄変更の境界を保持した月次の値です。同じ値を下の表に示します。'}
      </desc>
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="#D7DCE2" />
          <text x={left - 12} y={y(v) + 5} textAnchor="end">
            {measure === 'cost' ? '¥' : ''}
            {format(v)}
          </text>
        </g>
      ))}
      {positions.map((i) => (
        <text
          key={i}
          x={x(i)}
          y={290}
          textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}
        >
          {rows[i].month}
        </text>
      ))}
      {rows.slice(1).map((row, index) => {
        const i = index + 1,
          prev = values[index],
          value = values[i];
        if (
          prev === null ||
          value === null ||
          products.some((p) => hasBreak(p, rows[index].month, row.month))
        )
          return null;
        const estimated =
          row.status === 'estimated' ||
          rows[index].status === 'estimated' ||
          (measure === 'index' && rows[0].status === 'estimated');
        return (
          <line
            key={row.month}
            x1={x(index)}
            y1={y(prev)}
            x2={x(i)}
            y2={y(value)}
            stroke={estimated ? '#174EA6' : '#1F2933'}
            strokeWidth="2.5"
            strokeDasharray={estimated ? '7 5' : undefined}
          />
        );
      })}
      {rows.map((row, i) =>
        values[i] === null ? null : (
          <circle
            key={row.month}
            cx={x(i)}
            cy={y(values[i]!)}
            r={4}
            fill={
              row.status === 'estimated' || (measure === 'index' && rows[0].status === 'estimated')
                ? 'white'
                : '#1F2933'
            }
            stroke={
              row.status === 'estimated' || (measure === 'index' && rows[0].status === 'estimated')
                ? '#174EA6'
                : '#1F2933'
            }
            strokeWidth={2}
          >
            <title>
              {row.month}: {format(values[i]!)} · {row.status}
            </title>
          </circle>
        ),
      )}
    </svg>
  );
}
