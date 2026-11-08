/**
 * Model-output tools — LLM quality over Langfuse (or the demo dataset).
 *
 * Aggregates first (score_summary, low_score_breakdown, feedback_summary,
 * score_trend), samples second (low_score_samples, feedback_samples,
 * get_trace). All arithmetic lives in src/boards/model/aggregate.ts.
 */
import { z } from 'zod';
import {
  dailyScoreAverages,
  feedbackByGroup,
  feedbackStats,
  lowScoreSamples,
  lowScoreStats,
  negativeFeedbackSamples,
  qualityScoreNames,
  scoreAverage,
  type ModelDataset,
  type ScoreSample,
} from '../boards/model/aggregate.js';
import { type ModelSourceContext } from '../boards/providers/types.js';
import { assertValidPeriod, periodDays, resolveComparisonPeriod } from '../core/periods.js';
import { buildWindow, daysIn, difference } from '../boards/window.js';
import { hintsForLowScore } from './hints.js';
import { sanitizeText, UNTRUSTED_NOTICE } from './sanitize.js';
import { defineAgentTool, type AgentTool, type WorkbenchEnv } from './types.js';

const MAX_PERIOD_DAYS = 31;

const WINDOW_PARAMS = {
  days: {
    type: 'number',
    enum: [7, 14, 30],
    description: 'Last N full UTC days vs the N days before. Default 7. Ignored when period is given.',
  },
  period: {
    type: 'object',
    description: 'Explicit current period, half-open [from, to), at most 31 days. Baseline = the equal-length period before it.',
    properties: { from: { type: 'string' }, to: { type: 'string' } },
    required: ['from', 'to'],
  },
} as const;

const windowArgs = {
  days: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional(),
  period: z.object({ from: z.string(), to: z.string() }).strict().optional(),
};

interface ResolvedWindow {
  current: { from: string; to: string };
  previous: { from: string; to: string };
}

export function resolveWindow(
  args: { days?: number; period?: { from: string; to: string } },
  now: Date
): ResolvedWindow {
  if (args.period) {
    assertValidPeriod(args.period);
    if (periodDays(args.period) > MAX_PERIOD_DAYS) {
      throw new Error(`period is limited to ${MAX_PERIOD_DAYS} days for model-output tools.`);
    }
    return { current: args.period, previous: resolveComparisonPeriod(args.period, 'prev_period') };
  }
  const w = buildWindow(args.days ?? 7, now);
  return { current: w.current, previous: w.previous };
}

function modelCtx(env: WorkbenchEnv): ModelSourceContext {
  if (!env.model) throw new Error('No model-output source is configured (see whydid.boards.yaml).');
  return env.model.ctx;
}

async function loadFor(env: WorkbenchEnv, w: ResolvedWindow): Promise<{ ds: ModelDataset; ctx: ModelSourceContext }> {
  const ctx = modelCtx(env);
  const ds = await ctx.source.load(w.previous.from, w.current.to);
  return { ds, ctx };
}

function baseResult(env: WorkbenchEnv, w: ResolvedWindow, ds: ModelDataset): Record<string, unknown> {
  return {
    source: env.model!.id,
    mode: env.model!.ctx.source.mode,
    current: w.current,
    baseline: w.previous,
    direction_note:
      `"baseline" is ${w.previous.from}..${w.previous.to}, "current" is ${w.current.from}..${w.current.to}. ` +
      'Deltas are current − baseline.',
    ...(ds.truncated ? { caveats: ['Live fetch hit the page cap; numbers cover a partial window.'] } : {}),
    ...(env.model!.ctx.source.mode === 'demo'
      ? { data_note: 'Demo dataset (synthetic). Say so if the user may think it is production data.' }
      : {}),
  };
}

function sampleView(s: ScoreSample): Record<string, unknown> {
  return {
    trace_id: s.trace_id,
    time: s.timestamp,
    route: s.route,
    release: s.release,
    score: s.score,
    value: s.value,
    untrusted: { comment: sanitizeText(s.comment, 300) },
  };
}

const filterProps = {
  route: { type: 'string', description: 'Only this route (trace name).' },
  release: { type: 'string', description: 'Only this release.' },
};

