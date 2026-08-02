/**
 * decompose_change_additive — split the change of a count/sum metric into
 * per-segment contributions along one dimension.
 */
import { getDimensionOrThrow, getMetricOrThrow, labelForValue } from '../config/schema.js';
import { decomposeAdditive, type AdditiveResult } from '../attribution/additive.js';
import { buildDecomposeQuery, type Filters } from '../core/sql-builder.js';
import {
  assertEqualLength,
  assertValidPeriod,
  guardDataStart,
  type Period,
} from '../core/periods.js';
import { toNumber, type ToolContext } from './context.js';

export interface DecomposeAdditiveArgs {
  metric: string;
  period_a: Period;
  period_b: Period;
  dimension: string;
  top_n?: number;
  filters?: Filters;
}

export type DecomposeAdditiveResult = AdditiveResult & {
  metric: string;
  dimension: string;
  direction_note: string;
};

export async function decomposeChangeAdditive(
  ctx: ToolContext,
  args: DecomposeAdditiveArgs
): Promise<DecomposeAdditiveResult> {
  assertValidPeriod(args.period_a, 'period_a');
  assertValidPeriod(args.period_b, 'period_b');
  assertEqualLength(args.period_a, args.period_b);
  guardDataStart(args.period_a, ctx.config.data_start);
  guardDataStart(args.period_b, ctx.config.data_start);

  const def = getMetricOrThrow(ctx.config, args.metric);
  if (def.kind !== 'additive') {
    throw new Error(
      `Metric "${args.metric}" is a rate metric — use decompose_change_rate instead. ` +
        `Additive decomposition of a rate is mathematically meaningless.`
    );
  }
  if (!def.decompose) {
    throw new Error(
      `Decomposition is disabled for "${args.metric}"${def.note ? ` (${def.note})` : ''}.`
    );
  }
  const dim = getDimensionOrThrow(ctx.config, args.dimension);

  const queryPeriod = async (period: Period) => {
    const q = buildDecomposeQuery(ctx.config, {
      metric: args.metric,
      period,
      dimension: args.dimension,
      filters: args.filters,
    });
    const rows = await ctx.db.unsafe(q.text, q.params);
    return rows.map((r) => ({ segment: String(r.segment), value: toNumber(r.value) }));
  };

  const [rowsA, rowsB] = await Promise.all([
    queryPeriod(args.period_a),
    queryPeriod(args.period_b),
  ]);

  const result = decomposeAdditive(rowsA, rowsB, args.top_n ?? 10);

  const withLabels = (drivers: typeof result.growth_drivers) =>
    drivers.map((d) => {
      const label = labelForValue(dim, d.segment);
      return label ? { ...d, label } : d;
    });

  const direction =
    result.delta > 0 ? 'UP' : result.delta < 0 ? 'DOWN' : 'FLAT';

  return {
    ...result,
    growth_drivers: withLabels(result.growth_drivers),
    drag_drivers: withLabels(result.drag_drivers),
    metric: args.metric,
    dimension: args.dimension,
    direction_note:
      `period_a is the BASELINE (${args.period_a.from} to ${args.period_a.to}, total=${result.period_a_total}), ` +
      `period_b is the CURRENT period (${args.period_b.from} to ${args.period_b.to}, total=${result.period_b_total}). ` +
      `delta = period_b − period_a = ${result.delta} → the metric is ${direction} versus the baseline. ` +
      `growth_drivers pushed it up, drag_drivers pulled it down. Never flip this direction.` +
      (result.stability === 'unstable'
        ? ' NOTE: total change is under 1% of the baseline — contribution shares are unreliable, rank by abs_contribution_share and say the total was roughly flat.'
        : ''),
  };
}
