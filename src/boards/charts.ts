/**
 * Builders for bar and pie payloads — pure functions, so shares and the
 * "Other" bucket are computed once, on the server, and unit-tested.
 */
import { type BarData, type BarItem, type PieData, type ValueFormat } from './types.js';

export interface Segment {
  label: string;
  value: number;
}

export const OTHER_LABEL = 'Other';

/**
 * Bars in the given order, at most `limit` of them. `share` is value / sum
 * over ALL segments (taken before the cut), so it matches the table view.
 */
export function buildBar(
  segments: Segment[],
  format: ValueFormat,
  opts: { withShare?: boolean; shareLabel?: string; caption?: string; limit?: number } = {}
): BarData {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const shown = opts.limit == null ? segments : segments.slice(0, opts.limit);
  const items: BarItem[] = shown.map((s) => ({
    label: s.label,
    value: s.value,
    share: opts.withShare && total > 0 ? s.value / total : null,
  }));
  return {
    display: 'bar',
    format,
    items,
    ...(opts.withShare ? { share_label: opts.shareLabel ?? 'of total' } : {}),
    ...(opts.caption ? { caption: opts.caption } : {}),
  };
}

/**
 * Pie of additive segments: largest first, at most `maxSlices` slices, the
 * rest merged into "Other". Zero and negative values are dropped, since
 * they cannot be a slice of a whole.
 */
export function buildPie(
  segments: Segment[],
  format: ValueFormat,
  maxSlices: number,
  caption?: string
): PieData {
  const positive = segments.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((s, x) => s + x.value, 0);
  const keep = positive.length > maxSlices ? positive.slice(0, maxSlices - 1) : positive;
  const rest = positive.slice(keep.length);
  const merged = rest.length
    ? [...keep, { label: OTHER_LABEL, value: rest.reduce((s, x) => s + x.value, 0) }]
    : keep;
  return {
    display: 'pie',
    format,
    total,
    slices: merged.map((s) => ({ label: s.label, value: s.value, share: total > 0 ? s.value / total : 0 })),
    ...(caption ? { caption } : {}),
  };
}