export const scoreSummaryTool = defineAgentTool({
  name: 'score_summary',
  description:
    'Model-output quality overview: for every quality score (LLM-judge dimension), the average and low-score rate in the current window vs the baseline, plus the thumbs-down rate. Start here for any question about answer quality.',
  parameters: { type: 'object', properties: { ...WINDOW_PARAMS } },
  args: z.object(windowArgs).strict(),
  run: async (args, env) => {
    const w = resolveWindow(args, env.now());
    const { ds, ctx } = await loadFor(env, w);
    const lowNow = new Map(lowScoreStats(ds, w.current, ctx.settings, 'score').map((r) => [r.group, r]));
    const lowPrev = new Map(lowScoreStats(ds, w.previous, ctx.settings, 'score').map((r) => [r.group, r]));
    const scores = qualityScoreNames(ds, ctx.settings).map((name) => {
      const current = scoreAverage(ds, name, w.current);
      const previous = scoreAverage(ds, name, w.previous);
      return {
        score: name,
        current_avg: current,
        baseline_avg: previous,
        delta_avg: difference(current, previous),
        current_low_rate: lowNow.get(name)?.low_rate ?? null,
        baseline_low_rate: lowPrev.get(name)?.low_rate ?? null,
        low_rate_change: difference(lowNow.get(name)?.low_rate ?? null, lowPrev.get(name)?.low_rate ?? null),
        scored: lowNow.get(name)?.n ?? 0,
      };
    });
    const fbNow = feedbackStats(ds, w.current, ctx.settings);
    const fbPrev = feedbackStats(ds, w.previous, ctx.settings);
    const worst = [...scores]
      .filter((s) => s.delta_avg != null)
      .sort((a, b) => (a.delta_avg as number) - (b.delta_avg as number))[0];
    return {
      ...baseResult(env, w, ds),
      low_score_threshold: ctx.settings.low_score_threshold,
      scores,
      feedback: {
        current_negative_rate: fbNow.negative_rate,
        baseline_negative_rate: fbPrev.negative_rate,
        negative_rate_change: difference(fbNow.negative_rate, fbPrev.negative_rate),
        current_rated: fbNow.total,
        current_negative: fbNow.negative,
      },
      next_hints: worst && (worst.delta_avg as number) < 0
        ? [`"${worst.score}" has the largest average drop. Next: low_score_breakdown with score="${worst.score}" and group_by "route" or "release".`]
        : [],
    };
  },
});

export const lowScoreBreakdownTool = defineAgentTool({
  name: 'low_score_breakdown',
  description:
    'Low-score rate (share of quality scores below the threshold) split by score dimension, route or release, current window vs baseline. Use it to locate where quality problems concentrate.',
  parameters: {
    type: 'object',
    properties: {
      ...WINDOW_PARAMS,
      group_by: { type: 'string', enum: ['score', 'route', 'release'] },
      score: { type: 'string', description: 'Only this quality score.' },
    },
    required: ['group_by'],
  },
  args: z
    .object({ ...windowArgs, group_by: z.enum(['score', 'route', 'release']), score: z.string().optional() })
    .strict(),
  run: async (args, env) => {
    const w = resolveWindow(args, env.now());
    const { ds, ctx } = await loadFor(env, w);
    const prev = new Map(
      lowScoreStats(ds, w.previous, ctx.settings, args.group_by, args.score).map((r) => [r.group, r.low_rate])
    );
    const rows = lowScoreStats(ds, w.current, ctx.settings, args.group_by, args.score).map((r) => ({
      group: r.group,
      scored: r.n,
      low: r.low,
      low_rate: r.low_rate,
      previous_low_rate: prev.get(r.group) ?? null,
      low_rate_change: difference(r.low_rate, prev.get(r.group) ?? null),
    }));
    return {
      ...baseResult(env, w, ds),
      group_by: args.group_by,
      score: args.score ?? 'all quality scores',
      low_score_threshold: ctx.settings.low_score_threshold,
      rows,
      next_hints: hintsForLowScore(rows, args.group_by, args.score),
    };
  },
});

export const scoreTrendTool = defineAgentTool({
  name: 'score_trend',
  description: 'Daily average of one quality score over the current window. Use it to see whether a drop is a step (release), a spike or a drift.',
  parameters: { type: 'object', properties: { ...WINDOW_PARAMS, score: { type: 'string' } }, required: ['score'] },
  args: z.object({ ...windowArgs, score: z.string() }).strict(),
  run: async (args, env) => {
    const w = resolveWindow(args, env.now());
    const { ds } = await loadFor(env, w);
    return { ...baseResult(env, w, ds), score: args.score, points: dailyScoreAverages(ds, args.score, daysIn(w.current)) };
  },
});

export const feedbackSummaryTool = defineAgentTool({
  name: 'feedback_summary',
  description: 'End-user thumbs-down rate, current window vs baseline, split by route or release.',
  parameters: {
    type: 'object',
    properties: { ...WINDOW_PARAMS, group_by: { type: 'string', enum: ['route', 'release'] } },
  },
  args: z.object({ ...windowArgs, group_by: z.enum(['route', 'release']).default('route') }).strict(),
  run: async (args, env) => {
    const w = resolveWindow(args, env.now());
    const { ds, ctx } = await loadFor(env, w);
    const now = feedbackStats(ds, w.current, ctx.settings);
    const before = feedbackStats(ds, w.previous, ctx.settings);
    return {
      ...baseResult(env, w, ds),
      current: now,
      baseline: before,
      delta_negative_rate: difference(now.negative_rate, before.negative_rate),
      by_group: feedbackByGroup(ds, w.current, ctx.settings, args.group_by),
    };
  },
});

