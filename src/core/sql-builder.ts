/**
 * SQL builder — pure functions that turn validated tool parameters into
 * parameterized queries.
 *
 * Safety model:
 * - Identifiers (table, columns) come from the operator-authored config and
 *   are validated against a strict identifier regex at load time.
 * - Metric expressions come from the same trusted config.
 * - Everything the LLM controls (metric names, dimension names, granularity)
 *   is resolved through config lookups — unknown names throw.
 * - Everything free-form (dates, filter values) is passed as bind parameters,
 *   never interpolated.
 */
import {
  getDimensionOrThrow,
  getMetricOrThrow,
  metricExpr,
  quoteIdentifier,
  type WhydidConfig,
} from '../config/schema.js';
import { type Period } from './periods.js';

export interface BuiltQuery {
  text: string;
  params: string[];
}

export type Filters = Record<string, string | string[]>;

export const GRANULARITIES = ['hour', 'day', 'week'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

interface WhereResult {
  clause: string;
  params: string[];
}

/** Time-range condition plus optional dimension filters, fully parameterized. */
function buildWhere(
  config: WhydidConfig,
  period: Period,
  filters: Filters | undefined,
  startIndex = 1
): WhereResult {
  const timeCol = quoteIdentifier(config.time_column);
  const params: string[] = [period.from, period.to];
  let i = startIndex + 2;
  const conditions = [
    `${timeCol} >= $${startIndex}::timestamptz`,
    `${timeCol} < $${startIndex + 1}::timestamptz`,
  ];

  for (const [dimName, value] of Object.entries(filters ?? {})) {
    const dim = getDimensionOrThrow(config, dimName);
    const col = quoteIdentifier(dim.column);
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const placeholders = value.map(() => `$${i++}`);
      conditions.push(`${col}::text IN (${placeholders.join(', ')})`);
      params.push(...value);
    } else {
      conditions.push(`${col}::text = $${i++}`);
      params.push(value);
    }
  }

  return { clause: `WHERE ${conditions.join(' AND ')}`, params };
}

/** Single metric value over a period, optionally grouped by one dimension. */
export function buildMetricQuery(
  config: WhydidConfig,
  args: { metric: string; period: Period; groupBy?: string; filters?: Filters }
): BuiltQuery {
  const def = getMetricOrThrow(config, args.metric);
  const table = quoteIdentifier(config.table);
  const { clause, params } = buildWhere(config, args.period, args.filters);

  if (!args.groupBy) {
    return {
      text: `SELECT ${metricExpr(def)} AS value FROM ${table} ${clause}`,
      params,
    };
  }

  const dim = getDimensionOrThrow(config, args.groupBy);
  const col = quoteIdentifier(dim.column);
  return {
    text:
      `SELECT COALESCE(${col}::text, '(null)') AS segment, ${metricExpr(def)} AS value ` +
      `FROM ${table} ${clause} GROUP BY 1 ORDER BY 2 DESC`,
    params,
  };
}

/**
 * Per-segment rows needed by the decomposition algorithms.
 * additive → segment, value
 * rate     → segment, count (AVG denominator), sum (AVG numerator)
 */
export function buildDecomposeQuery(
  config: WhydidConfig,
  args: { metric: string; period: Period; dimension: string; filters?: Filters }
): BuiltQuery {
  const def = getMetricOrThrow(config, args.metric);
  const table = quoteIdentifier(config.table);
  const dim = getDimensionOrThrow(config, args.dimension);
  const col = quoteIdentifier(dim.column);
  const { clause, params } = buildWhere(config, args.period, args.filters);

  const selectAgg =
    def.kind === 'additive'
      ? `${def.expr} AS value`
      : `COUNT(${def.of}) AS count, COALESCE(SUM(${def.of}), 0) AS sum`;

  return {
    text:
      `SELECT COALESCE(${col}::text, '(null)') AS segment, ${selectAgg} ` +
      `FROM ${table} ${clause} GROUP BY 1`,
    params,
  };
}

/** Metric per time bucket. Buckets follow the configured timezone. */
export function buildTrendQuery(
  config: WhydidConfig,
  args: { metric: string; period: Period; granularity: Granularity; filters?: Filters }
): BuiltQuery {
  const def = getMetricOrThrow(config, args.metric);
  if (!GRANULARITIES.includes(args.granularity)) {
    throw new Error(
      `Unknown granularity "${args.granularity}". Allowed: ${GRANULARITIES.join(', ')}`
    );
  }
  const table = quoteIdentifier(config.table);
  const timeCol = quoteIdentifier(config.time_column);
  const { clause, params } = buildWhere(config, args.period, args.filters);

  // date_trunc uses the session timezone, which the db client pins to
  // config.timezone — so "day" means a calendar day where the operator lives.
  return {
    text:
      `SELECT date_trunc('${args.granularity}', ${timeCol}) AS bucket, ` +
      `${metricExpr(def)} AS value ` +
      `FROM ${table} ${clause} GROUP BY 1 ORDER BY 1`,
    params,
  };
}
