/** Helpers for the Metrics pages, which read the main config through POST /tool. */
import { postJson } from '../lib/api';
import { type Health, type ValueFormat } from '../lib/types';

export type MetricDef = Health['metrics'][number];

export async function tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const r = await postJson<{ result: T }>('/tool', { name, args });
  return r.result;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Last n full UTC days, half-open. Control input for the tools, not a displayed number. */
export function lastDays(n: number, now: Date = new Date()): { from: string; to: string } {
  const to = new Date(now.getTime());
  to.setUTCHours(0, 0, 0, 0);
  return { from: isoDay(new Date(to.getTime() - n * 86_400_000)), to: isoDay(to) };
}

export function shiftDays(iso: string, n: number): string {
  return isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));
}

/** Same rule as the server's metricFormat. */
export function metricFormat(m: MetricDef): ValueFormat {
  if (m.kind === 'additive') return 'int';
  const unit = (m.unit ?? '').toLowerCase();
  if (!unit) return 'pct';
  if (unit === 'ms') return 'ms';
  if (unit === 's' || unit === 'sec') return 'sec';
  if (unit === 'usd') return 'usd';
  return 'float';
}

export interface CompareResult {
  period_a: { from: string; to: string };
  period_b: { from: string; to: string };
  period_a_total: number | null;
  period_b_total: number | null;
  delta: number | null;
  delta_pct: number | null;
}

export interface TrendResult {
  points: Array<{ bucket: string; value: number; outlier?: 'high' | 'low' }>;
}
