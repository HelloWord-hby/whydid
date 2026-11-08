/**
 * Display formatting for server-computed values. Formatting only: the UI
 * never derives a number the server did not send.
 */
import { type ValueFormat } from './types';

export function fmt(v: number | string | null | undefined, format: ValueFormat): string {
  if (v == null || v === '') return '—';
  if (format === 'text') return String(v);
  if (format === 'datetime') return String(v).slice(5, 16).replace('T', ' ');
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  switch (format) {
    case 'int':
      return Math.round(n).toLocaleString('en-US');
    case 'pct':
      return `${(n * 100).toFixed(1)}%`;
    case 'ms':
      return `${Math.round(n).toLocaleString('en-US')} ms`;
    case 'sec':
      return `${n.toFixed(2)} s`;
    case 'usd':
      return `$${Math.abs(n) < 0.1 ? n.toFixed(4) : n.toFixed(2)}`;
    default: {
      const a = Math.abs(n);
      return a >= 100 ? n.toFixed(0) : a >= 1 ? n.toFixed(2) : n.toFixed(3);
    }
  }
}

export type Tone = 'good' | 'bad' | 'flat';

/** A change as shown under a KPI: arrow, size, and whether it is good news. */
export function deltaView(d: {
  delta: number | null;
  delta_pct: number | null;
  format: ValueFormat;
  good_direction: 'up' | 'down' | 'none';
}): { arrow: string; text: string; tone: Tone } | null {
  if (d.delta == null) return null;
  if (d.delta === 0) return { arrow: '', text: '0', tone: 'flat' };
  const up = d.delta > 0;
  const size =
    d.format === 'pct'
      ? `${Math.abs(d.delta * 100).toFixed(1)} pp`
      : d.delta_pct != null
        ? `${Math.abs(d.delta_pct * 100).toFixed(1)}%`
        : fmt(Math.abs(d.delta), d.format);
  let tone: Tone = 'flat';
  if (d.good_direction === 'up') tone = up ? 'good' : 'bad';
  if (d.good_direction === 'down') tone = up ? 'bad' : 'good';
  return { arrow: up ? '▲' : '▼', text: size, tone };
}

/** Compact axis label: 12,400 → 12.4k. Display only. */
export function axisLabel(v: number, format: ValueFormat): string {
  if (format === 'pct') return `${Math.round(v * 100)}%`;
  const a = Math.abs(v);
  if (a >= 1000) return `${(v / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
  return a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(2);
}

export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
