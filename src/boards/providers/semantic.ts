/**
 * Semantic-layer providers — cards over any table described by a whydid
 * config. They only call the existing deterministic tools (get_metric,
 * get_metric_trend, compare_periods), so the board and the agent read
 * exactly the same numbers through the same validated SQL.
 */
import { z } from 'zod';
import { getDimensionOrThrow, getMetricOrThrow, type WhydidConfig } from '../../config/schema.js';
import { comparePeriods } from '../../tools/compare-periods.js';
import { getMetric } from '../../tools/get-metric.js';
import { getMetricTrend } from '../../tools/get-metric-trend.js';
import { buildBar, buildPie } from '../charts.js';
import { daysIn } from '../window.js';
import { type CardPayload, type TableColumn, type ValueFormat } from '../types.js';
import { defineProvider, type AnyProvider } from './types.js';

const FORMAT = z.enum(['int', 'float', 'pct', 'ms', 'sec', 'usd']);
const GOOD = z.enum(['up', 'down', 'none']);

/** Display hint derived from the metric definition unless overridden. */
export function metricFormat(config: WhydidConfig, metric: string, override?: ValueFormat): ValueFormat {
  if (override) return override;
  const def = getMetricOrThrow(config, metric);
  if (def.kind === 'additive') return 'int';
  switch ((def.unit ?? '').toLowerCase()) {
    case '':
      return 'pct';
    case 'ms':
      return 'ms';
    case 's':
    case 'sec':
      return 'sec';
    case 'usd':
      return 'usd';
    default:
      return 'float';
  }
}

function label(config: WhydidConfig, metric: string): string {
  return getMetricOrThrow(config, metric).label ?? metric;
}

function dimLabel(config: WhydidConfig, dimension: string): string {
  return getDimensionOrThrow(config, dimension).label ?? dimension;
}

export const metricStatProvider = defineProvider({
  source: 'semantic',
  displays: ['stat'],
  params: z
    .object({ metric: z.string(), good_direction: GOOD.default('up'), format: FORMAT.optional() })
    .strict(),
  validate: (p, ctx) => void getMetricOrThrow(ctx.tool.config, p.metric),
  run: async (p, ctx, win): Promise<CardPayload> => {
    const [cmp, trend] = await Promise.all([
      comparePeriods(ctx.tool, { metric: p.metric, period_b: win.current, period_a: win.previous }),
      getMetricTrend(ctx.tool, { metric: p.metric, period: win.current, granularity: 'day' }),
    ]);
    return {
      display: 'stat',
      value: cmp.period_b_total,
      previous: cmp.period_a_total,
      delta: cmp.delta,
      delta_pct: cmp.delta_pct == null ? null : cmp.delta_pct / 100,
      format: metricFormat(ctx.tool.config, p.metric, p.format),
      good_direction: p.good_direction,
      spark: trend.points.map((pt) => ({ t: pt.bucket.slice(0, 10), v: pt.value })),
    };
  },
});

export const metricTrendProvider = defineProvider({
  source: 'semantic',
  displays: ['line'],
  params: z.object({ metrics: z.array(z.string()).min(1).max(6), format: FORMAT.optional() }).strict(),
  validate: (p, ctx) => p.metrics.forEach((m) => getMetricOrThrow(ctx.tool.config, m)),
  run: async (p, ctx, win): Promise<CardPayload> => {
    const days = daysIn(win.current);
    const results = await Promise.all(
      p.metrics.map((metric) =>
        getMetricTrend(ctx.tool, { metric, period: win.current, granularity: 'day' })
      )
    );
    return {
      display: 'line',
      format: metricFormat(ctx.tool.config, p.metrics[0]!, p.format),
      series: results.map((r, i) => {
        const byDay = new Map(r.points.map((pt) => [pt.bucket.slice(0, 10), pt.value]));
        return {
          name: label(ctx.tool.config, p.metrics[i]!),
          points: days.map((d) => ({ t: d, v: byDay.get(d) ?? null })),
        };
      }),
    };
  },
});

