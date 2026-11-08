import { describe, expect, it } from 'vitest';
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
  type ModelSettings,
} from '../src/boards/model/aggregate.js';
import { generateDemoModelDataset } from '../src/boards/model/demo.js';

const settings: ModelSettings = {
  feedback_score: 'user_feedback',
  negative_feedback_value: 0,
  low_score_threshold: 0.5,
};

const ds: ModelDataset = {
  truncated: false,
  traces: [
    { id: 't1', timestamp: '2026-11-01T10:00:00Z', name: 'chat', release: 'v1', latency: 2, cost: 0.01 },
    { id: 't2', timestamp: '2026-11-01T11:00:00Z', name: 'rag', release: 'v2', latency: 4, cost: null },
    { id: 't3', timestamp: '2026-11-02T09:00:00Z', name: 'rag', release: 'v2', latency: null, cost: 0.03 },
    { id: 't0', timestamp: '2026-10-31T09:00:00Z', name: 'chat', release: 'v1', latency: 1, cost: 0.02 },
  ],
  scores: [
    { traceId: 't1', name: 'faith', value: 0.9, dataType: 'NUMERIC', timestamp: '2026-11-01T10:00:00Z', comment: null },
    { traceId: 't2', name: 'faith', value: 0.2, dataType: 'NUMERIC', timestamp: '2026-11-01T11:00:00Z', comment: 'bad' },
    { traceId: 't3', name: 'faith', value: 0.4, dataType: 'NUMERIC', timestamp: '2026-11-02T09:00:00Z', comment: null },
    { traceId: 't3', name: 'concise', value: 0.8, dataType: 'NUMERIC', timestamp: '2026-11-02T09:00:00Z', comment: null },
    // Boolean and categorical scores are not quality scores.
    { traceId: 't1', name: 'hallucinated', value: 1, dataType: 'BOOLEAN', timestamp: '2026-11-01T10:00:00Z', comment: null },
    { traceId: 't1', name: 'tone', value: null, dataType: 'CATEGORICAL', timestamp: '2026-11-01T10:00:00Z', comment: null },
    // Feedback.
    { traceId: 't1', name: 'user_feedback', value: 1, dataType: 'BOOLEAN', timestamp: '2026-11-01T10:00:00Z', comment: null },
    { traceId: 't2', name: 'user_feedback', value: 0, dataType: 'BOOLEAN', timestamp: '2026-11-01T11:00:00Z', comment: 'wrong' },
    { traceId: 't3', name: 'user_feedback', value: 0, dataType: 'BOOLEAN', timestamp: '2026-11-02T09:00:00Z', comment: null },
    // Outside the period.
    { traceId: 't0', name: 'faith', value: 0.1, dataType: 'NUMERIC', timestamp: '2026-10-31T09:00:00Z', comment: null },
  ],
};

const period = { from: '2026-11-01', to: '2026-11-03' };

describe('model-output aggregates', () => {
  it('counts traces in a half-open period and per day', () => {
    expect(traceCount(ds, period)).toBe(3);
    expect(dailyTraceCounts(ds, ['2026-11-01', '2026-11-02'])).toEqual([
      { t: '2026-11-01', v: 2 },
      { t: '2026-11-02', v: 1 },
    ]);
  });

  it('averages trace fields, ignoring nulls', () => {
    expect(traceFieldAverage(ds, period, 'latency')).toBe(3);
    expect(traceFieldAverage(ds, period, 'cost')).toBeCloseTo(0.02);
  });

  it('lists only numeric quality scores, excluding feedback', () => {
    expect(qualityScoreNames(ds, settings)).toEqual(['concise', 'faith']);
  });

  it('averages a score over the period and per day', () => {
    expect(scoreAverage(ds, 'faith', period)).toBeCloseTo(0.5);
    expect(scoreAverage(ds, 'missing', period)).toBeNull();
    const daily = dailyScoreAverages(ds, 'faith', ['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(daily[0]!.v).toBeCloseTo(0.55);
    expect(daily[1]!.v).toBeCloseTo(0.4);
    expect(daily[2]!.v).toBeNull();
  });

  it('computes low-score rates by score, route and release', () => {
    expect(lowScoreStats(ds, period, settings, 'score')).toEqual([
      { group: 'faith', n: 3, low: 2, low_rate: 2 / 3 },
      { group: 'concise', n: 1, low: 0, low_rate: 0 },
    ]);
    const byRoute = lowScoreStats(ds, period, settings, 'route');
    expect(byRoute[0]).toEqual({ group: 'rag', n: 3, low: 2, low_rate: 2 / 3 });
    const faithByRelease = lowScoreStats(ds, period, settings, 'release', 'faith');
    expect(faithByRelease).toEqual([
      { group: 'v2', n: 2, low: 2, low_rate: 1 },
      { group: 'v1', n: 1, low: 0, low_rate: 0 },
    ]);
  });

  it('returns low-score samples worst first, joined to the trace', () => {
    const samples = lowScoreSamples(ds, period, settings, 5);
    expect(samples.map((s) => s.value)).toEqual([0.2, 0.4]);
    expect(samples[0]).toMatchObject({ trace_id: 't2', route: 'rag', release: 'v2', comment: 'bad' });
  });

  it('counts thumbs-down feedback and lists it newest first', () => {
    expect(feedbackStats(ds, period, settings)).toEqual({ total: 3, negative: 2, negative_rate: 2 / 3 });
    expect(negativeFeedbackSamples(ds, period, settings, 10).map((s) => s.trace_id)).toEqual(['t3', 't2']);
    expect(feedbackStats(ds, { from: '2026-12-01', to: '2026-12-02' }, settings).negative_rate).toBeNull();
  });
});

describe('demo model dataset', () => {
  it('is deterministic for the same day', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const a = generateDemoModelDataset(now);
    const b = generateDemoModelDataset(now);
    expect(a.traces.length).toBe(b.traces.length);
    expect(a.scores.slice(0, 50)).toEqual(b.scores.slice(0, 50));
  });

  it('contains the injected faithfulness incident on rag-answer after v1.9', () => {
    const d = generateDemoModelDataset(new Date('2026-11-08T12:00:00Z'));
    const after = { from: '2026-11-04', to: '2026-11-08' };
    const before = { from: '2026-10-28', to: '2026-11-04' };
    const rag = (p: typeof after) =>
      lowScoreStats(d, p, settings, 'route', 'faithfulness').find((r) => r.group === 'rag-answer')!;
    expect(rag(after).low_rate!).toBeGreaterThan(rag(before).low_rate! * 3);
  });
});
