/**
 * get_metric — a single metric value over a period, optionally split by
 * one dimension. The starting point of most investigations.
 */
import { getDimensionOrThrow, getMetricOrThrow, labelForValue } from '../config/schema.js';
import { buildMetricQuery, type Filters } from '../core/sql-builder.js';
import { assertValidPeriod, guardDataStart, type Period } from '../core/periods.js';
import { toNumber, type ToolContext } from './context.js';

export interface GetMetricArgs {
  metric: string;
  period: Period;
  group_by?: string;
  filters?: Filters;
}

export interface SegmentRow {
  segment: string;
  label?: string;
  value: number;
}

export interface GetMetricResult {
  metric: string;
  period: Period;
  total: number | null;
  rows?: SegmentRow[];
}

export async function getMetric(
  ctx: ToolContext,
  args: GetMetricArgs
): Promise<GetMetricResult> {
  assertValidPeriod(args.period);
  guardDataStart(args.period, ctx.config.data_start);
  const def = getMetricOrThrow(ctx.config, args.metric);

  const grouped = buildMetricQuery(ctx.config, {
    metric: args.metric,
    period: args.period,
    groupBy: args.group_by,
    filters: args.filters,
  });
  const rows = await ctx.db.unsafe(grouped.text, grouped.params);

  if (!args.group_by) {
    const value = rows[0]?.value;
    return {
      metric: args.metric,
      period: args.period,
      total: value == null ? null : toNumber(value),
    };
  }

  const dim = getDimensionOrThrow(ctx.config, args.group_by);
  const segmentRows: SegmentRow[] = rows.map((r) => {
    const segment = String(r.segment);
    const label = labelForValue(dim, segment);
    return label
      ? { segment, label, value: toNumber(r.value) }
      : { segment, value: toNumber(r.value) };
  });

  // For additive metrics the total is just the sum of segments; for rate
  // metrics a weighted average is needed, so run the ungrouped query.
  let total: number | null;
  if (def.kind === 'additive') {
    total = segmentRows.reduce((s, r) => s + r.value, 0);
  } else {
    const overall = buildMetricQuery(ctx.config, {
      metric: args.metric,
      period: args.period,
      filters: args.filters,
    });
    const [row] = await ctx.db.unsafe(overall.text, overall.params);
    total = row?.value == null ? null : toNumber(row.value);
  }

  return { metric: args.metric, period: args.period, total, rows: segmentRows };
}
