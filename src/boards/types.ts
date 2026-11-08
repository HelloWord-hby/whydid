/**
 * Card payloads — the only shapes the dashboard knows how to draw.
 *
 * Every number in these payloads is computed on the server by
 * deterministic code. The browser formats values for display (using the
 * `format` hints) but never derives a new number from them.
 */

export const DISPLAYS = ['stat', 'line', 'table', 'bar', 'pie'] as const;
export type Display = (typeof DISPLAYS)[number];

/** Display hint for a raw number. Formatting only — no arithmetic. */
export type ValueFormat = 'int' | 'float' | 'pct' | 'ms' | 'sec' | 'usd' | 'text' | 'datetime';

export interface Window {
  days: number;
  current: { from: string; to: string };
  previous: { from: string; to: string };
}

export interface StatData {
  display: 'stat';
  value: number | null;
  format: ValueFormat;
  previous: number | null;
  /** current − previous, in the metric's own unit. */
  delta: number | null;
  /** (current − previous) / |previous|, as a fraction. null when no baseline. */
  delta_pct: number | null;
  /** Which direction is good, so the UI can colour the delta. */
  good_direction: 'up' | 'down' | 'none';
  /** Optional daily series for a sparkline. */
  spark?: Array<{ t: string; v: number }>;
  caption?: string;
}

export interface LineData {
  display: 'line';
  format: ValueFormat;
  series: Array<{ name: string; points: Array<{ t: string; v: number | null }> }>;
  caption?: string;
}

export interface TableColumn {
  key: string;
  label: string;
  format: ValueFormat;
  /** Render a proportional bar next to the value (values in [0, 1]). */
  bar?: boolean;
}

export interface TableData {
  display: 'table';
  columns: TableColumn[];
  rows: Array<Record<string, string | number | null>>;
  caption?: string;
}

export interface BarItem {
  label: string;
  value: number | null;
  /** Optional fraction shown next to the value (share of total, of first step…). */
  share: number | null;
}

/** Horizontal bars, one per category, largest first unless order matters. */
export interface BarData {
  display: 'bar';
  format: ValueFormat;
  items: BarItem[];
  /** What `share` means, e.g. "of total" or "of first step". */
  share_label?: string;
  caption?: string;
}

export interface PieSlice {
  label: string;
  value: number;
  /** value / total, computed server-side; slices sum to 1. */
  share: number;
}

/** Parts of a whole. Only built from additive values; small tails merge into "Other". */
export interface PieData {
  display: 'pie';
  format: ValueFormat;
  total: number;
  slices: PieSlice[];
  caption?: string;
}

export type CardPayload = StatData | LineData | TableData | BarData | PieData;

export interface CardResponse {
  card: string;
  source: string;
  /** "demo" when the numbers come from the built-in synthetic generator. */
  mode: 'live' | 'demo';
  window: Window;
  data: CardPayload;
  generated_at: string;
  notes?: string[];
}
