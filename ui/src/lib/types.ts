/** Shapes served by the whydid API (mirrors src/boards/types.ts and src/workbench/session.ts). */

export type Display = 'stat' | 'line' | 'table' | 'bar' | 'pie';
export type ValueFormat = 'int' | 'float' | 'pct' | 'ms' | 'sec' | 'usd' | 'text' | 'datetime';
/** Config text may be a plain string or one string per language. */
export type Localized = string | Record<string, string>;

export interface CatalogBoard {
  id: string;
  title: Localized;
  description?: Localized;
  source: string;
  source_kind: 'model_output' | 'semantic';
  mode: 'live' | 'demo';
  default_layout: LayoutEntry[];
}

export interface CatalogCard {
  id: string;
  board: string;
  title: Localized;
  description?: Localized;
  display: Display;
  provider: string;
  size: number;
  default: boolean;
  ask?: Localized;
}

export interface Catalog {
  boards: CatalogBoard[];
  cards: CatalogCard[];
}

export interface LayoutEntry {
  id: string;
  size: number;
}

export interface StatData {
  display: 'stat';
  value: number | null;
  previous: number | null;
  delta: number | null;
  delta_pct: number | null;
  format: ValueFormat;
  good_direction: 'up' | 'down' | 'none';
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
  bar?: boolean;
}
export interface TableData {
  display: 'table';
  columns: TableColumn[];
  rows: Array<Record<string, string | number | null>>;
  caption?: string;
}
export interface BarData {
  display: 'bar';
  format: ValueFormat;
  items: Array<{ label: string; value: number | null; share: number | null }>;
  share_label?: string;
  caption?: string;
}
export interface PieData {
  display: 'pie';
  format: ValueFormat;
  total: number;
  slices: Array<{ label: string; value: number; share: number }>;
  caption?: string;
}
export type CardPayload = StatData | LineData | TableData | BarData | PieData;

export interface CardResponse {
  card: string;
  mode: 'live' | 'demo';
  window: { days: number; current: { from: string; to: string }; previous: { from: string; to: string } };
  data: CardPayload;
  notes?: string[];
}

export interface Health {
  table: string;
  metrics: Array<{ name: string; kind: 'additive' | 'rate'; label: string; unit: string | null; decompose: boolean }>;
  dimensions: Array<{ name: string; label: string }>;
}

export type AgentEvent =
  | { type: 'turn_start'; playbook: string; prompt_version: string }
  | { type: 'tool_start'; ref: number; tool: string; args: unknown; injected: boolean }
  | { type: 'tool_end'; ref: number; tool: string; ms: number; ok: boolean; result: string }
  | { type: 'text'; text: string }
  | { type: 'answer'; text: string; partial: boolean }
  | {
      type: 'done';
      usage: { prompt_tokens: number; completion_tokens: number };
      calls: number;
      prompt_version: string;
      grounding: { checked: number; ungrounded: string[] };
    }
  | { type: 'error'; message: string };

export interface AgentStatus {
  llm_configured: boolean;
  model: string | null;
  prompt_version: string;
  tools: string[];
}