export const lowScoreSamplesTool = defineAgentTool({
  name: 'low_score_samples',
  description:
    'Concrete low-scored answers (worst first) with the judge\'s rationale. Call only after an aggregate tool located the problem; filter to that route/release/score.',
  parameters: {
    type: 'object',
    properties: {
      ...WINDOW_PARAMS,
      ...filterProps,
      score: { type: 'string', description: 'Only this quality score.' },
      limit: { type: 'number', description: 'Max samples, 1–10. Default 5.' },
    },
  },
  args: z
    .object({
      ...windowArgs,
      route: z.string().optional(),
      release: z.string().optional(),
      score: z.string().optional(),
      limit: z.number().int().min(1).max(10).default(5),
    })
    .strict(),
  run: async (args, env) => {
    const w = resolveWindow(args, env.now());
    const { ds, ctx } = await loadFor(env, w);
    const matching = lowScoreSamples(ds, w.current, ctx.settings, Number.MAX_SAFE_INTEGER).filter(
      (s) =>
        (!args.route || s.route === args.route) &&
        (!args.release || s.release === args.release) &&
        (!args.score || s.score === args.score)
    );
    return {
      ...baseResult(env, w, ds),
      content_notice: UNTRUSTED_NOTICE,
      matching_total: matching.length,
      samples: matching.slice(0, args.limit).map(sampleView),
      next_hints: matching.length ? ['Use get_trace on one or two trace_ids to read the full question and answer.'] : [],
    };
  },
});

export const feedbackSamplesTool = defineAgentTool({
  name: 'feedback_samples',
  description: 'Recent thumbs-down feedback with the user\'s comment, newest first, optionally filtered by route or release.',
  parameters: {
    type: 'object',
    properties: { ...WINDOW_PARAMS, ...filterProps, limit: { type: 'number', description: '1–10, default 5.' } },
  },
  args: z
    .object({
      ...windowArgs,
      route: z.string().optional(),
      release: z.string().optional(),
      limit: z.number().int().min(1).max(10).default(5),
    })
    .strict(),
  run: async (args, env) => {
    const w = resolveWindow(args, env.now());
    const { ds, ctx } = await loadFor(env, w);
    const matching = negativeFeedbackSamples(ds, w.current, ctx.settings, Number.MAX_SAFE_INTEGER).filter(
      (s) => (!args.route || s.route === args.route) && (!args.release || s.release === args.release)
    );
    return {
      ...baseResult(env, w, ds),
      content_notice: UNTRUSTED_NOTICE,
      matching_total: matching.length,
      samples: matching.slice(0, args.limit).map((s) => {
        const { score: _s, value: _v, ...rest } = sampleView(s);
        return rest;
      }),
    };
  },
});

export const getTraceTool = defineAgentTool({
  name: 'get_trace',
  description: 'One trace: its question, answer (masked, truncated) and every score it received. Use on trace_ids returned by sample tools.',
  parameters: { type: 'object', properties: { trace_id: { type: 'string' } }, required: ['trace_id'] },
  args: z.object({ trace_id: z.string().min(1).max(200) }).strict(),
  run: async (args, env) => {
    const ctx = modelCtx(env);
    const trace = await ctx.source.getTrace(args.trace_id);
    if (!trace) return { found: false, trace_id: args.trace_id };
    const ds = await ctx.source.load(
      trace.timestamp.slice(0, 10),
      new Date(Date.parse(trace.timestamp.slice(0, 10)) + 86_400_000).toISOString().slice(0, 10)
    );
    const scores = ds.scores
      .filter((s) => s.traceId === trace.id)
      .map((s) => ({ name: s.name, value: s.value, untrusted_comment: sanitizeText(s.comment, 300) }));
    return {
      found: true,
      trace_id: trace.id,
      time: trace.timestamp,
      route: trace.name,
      release: trace.release,
      synthetic: trace.synthetic,
      content_notice: UNTRUSTED_NOTICE,
      untrusted: { question: sanitizeText(trace.input), answer: sanitizeText(trace.output) },
      scores,
    };
  },
});

export const MODEL_TOOLS: AgentTool[] = [
  scoreSummaryTool,
  lowScoreBreakdownTool,
  scoreTrendTool,
  feedbackSummaryTool,
  lowScoreSamplesTool,
  feedbackSamplesTool,
  getTraceTool,
];
