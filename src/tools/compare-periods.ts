/**
 * compare_periods — current period vs an equal-length baseline.
 *
 * The baseline can be given explicitly or derived by strategy (previous
 * period / same window last week / last month) — derived in code, because
 * date arithmetic is exactly the kind of thing the LLM gets subtly wrong.
 *
 * The result carries a direction_note spelling out which period is which
 * and whether the metric went up or down. Narrators quoting a decomposition
 * have one job: not flipping the sign. The note makes that unambiguous.
 */
import { getMetricOrThrow } from '../config/schema.js';
import { buildMetricQuery, type Filters } from '../core/sql-builder.js';
import {
  assertEqualLength,
  assertValidPeriod,
  guardDataStart,
  resolveComparisonPeriod,
  type ComparisonStrategy,
  type Period,
} from '../core/periods.js';
import { toNumber, type ToolContext } from './context.js';

export interface ComparePeriodsArgs {
  metric: string;
  period_b: Period;
  period_a?: Period;
  compare_to?: ComparisonStrategy;
  filters?: Filters;
}

export interface ComparePeriodsResult {
  metric: string;
  period_a: Period;
  period_b: Period;
  period_a_total: number | null;
  period_b_total: number | null;
  delta: number | null;
  delta_pct: number | null;
  direction_note: string;
}

export async function comparePeriods(
  ctx: ToolContext,
  args: ComparePeriodsArgs
): Promise<ComparePeriodsResult> {
  assertValidPeriod(args.period_b, 'period_b');
  const periodA =
    args.period_a ?? resolveComparisonPeriod(args.period_b, args.compare_to ?? 'prev_period');
  assertValidPeriod(periodA, 'period_a');
  assertEqualLength(periodA, args.period_b);
  guardDataStart(periodA, ctx.config.data_start);
  guardDataStart(args.period_b, ctx.config.data_start);
  getMetricOrThrow(ctx.config, args.metric);

  const queryFor = (period: Period) =>
    buildMetricQuery(ctx.config, { metric: args.metric, period, filters: args.filters });
  const qa = queryFor(periodA);
  const qb = queryFor(args.period_b);

  const [rowsA, rowsB] = await Promise.all([
    ctx.db.unsafe(qa.text, qa.params),
    ctx.db.unsafe(qb.text, qb.params),
  ]);

  const totalA = rowsA[0]?.value == null ? null : toNumber(rowsA[0].value);
  const totalB = rowsB[0]?.value == null ? null : toNumber(rowsB[0].value);
  const delta = totalA != null && totalB != null ? totalB - totalA : null;
  const deltaPct =
    delta != null && totalA != null && totalA !== 0 ? (delta / totalA) * 100 : null;

  const direction =
    delta == null ? 'not comparable (missing data)' : delta > 0 ? 'UP' : delta < 0 ? 'DOWN' : 'FLAT';

  return {
    metric: args.metric,
    period_a: periodA,
    period_b: args.period_b,
    period_a_total: totalA,
    period_b_total: totalB,
    delta,
    delta_pct: deltaPct,
    direction_note:
      `period_a is the BASELINE (${periodA.from} to ${periodA.to}), ` +
      `period_b is the CURRENT period (${args.period_b.from} to ${args.period_b.to}). ` +
      `delta = period_b − period_a. The metric is ${direction} versus the baseline. ` +
      `Describe the change exactly in this direction.`,
  };
}
