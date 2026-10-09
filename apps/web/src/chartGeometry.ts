import { useEffect, useRef, useState } from 'react';
import type { Result } from '../../../packages/domain/src/domain';
import { hasBreak } from '../../../packages/domain/src/domain';
import type { Product } from '../../../packages/domain/src/contracts';

type Point = { month: string; x: number; y: number | null };
export type ChartFrame = {
  key: string;
  points: Point[];
  connected: boolean[];
  lower: number;
  upper: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function niceStep(value: number) {
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((step) => step * power >= value) ?? 10) * power;
}

export function chartFrame(
  rows: Result[],
  measure: 'cost' | 'index',
  products: Product[],
  width: number,
  height: number,
  seriesKey: string,
): ChartFrame {
  const values = rows.map((row) => (row[measure] === null ? null : Number(row[measure])));
  const present = values.filter((value): value is number => value !== null);
  const min = present.length ? Math.min(...present) : 0;
  const max = present.length ? Math.max(...present) : 1;
  const padding = Math.max((max - min) * 0.15, max * 0.03, 1);
  const low = Math.max(0, min - padding);
  const high = max + padding;
  let step = niceStep((high - low) / 4);
  let lower = Math.floor(low / step) * step;
  if (lower + 4 * step < high) {
    step = niceStep(step * 1.01);
    lower = Math.floor(low / step) * step;
  }
  const upper = lower + 4 * step;
  const left = width < 480 ? 64 : 72;
  const right = width - 20;
  const top = 16;
  const bottom = height - 36;
  const connected = rows.map(
    (row, i) =>
      i > 0 &&
      values[i - 1] !== null &&
      values[i] !== null &&
      !products.some((product) => hasBreak(product, rows[i - 1].month, row.month)),
  );
  return {
    // Quantity changes may tween. Identity, layout and continuity changes must snap.
    key: JSON.stringify([
      seriesKey,
      width,
      height,
      rows.map((row, i) => [row.month, values[i] !== null, connected[i]]),
    ]),
    points: rows.map((row, i) => ({
      month: row.month,
      x: left + (i * (right - left)) / Math.max(1, rows.length - 1),
      y:
        values[i] === null
          ? null
          : bottom - ((values[i]! - lower) / (upper - lower)) * (bottom - top),
    })),
    connected,
    lower,
    upper,
    left,
    right,
    top,
    bottom,
  };
}

export function useChartTransition(target: ChartFrame) {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [frame, setFrame] = useState(target);
  const [transitioning, setTransitioning] = useState(false);
  const current = useRef(target);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const from = current.current;
    const changed =
      from.lower !== target.lower ||
      from.upper !== target.upper ||
      from.points.some((point, i) => point.y !== target.points[i]?.y);
    if (reduced || from.key !== target.key || !changed) {
      current.current = target;
      setFrame(target);
      setTransitioning(false);
      return;
    }
    const start = performance.now();
    let request = 0;
    setTransitioning(true);
    const advance = (now: number) => {
      const elapsed = Math.min(1, (now - start) / 180);
      const progress = 1 - (1 - elapsed) ** 3;
      const mix = (a: number, b: number) => a + (b - a) * progress;
      const next: ChartFrame =
        elapsed === 1
          ? target
          : {
              ...target,
              lower: mix(from.lower, target.lower),
              upper: mix(from.upper, target.upper),
              points: target.points.map((point, i) => ({
                ...point,
                y: point.y === null ? null : mix(from.points[i].y!, point.y),
              })),
            };
      current.current = next;
      setFrame(next);
      if (elapsed < 1) request = requestAnimationFrame(advance);
      else setTransitioning(false);
    };
    request = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(request);
  }, [target, reduced]);
  // Do not render old geometry even for one frame after a continuity change.
  return {
    frame: reduced || frame.key !== target.key ? target : frame,
    transitioning: !reduced && frame.key === target.key && transitioning,
  };
}
