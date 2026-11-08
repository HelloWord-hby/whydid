/**
 * Model-output providers — cards over Langfuse traces and scores.
 * All arithmetic lives in ../model/aggregate.ts.
 */
import { z } from 'zod';
import {
  dailyScoreAverages,
  dailyTraceCounts,
  feedbackStats,
  lowScoreSamples,
  lowScoreStats,
  negativeFeedbackSamples,
  qualityScoreNames,
  scoreAverage,
  traceCount,
  traceFieldAverage,
  type ModelDataset,
  type ScoreSample,
} from '../model/aggregate.js';
import { daysIn, difference, relativeChange } from '../window.js';
import { type CardPayload, type StatData, type TableColumn, type Window } from '../types.js';
import { defineProvider, type AnyProvider, type ModelSourceContext } from './types.js';

const GOOD = z.enum(['up', 'down', 'none']);

async function load(ctx: ModelSourceContext, win: Window): Promise<ModelDataset> {
  return ctx.source.load(win.previous.from, win.current.to);
}

function stat(
  value: number | null,
  previous: number | null,
  format: StatData['format'],
  good: StatData['good_direction'],
  extra: Partial<StatData> = {}
): StatData {
  return {
    display: 'stat',
    value,
    previous,
    format,
    delta: difference(value, previous),
    delta_pct: relativeChange(value, previous),
    good_direction: good,
    ...extra,
  };
}

const SAMPLE_COLUMNS: TableColumn[] = [
  { key: 'timestamp', label: 'Time', format: 'datetime' },
  { key: 'route', label: 'Route', format: 'text' },
  { key: 'release', label: 'Release', format: 'text' },
  { key: 'score', label: 'Score', format: 'text' },
  { key: 'value', label: 'Value', format: 'float' },
  { key: 'comment', label: 'Comment', format: 'text' },
  { key: 'trace_id', label: 'Trace', format: 'text' },
];

function sampleRows(samples: ScoreSample[]): Array<Record<string, string | number | null>> {
  return samples.map((s) => ({ ...s }));
}

export const traceCountProvider = defineProvider({
  source: 'model_output',
  displays: ['stat', 'line'],
  params: z.object({}).strict(),
  run: async (_p, ctx, win, display): Promise<CardPayload> => {
    const ds = await load(ctx, win);
    const daily = dailyTraceCounts(ds, daysIn(win.current));
    if (display === 'line') {
      return { display: 'line', format: 'int', series: [{ name: 'Traces', points: daily }] };
    }
    return stat(traceCount(ds, win.current), traceCount(ds, win.previous), 'int', 'none', {
      spark: daily,
    });
  },
});

export const traceAverageProvider = defineProvider({
  source: 'model_output',
  displays: ['stat'],
  params: z.object({ field: z.enum(['latency', 'cost']), good_direction: GOOD.default('down') }).strict(),
  run: async (p, ctx, win): Promise<CardPayload> => {
    const ds = await load(ctx, win);
    return stat(
      traceFieldAverage(ds, win.current, p.field),
      traceFieldAverage(ds, win.previous, p.field),
      p.field === 'latency' ? 'sec' : 'usd',
      p.good_direction
    );
  },
});

export const scoreAverageProvider = defineProvider({
  source: 'model_output',
  displays: ['stat'],
  params: z.object({ score: z.string() }).strict(),
  run: async (p, ctx, win): Promise<CardPayload> => {
    const ds = await load(ctx, win);
    return stat(scoreAverage(ds, p.score, win.current), scoreAverage(ds, p.score, win.previous), 'float', 'up', {
      spark: dailyScoreAverages(ds, p.score, daysIn(win.current)).filter(
        (pt): pt is { t: string; v: number } => pt.v != null
      ),
    });
  },
});

export const scoreTrendProvider = defineProvider({
  source: 'model_output',
  displays: ['line'],
  /** Omit `scores` to chart every quality score found in the data. */
  params: z.object({ scores: z.array(z.string()).optional() }).strict(),
  run: async (p, ctx, win): Promise<CardPayload> => {
    const ds = await load(ctx, win);
    const names = p.scores ?? qualityScoreNames(ds, ctx.settings);
    const days = daysIn(win.current);
    return {
      display: 'line',
      format: 'float',
      series: names.map((name) => ({ name, points: dailyScoreAverages(ds, name, days) })),
    };
  },
});

