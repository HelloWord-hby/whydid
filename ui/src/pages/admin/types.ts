/** Shapes of the admin API (mirrors src/admin/*). Config objects are raw YAML, as stored in the files. */
import { type Localized } from '../../lib/types';

export type SourceKind = 'model_output' | 'semantic';

export interface RawSource {
  kind: SourceKind;
  config?: string;
  feedback_score?: string;
  negative_feedback_value?: number;
  low_score_threshold?: number;
  max_pages?: number;
}

export interface RawBoard {
  id: string;
  title: Localized;
  description?: Localized;
  source: string;
}

export interface RawCard {
  id: string;
  board: string;
  title: Localized;
  description?: Localized;
  display: string;
  provider: string;
  params?: Record<string, unknown>;
  size?: number;
  default?: boolean;
  ask?: Localized;
}

export interface RawMetric {
  kind: 'additive' | 'rate';
  expr?: string;
  of?: string;
  label?: string;
  unit?: string;
  decompose?: boolean;
  note?: string;
}

export interface RawDimension {
  column: string;
  label?: string;
  values?: Record<string, string>;
  note?: string;
}

export interface RawSemantic {
  table: string;
  time_column: string;
  timezone?: string;
  data_start?: string;
  context?: string;
  metrics: Record<string, RawMetric>;
  dimensions: Record<string, RawDimension>;
}

export interface Bundle {
  boards: { sources: Record<string, RawSource>; boards: RawBoard[]; cards: RawCard[] } & Record<string, unknown>;
  semantic: Record<string, RawSemantic>;
  main: RawSemantic;
}

export type FieldType = 'metric' | 'metrics' | 'dimension' | 'filters' | 'steps' | 'score' | 'scores' | 'enum' | 'number' | 'boolean';

export interface ParamField {
  key: string;
  type: FieldType;
  label: { en: string; zh: string };
  required?: boolean;
  options?: string[];
  default?: unknown;
  min?: number;
  max?: number;
}

export interface ProviderInfo {
  name: string;
  source: SourceKind;
  displays: string[];
  fields: ParamField[];
}

export interface FieldView {
  value: string | null;
  origin: 'saved' | 'env' | 'default' | 'none';
}

export interface SettingsView {
  llm: { base_url: FieldView; api_key: FieldView; model: FieldView };
  langfuse: { host: FieldView; public_key: FieldView; secret_key: FieldView };
  databases: { default: FieldView; sources: Record<string, string> };
}

export interface AdminOverview {
  writable: boolean;
  files: { boards: string; main: string; settings: string; base_dir: string };
  bundle: Bundle;
  semantic_paths: Record<string, string | null>;
  providers: ProviderInfo[];
  settings: SettingsView;
  model_scores: string[];
  model_scores_error: string | null;
  prompt_version: string;
}

export interface TestResult {
  ok: boolean;
  error?: string;
  status?: number;
  [key: string]: unknown;
}

export interface DbInspection extends TestResult {
  database?: string;
  server_version?: string;
  url?: string;
  tables?: Array<{ schema: string; name: string; kind: 'table' | 'view' }>;
  columns?: Array<{ name: string; type: string }>;
}
