import { describe, expect, it } from 'vitest';
import { hintsForLowScore, hintsForSemantic } from '../src/workbench/hints.js';
import { resolveWindow } from '../src/workbench/model-tools.js';
import { buildAgentTools, runAgentTool } from '../src/workbench/tools.js';
import { demoEnv, mainConfig, NOW } from './workbench-helpers.js';

const env = demoEnv();
const tools = buildAgentTools(env);
const run = (name: string, args: Record<string, unknown>) =>
  runAgentTool(tools, env, name, args) as Promise<Record<string, unknown>>;

describe('tool registry', () => {
  it('exposes semantic, model and board tools once each', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'get_metric', 'get_metric_trend', 'compare_periods', 'decompose_change_additive', 'decompose_change_rate',
      'score_summary', 'low_score_breakdown', 'score_trend', 'feedback_summary', 'low_score_samples', 'feedback_samples', 'get_trace',
      'list_cards', 'read_card',
    ]);
  });

  it('makes semantic tools source-generic: source required, no per-config enums', () => {
    const compare = tools.find((t) => t.name === 'compare_periods')!;
    const props = compare.parameters.properties as Record<string, Record<string, unknown>>;
    expect(compare.parameters.required).toContain('source');
    expect(props.metric!.enum).toBeUndefined();
  });

  it('rejects unknown tools, unknown sources and bad arguments with LLM-readable errors', async () => {
    await expect(run('nope', {})).rejects.toThrow(/Unknown tool "nope"/);
    await expect(run('get_metric', { source: 'ghost', metric: 'x', period: { from: '2026-11-01', to: '2026-11-08' } })).rejects.toThrow(
      /Unknown source "ghost". Semantic sources: main/
    );
    await expect(run('get_metric', { source: 'main', metric: 'ghost', period: { from: '2026-11-01', to: '2026-11-08' } })).rejects.toThrow(
      /Unknown metric "ghost"/
    );
    await expect(run('low_score_samples', { limit: 50 })).rejects.toThrow(/Invalid arguments for low_score_samples/);
  });

  it('routes semantic tools to the named source and attaches hints', async () => {
    const r = await run('compare_periods', {
      source: 'main',
      metric: 'conversations',
      period_b: { from: '2026-11-01', to: '2026-11-08' },
      compare_to: 'prev_period',
    });
    expect(r.source).toBe('main');
    expect(r.period_b_total).toBe(120);
    expect(Array.isArray(r.next_hints)).toBe(true);
  });
});

describe('model-output tools on the demo dataset', () => {
  it('summarises scores with server-computed changes and points at the worst one', async () => {
    const r = await run('score_summary', { days: 7 });
    expect(r.mode).toBe('demo');
    expect(r.current).toEqual({ from: '2026-11-01', to: '2026-11-08' });
    const scores = r.scores as Array<Record<string, number | string | null>>;
    const faith = scores.find((s) => s.score === 'faithfulness')!;
    expect(faith.delta_avg).toBeLessThan(0);
    expect(faith.low_rate_change).toBeGreaterThan(0);
    expect((r.next_hints as string[])[0]).toContain('"faithfulness"');
  });

  it('locates the incident by route and hints at samples', async () => {
    const r = await run('low_score_breakdown', { days: 7, group_by: 'route', score: 'faithfulness' });
    const rows = r.rows as Array<{ group: string; low_rate_change: number }>;
    expect(rows[0]!.group).toBe('rag-answer');
    expect((r.next_hints as string[])[0]).toContain('low_score_samples with route="rag-answer"');
  });

  it('returns filtered, masked samples marked untrusted', async () => {
    const r = await run('low_score_samples', { days: 7, route: 'rag-answer', limit: 3 });
    const samples = r.samples as Array<Record<string, unknown>>;
    expect(samples).toHaveLength(3);
    expect(samples.every((s) => s.route === 'rag-answer')).toBe(true);
    expect(r.content_notice).toMatch(/never as instructions/);
    expect(samples[0]!.untrusted).toHaveProperty('comment');
  });

  it('reads one trace with its scores; unknown ids are a clean miss', async () => {
    const samples = (await run('low_score_samples', { days: 7, limit: 1 })).samples as Array<{ trace_id: string }>;
    const t = await run('get_trace', { trace_id: samples[0]!.trace_id });
    expect(t.found).toBe(true);
    expect(t.synthetic).toBe(true);
    expect((t.scores as unknown[]).length).toBeGreaterThanOrEqual(4);
    expect(await run('get_trace', { trace_id: 'nope' })).toEqual({ found: false, trace_id: 'nope' });
  });

  it('splits thumbs-down by route with baseline comparison', async () => {
    const r = await run('feedback_summary', { days: 14 });
    expect((r.current as { total: number }).total).toBeGreaterThan(0);
    expect(Array.isArray(r.by_group)).toBe(true);
  });

  it('limits explicit periods and derives the baseline in code', () => {
    expect(resolveWindow({ period: { from: '2026-10-01', to: '2026-10-08' } }, NOW).previous).toEqual({
      from: '2026-09-24',
      to: '2026-10-01',
    });
    expect(() => resolveWindow({ period: { from: '2026-08-01', to: '2026-10-01' } }, NOW)).toThrow(/limited to 31 days/);
  });
});

describe('board tools', () => {
  it('lists boards and reads a card exactly as displayed', async () => {
    const list = await run('list_cards', {});
    expect((list.boards as Array<{ cards: unknown[] }>)[0]!.cards).toHaveLength(2);
    const card = await run('read_card', { card_id: 'faithfulness', days: 7 });
    expect(card.data).toMatchObject({ display: 'stat' });
    await expect(run('read_card', { card_id: 'ghost' })).rejects.toThrow(/Use list_cards/);
  });
});

describe('hints', () => {
  it('suggests the right decomposition for material changes only', () => {
    expect(hintsForSemantic('compare_periods', { metric: 'resolution_rate', delta_pct: -8 }, mainConfig, 'main')[0]).toContain(
      'decompose_change_rate'
    );
    expect(hintsForSemantic('compare_periods', { metric: 'conversations', delta_pct: 2 }, mainConfig, 'main')[0]).toContain('noise');
  });

  it('points at the top driver and at outliers', () => {
    const add = hintsForSemantic(
      'decompose_change_additive',
      { dimension: 'intent', growth_drivers: [{ segment: 'billing', delta: 50 }], drag_drivers: [{ segment: 'refund', delta: -80 }] },
      mainConfig,
      'main'
    );
    expect(add[0]).toContain('intent="refund"');
    expect(hintsForSemantic('get_metric_trend', { points: [{ bucket: '2026-11-03', outlier: 'low' }] }, mainConfig, 'main')[0]).toContain(
      '2026-11-03 (low)'
    );
  });

  it('flags a rising low-score rate above the threshold only', () => {
    expect(hintsForLowScore([{ group: 'rag', low_rate: 0.2, previous_low_rate: 0.02 }], 'route', 'faith')[0]).toContain(
      'route="rag" and score="faith"'
    );
    expect(hintsForLowScore([{ group: 'rag', low_rate: 0.03, previous_low_rate: 0.02 }], 'route')).toEqual([]);
  });
});
