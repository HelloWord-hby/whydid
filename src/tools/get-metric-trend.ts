/**
 * get_metric_trend — a metric per time bucket, with basic outlier flags so
 * the LLM can spot spikes without doing arithmetic itself.
 */
import { getMetricOrThrow } from '../config/schema.js';
import { buildTrendQuery, type Filters, type Granularity } from '../core/sql-builder.js';
import { assertValidPeriod, guardDataStart, type Period } from '../core/periods.js';
import { toNumber, type ToolContext } from './context.js';

export interface GetMetricTrendArgs {
  metric: string;
  period: Period;
  granularity: Granularity;
  filters?: Filters;
}

export interface TrendPoint {
  bucket: string;
  value: number;
  /** Set when |value − mean| > 2σ across the window (needs ≥ 8 points). */
  outlier?: 'high' | 'low';
}

export interface GetMetricTrendResult {
  metric: string;
  period: Period;
  granularity: Granularity;
  points: TrendPoint[];
  summary: { mean: number; min: number; max: number; stddev: number } | null;
}

const MIN_POINTS_FOR_OUTLIERS = 8;
const OUTLIER_SIGMA = 2;

export async function getMetricTrend(
  ctx: ToolContext,
  args: GetMetricTrendArgs
): Promise<GetMetricTrendResult> {
  assertValidPeriod(args.period);
  guardDataStart(args.period, ctx.config.data_start);
  getMetricOrThrow(ctx.config, args.metric);

  const query = buildTrendQuery(ctx.config, {
    metric: args.metric,
    period: args.period,
    granularity: args.granularity,
    filters: args.filters,
  });
  const rows = await ctx.db.unsafe(query.text, query.params);

  const points: TrendPoint[] = rows
    .filter((r) => r.value != null)
    .map((r) => ({
      bucket: formatBucket(r.bucket, args.granularity),
      value: toNumber(r.value),
    }));

  if (points.length === 0) {
    return { ...args, points: [], summary: null };
  }

  const values = points.map((p) => p.value);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);

  if (points.length >= MIN_POINTS_FOR_OUTLIERS && stddev > 0) {
    for (const p of points) {
      const z = (p.value - mean) / stddev;
      if (z > OUTLIER_SIGMA) p.outlier = 'high';
      else if (z < -OUTLIER_SIGMA) p.outlier = 'low';
    }
  }

  return {
    metric: args.metric,
    period: args.period,
    granularity: args.granularity,
    points,
    summary: {
      mean,
      min: Math.min(...values),
      max: Math.max(...values),
      stddev,
    },
  };
}

function formatBucket(bucket: unknown, granularity: Granularity): string {
  const d = bucket instanceof Date ? bucket : new Date(String(bucket));
  const iso = d.toISOString();
  return granularity === 'hour' ? iso.slice(0, 13) + ':00' : iso.slice(0, 10);
}