export const metricBreakdownProvider = defineProvider({
  source: 'semantic',
  displays: ['table', 'bar', 'pie'],
  params: z
    .object({
      dimension: z.string(),
      /**
       * First metric sorts the rows and is the one drawn by bar and pie;
       * tables show every metric as a column.
       */
      metrics: z.array(z.string()).min(1).max(5),
      share: z.boolean().default(false),
      /** Rows for table/bar; slices for pie (the tail merges into "Other"). */
      limit: z.number().int().min(1).max(50).default(10),
      /** Same shape as the tools' filters: dimension → value(s). */
      filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    })
    .strict(),
  validate: (p, ctx, display) => {
    getDimensionOrThrow(ctx.tool.config, p.dimension);
    Object.keys(p.filters ?? {}).forEach((d) => getDimensionOrThrow(ctx.tool.config, d));
    p.metrics.forEach((m) => getMetricOrThrow(ctx.tool.config, m));
    const first = getMetricOrThrow(ctx.tool.config, p.metrics[0]!);
    if (display === 'pie' && first.kind !== 'additive') {
      // Rates and averages are not parts of a whole; a pie of them is meaningless.
      throw new Error(`a pie needs an additive metric, but "${p.metrics[0]}" is a ${first.kind} metric`);
    }
  },
  run: async (p, ctx, win, display): Promise<CardPayload> => {
    const config = ctx.tool.config;
    const results = await Promise.all(
      p.metrics.map((metric) =>
        getMetric(ctx.tool, { metric, period: win.current, group_by: p.dimension, filters: p.filters })
      )
    );
    const primary = results[0]!.rows ?? [];
    const total = primary.reduce((s, r) => s + r.value, 0);
    const format = metricFormat(config, p.metrics[0]!);
    const segments = [...primary]
      .sort((a, b) => b.value - a.value)
      .map((r) => ({ label: r.label ?? r.segment, value: r.value }));

    if (display === 'pie') {
      return buildPie(segments, format, p.limit, `${label(config, p.metrics[0]!)} by ${dimLabel(config, p.dimension)}`);
    }
    if (display === 'bar') {
      const additive = getMetricOrThrow(config, p.metrics[0]!).kind === 'additive';
      return buildBar(segments, format, {
        limit: p.limit,
        withShare: p.share && additive,
        caption: `${label(config, p.metrics[0]!)} by ${dimLabel(config, p.dimension)}`,
      });
    }
    const lookups = results.map((r) => new Map((r.rows ?? []).map((row) => [row.segment, row.value])));

    const rows = [...primary]
      .sort((a, b) => b.value - a.value)
      .slice(0, p.limit)
      .map((seg) => {
        const row: Record<string, string | number | null> = { segment: seg.label ?? seg.segment };
        p.metrics.forEach((m, i) => {
          row[m] = lookups[i]!.get(seg.segment) ?? null;
        });
        if (p.share) row.share = total === 0 ? null : seg.value / total;
        return row;
      });

    const columns: TableColumn[] = [
      { key: 'segment', label: dimLabel(config, p.dimension), format: 'text' },
      ...p.metrics.map((m) => ({ key: m, label: label(config, m), format: metricFormat(config, m) })),
    ];
    if (p.share) columns.push({ key: 'share', label: 'Share', format: 'pct', bar: true });
    return { display: 'table', columns, rows };
  },
});

export const funnelProvider = defineProvider({
  source: 'semantic',
  displays: ['table', 'bar'],
  params: z
    .object({
      steps: z.array(z.object({ metric: z.string(), label: z.string().optional() })).min(2).max(10),
    })
    .strict(),
  validate: (p, ctx) => p.steps.forEach((s) => getMetricOrThrow(ctx.tool.config, s.metric)),
  run: async (p, ctx, win, display): Promise<CardPayload> => {
    const values = await Promise.all(
      p.steps.map((s) => getMetric(ctx.tool, { metric: s.metric, period: win.current }))
    );
    const totals = values.map((v) => v.total);
    const first = totals[0] ?? null;
    const rows = p.steps.map((s, i) => {
      const value = totals[i] ?? null;
      const prev = i === 0 ? null : (totals[i - 1] ?? null);
      return {
        step: s.label ?? label(ctx.tool.config, s.metric),
        value,
        of_first: value == null || !first ? null : value / first,
        of_previous: i === 0 || value == null || !prev ? null : value / prev,
      };
    });
    if (display === 'bar') {
      // Funnel order matters, so bars keep step order instead of sorting.
      return {
        display: 'bar',
        format: 'int',
        items: rows.map((r) => ({ label: r.step, value: r.value, share: r.of_first })),
        share_label: 'of first step',
      };
    }
    return {
      display: 'table',
      columns: [
        { key: 'step', label: 'Step', format: 'text' },
        { key: 'value', label: 'Users', format: 'int' },
        { key: 'of_first', label: 'Of first step', format: 'pct', bar: true },
        { key: 'of_previous', label: 'Step conversion', format: 'pct' },
      ],
      rows,
    };
  },
});

export const SEMANTIC_PROVIDERS: Record<string, AnyProvider> = {
  metric_stat: metricStatProvider,
  metric_trend: metricTrendProvider,
  metric_breakdown: metricBreakdownProvider,
  funnel: funnelProvider,
};
