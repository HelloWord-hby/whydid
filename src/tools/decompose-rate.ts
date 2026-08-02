/**
 * decompose_change_rate — Oaxaca-Blinder decomposition of a rate/average
 * metric change into mix effect vs behavior effect along one dimension.
 */
import { getDimensionOrThrow, getMetricOrThrow, labelForValue } from '../config/schema.js';
import { decomposeRate, type RateResult } from '../attribution/rate.js';
import { buildDecomposeQuery, type Filters } from '../core/sql-builder.js';
import {
  assertEqualLength,
  assertValidPeriod,
  guardDataStart,
  type Period,
} from '../core/periods.js';
import { toNumber, type ToolContext } from './context.js';

export interface DecomposeRateArgs {
  metric: string;
  period_a: Period;
  period_b: Period;
  dimension: string;
  top_n?: number;
  filters?: Filters;
}

export type DecomposeRateResult = RateResult & {
  metric: string;
  dimension: string;
  direction_note: string;
};

export async function decomposeChangeRate(
  ctx: ToolContext,
  args: DecomposeRateArgs
): Promise<DecomposeRateResult> {
  assertValidPeriod(args.period_a, 'period_a');
  assertValidPeriod(args.period_b, 'period_b');
  assertEqualLength(args.period_a, args.period_b);
  guardDataStart(args.period_a, ctx.config.data_start);
  guardDataStart(args.period_b, ctx.config.data_start);

  const def = getMetricOrThrow(ctx.config, args.metric);
  if (def.kind !== 'rate') {
    throw new Error(
      `Metric "${args.metric}" is an additive metric — use decompose_change_additive instead.`
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
    return rows.map((r) => ({
      segment: String(r.segment),
      count: toNumber(r.count),
      sum: toNumber(r.sum),
    }));
  };

  const [rowsA, rowsB] = await Promise.all([
    queryPeriod(args.period_a),
    queryPeriod(args.period_b),
  ]);

  const result = decomposeRate(rowsA, rowsB, args.top_n ?? 10);

  const drivers = result.drivers.map((d) => {
    const label = labelForValue(dim, d.segment);
    return label ? { ...d, label } : d;
  });

  const direction =
    result.delta_rate == null
      ? 'not comparable (one period has no data)'
      : result.delta_rate > 0
        ? 'UP'
        : result.delta_rate < 0
          ? 'DOWN'
          : 'FLAT';

  return {
    ...result,
    drivers,
    metric: args.metric,
    dimension: args.dimension,
    direction_note:
      `period_a is the BASELINE (${args.period_a.from} to ${args.period_a.to}), ` +
      `period_b is the CURRENT period (${args.period_b.from} to ${args.period_b.to}). ` +
      `delta_rate = period_b − period_a → the rate is ${direction} versus the baseline. ` +
      `mix_effect = change from traffic composition shifting; ` +
      `behavior_effect = change from segments' own rates moving. Never flip this direction.` +
      (result.interaction_warning
        ? ' NOTE: the interaction term is large relative to the total change — present the mix/behavior split as approximate.'
        : ''),
  };
}
