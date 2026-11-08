/**
 * Form descriptions of provider params, for the admin page's card editor.
 *
 * The zod schema in each provider stays the source of truth for validation;
 * these descriptors only tell the form which control to draw and where its
 * options come from (metric / dimension names of the source, score names
 * seen in the data). A test keeps the two in sync.
 */
import { PROVIDERS } from './index.js';

export type FieldType =
  | 'metric' // one metric of the semantic source
  | 'metrics' // several metrics, ordered
  | 'dimension' // one dimension of the semantic source
  | 'filters' // dimension → value(s)
  | 'steps' // funnel steps: metric + optional label
  | 'score' // one score name from the model data
  | 'scores' // several score names
  | 'enum'
  | 'number'
  | 'boolean';

export interface ParamField {
  key: string;
  type: FieldType;
  label: { en: string; zh: string };
  required?: boolean;
  options?: readonly string[];
  default?: unknown;
  min?: number;
  max?: number;
}

const GOOD = ['up', 'down', 'none'] as const;
const FORMATS = ['int', 'float', 'pct', 'ms', 'sec', 'usd'] as const;

const goodDirection = (fallback: string): ParamField => ({
  key: 'good_direction',
  type: 'enum',
  label: { en: 'Good direction', zh: '变好的方向' },
  options: GOOD,
  default: fallback,
});
const format: ParamField = { key: 'format', type: 'enum', label: { en: 'Number format', zh: '数字格式' }, options: FORMATS };
const limit = (max: number): ParamField => ({ key: 'limit', type: 'number', label: { en: 'Rows', zh: '行数' }, default: 10, min: 1, max });

export const PROVIDER_FIELDS: Record<string, ParamField[]> = {
  trace_count: [],
  trace_average: [
    { key: 'field', type: 'enum', label: { en: 'Field', zh: '字段' }, options: ['latency', 'cost'], required: true },
    goodDirection('down'),
  ],
  score_average: [{ key: 'score', type: 'score', label: { en: 'Score', zh: '评分' }, required: true }],
  score_trend: [{ key: 'scores', type: 'scores', label: { en: 'Scores (empty = all)', zh: '评分（留空为全部）' } }],
  score_overview: [],
  low_score_rate: [
    { key: 'group_by', type: 'enum', label: { en: 'Group by', zh: '分组' }, options: ['score', 'route', 'release'], default: 'score' },
    { key: 'score', type: 'score', label: { en: 'Only this score', zh: '只看这个评分' } },
  ],
  low_score_samples: [limit(100)],
  negative_feedback: [],
  feedback_samples: [limit(100)],
  metric_stat: [{ key: 'metric', type: 'metric', label: { en: 'Metric', zh: '指标' }, required: true }, goodDirection('up'), format],
  metric_trend: [{ key: 'metrics', type: 'metrics', label: { en: 'Metrics', zh: '指标' }, required: true, min: 1, max: 6 }, format],
  metric_breakdown: [
    { key: 'dimension', type: 'dimension', label: { en: 'Split by', zh: '按维度拆分' }, required: true },
    { key: 'metrics', type: 'metrics', label: { en: 'Metrics (first one is drawn)', zh: '指标（图上画第一个）' }, required: true, min: 1, max: 5 },
    { key: 'share', type: 'boolean', label: { en: 'Show share of total', zh: '显示占比' }, default: false },
    limit(50),
    { key: 'filters', type: 'filters', label: { en: 'Filters', zh: '筛选' } },
  ],
  funnel: [{ key: 'steps', type: 'steps', label: { en: 'Steps', zh: '步骤' }, required: true, min: 2, max: 10 }],
};

export interface ProviderInfo {
  name: string;
  source: 'model_output' | 'semantic';
  displays: readonly string[];
  fields: ParamField[];
}

export function providerCatalog(): ProviderInfo[] {
  return Object.entries(PROVIDERS).map(([name, p]) => ({
    name,
    source: p.source,
    displays: p.displays,
    fields: PROVIDER_FIELDS[name] ?? [],
  }));
}