export const scoreOverviewProvider = defineProvider({
  source: 'model_output',
  displays: ['table'],
  params: z.object({}).strict(),
  run: async (_p, ctx, win): Promise<CardPayload> => {
    const ds = await load(ctx, win);
    const lowNow = new Map(
      lowScoreStats(ds, win.current, ctx.settings, 'score').map((r) => [r.group, r.low_rate])
    );
    const rows = qualityScoreNames(ds, ctx.settings).map((name) => {
      const current = scoreAverage(ds, name, win.current);
      const previous = scoreAverage(ds, name, win.previous);
      return {
        score: name,
        current,
        previous,
        delta: difference(current, previous),
        low_rate: lowNow.get(name) ?? null,
      };
    });
    return {
      display: 'table',
      columns: [
        { key: 'score', label: 'Score', format: 'text' },
        { key: 'current', label: 'Avg (current)', format: 'float' },
        { key: 'previous', label: 'Avg (previous)', format: 'float' },
        { key: 'delta', label: 'Change', format: 'float' },
        { key: 'low_rate', label: 'Low-score rate', format: 'pct', bar: true },
      ],
      rows,
    };
  },
});

export const lowScoreRateProvider = defineProvider({
  source: 'model_output',
  displays: ['table', 'bar'],
  params: z
    .object({ group_by: z.enum(['score', 'route', 'release']).default('score'), score: z.string().optional() })
    .strict(),
  run: async (p, ctx, win, display): Promise<CardPayload> => {
    const ds = await load(ctx, win);
    const caption = `Low = score below ${ctx.settings.low_score_threshold}${p.score ? ` · ${p.score} only` : ''}`;
    if (display === 'bar') {
      // Rates are not parts of a whole, so no share column; bars are already rate-sorted.
      return {
        display: 'bar',
        format: 'pct',
        items: lowScoreStats(ds, win.current, ctx.settings, p.group_by, p.score).map((r) => ({
          label: r.group,
          value: r.low_rate,
          share: null,
        })),
        caption,
      };
    }
    const prev = new Map(
      lowScoreStats(ds, win.previous, ctx.settings, p.group_by, p.score).map((r) => [r.group, r.low_rate])
    );
    const rows = lowScoreStats(ds, win.current, ctx.settings, p.group_by, p.score).map((r) => ({
      group: r.group,
      n: r.n,
      low: r.low,
      low_rate: r.low_rate,
      previous_rate: prev.get(r.group) ?? null,
    }));
    return {
      display: 'table',
      columns: [
        { key: 'group', label: p.group_by === 'score' ? 'Dimension' : p.group_by === 'route' ? 'Route' : 'Release', format: 'text' },
        { key: 'n', label: 'Scored', format: 'int' },
        { key: 'low', label: 'Low', format: 'int' },
        { key: 'low_rate', label: 'Low rate', format: 'pct', bar: true },
        { key: 'previous_rate', label: 'Previous', format: 'pct' },
      ],
      rows,
      caption,
    };
  },
});

export const lowScoreSamplesProvider = defineProvider({
  source: 'model_output',
  displays: ['table'],
  params: z.object({ limit: z.number().int().min(1).max(100).default(10) }).strict(),
  run: async (p, ctx, win): Promise<CardPayload> => {
    const ds = await load(ctx, win);
    return {
      display: 'table',
      columns: SAMPLE_COLUMNS,
      rows: sampleRows(lowScoreSamples(ds, win.current, ctx.settings, p.limit)),
      caption: `Lowest ${p.limit} quality scores in the window`,
    };
  },
});

export const negativeFeedbackProvider = defineProvider({
  source: 'model_output',
  displays: ['stat'],
  params: z.object({}).strict(),
  run: async (_p, ctx, win): Promise<CardPayload> => {
    const ds = await load(ctx, win);
    const now = feedbackStats(ds, win.current, ctx.settings);
    const before = feedbackStats(ds, win.previous, ctx.settings);
    return stat(now.negative_rate, before.negative_rate, 'pct', 'down', {
      caption: `${now.negative} thumbs-down of ${now.total} rated`,
    });
  },
});

export const feedbackSamplesProvider = defineProvider({
  source: 'model_output',
  displays: ['table'],
  params: z.object({ limit: z.number().int().min(1).max(100).default(10) }).strict(),
  run: async (p, ctx, win): Promise<CardPayload> => {
    const ds = await load(ctx, win);
    return {
      display: 'table',
      columns: SAMPLE_COLUMNS.filter((c) => c.key !== 'value' && c.key !== 'score'),
      rows: sampleRows(negativeFeedbackSamples(ds, win.current, ctx.settings, p.limit)),
    };
  },
});

export const MODEL_PROVIDERS: Record<string, AnyProvider> = {
  trace_count: traceCountProvider,
  trace_average: traceAverageProvider,
  score_average: scoreAverageProvider,
  score_trend: scoreTrendProvider,
  score_overview: scoreOverviewProvider,
  low_score_rate: lowScoreRateProvider,
  low_score_samples: lowScoreSamplesProvider,
  negative_feedback: negativeFeedbackProvider,
  feedback_samples: feedbackSamplesProvider,
};
