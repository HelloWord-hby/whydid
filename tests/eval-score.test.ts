import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  casesFileSchema,
  caseSchema,
  checkDirection,
  conclusionOf,
  outcomeFromEvents,
  scoreCase,
  summarize,
  type TurnOutcome,
} from '../src/evals/score.js';

const outcome = (answer: string, extra: Partial<TurnOutcome> = {}): TurnOutcome => ({
  answer,
  partial: false,
  toolCalls: 4,
  toolErrors: 0,
  grounding: { checked: 3, ungrounded: [] },
  tokens: 1000,
  ms: 2000,
  ...extra,
});

describe('the shipped regression set', () => {
  it('parses, has unique ids and covers drivers, directions and honest exits', () => {
    const raw = parse(readFileSync(fileURLToPath(new URL('../evals/cases.yaml', import.meta.url)), 'utf8'));
    const { cases } = casesFileSchema.parse(raw);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.filter((c) => c.find.length).length).toBeGreaterThanOrEqual(6);
    expect(cases.filter((c) => c.direction).length).toBeGreaterThanOrEqual(6);
    expect(cases.filter((c) => c.exit).length).toBeGreaterThanOrEqual(2);
    expect(cases.some((c) => c.language === 'zh')).toBe(true);
  });
});

describe('direction check', () => {
  it('reads the conclusion section only', () => {
    const a = '**Conclusion** — Faithfulness fell 6.4% [#1].\n\n**Evidence**\n- it rose on chat';
    expect(conclusionOf(a)).not.toContain('rose');
    expect(checkDirection(a, ['faithfulness'], 'down')).toEqual({ ok: true });
  });

  it('flags a flipped sign and a missing direction', () => {
    expect(checkDirection('**Conclusion** — Faithfulness rose to 0.79.', ['faithfulness'], 'down').reason).toMatch(/opposite/);
    expect(checkDirection('**Conclusion** — Faithfulness is 0.79.', ['faithfulness'], 'down').reason).toMatch(/does not state/);
    expect(checkDirection('**Conclusion** — Latency fell.', ['faithfulness'], 'down').reason).toMatch(/does not mention/);
  });

  it('reads a "## 结论" heading and keeps decimals inside one sentence', () => {
    const a = '## 结论\n窗口为 UTC。[#1] resolution_rate 从 **76.71%**[#1] 降至 **72.31%**[#1]，下降 **4.40 个百分点**[#1]。\n\n## 证据\n- 账单组上升';
    expect(conclusionOf(a)).not.toContain('账单组');
    expect(checkDirection(a, ['resolution_rate', '解决率'], 'down')).toEqual({ ok: true });
  });

  it('allows the other direction as a cause in the same sentence', () => {
    expect(checkDirection('**Conclusion** — The thumbs-down rate rose because faithfulness fell on rag-answer.', ['thumbs-down'], 'up').ok).toBe(true);
  });

  it('matches ASCII words at word starts and Chinese anywhere', () => {
    expect(checkDirection('**结论**：忠实度下降了 6.4%。', ['忠实度'], 'down').ok).toBe(true);
    // "support" must not count as "up".
    expect(checkDirection('**Conclusion** — Sessions from support fell.', ['sessions'], 'down').ok).toBe(true);
  });
});

describe('scoreCase', () => {
  const c = caseSchema.parse({
    id: 'x',
    question: 'q',
    find: [['rag-answer'], ['v1.9', '1.9']],
    bonus: [['m-2']],
    direction: { subject: ['faithfulness'], expect: 'down' },
  });

  it('passes a complete, grounded answer that names the driver', () => {
    const s = scoreCase(c, outcome('**Conclusion** — Faithfulness dropped on rag-answer after v1.9 [#2].'));
    expect(s.pass).toBe(true);
    expect(s.bonus).toEqual({ found: 0, total: 1 });
  });

  it('reports each failed check with a reason', () => {
    const s = scoreCase(c, outcome('**Conclusion** — Faithfulness rose on chat.', { grounding: { checked: 2, ungrounded: ['42%'] }, toolCalls: 20 }));
    expect(s.pass).toBe(false);
    expect(s.checks).toMatchObject({ completed: true, driver: false, direction: false, grounded: false, budget: false });
    expect(s.failures.join(' ')).toContain('missing rag-answer, v1.9|1.9');
  });

  it('checks honest exits and answer language', () => {
    const exit = caseSchema.parse({ id: 'e', question: 'q', exit: true });
    expect(scoreCase(exit, outcome('There is no revenue metric, so this cannot be answered.')).pass).toBe(true);
    expect(scoreCase(exit, outcome('Revenue fell 12% because of billing.')).checks.honest_exit).toBe(false);
    // Real models use typographic apostrophes.
    expect(scoreCase(exit, outcome('I can’t determine why revenue dropped: the data has none.')).checks.honest_exit).toBe(true);
    const zh = caseSchema.parse({ id: 'z', question: '为什么？', language: 'zh' });
    expect(scoreCase(zh, outcome('The answer is in English only, which is wrong here.')).checks.language).toBe(false);
  });

  it('treats errors and partial answers as incomplete', () => {
    expect(scoreCase(c, outcome('', { error: 'LLM API error 401' })).checks.completed).toBe(false);
    expect(scoreCase(c, outcome('x', { partial: true })).checks.completed).toBe(false);
  });
});

describe('outcomeFromEvents and summarize', () => {
  it('folds an event stream and aggregates the run', () => {
    const o = outcomeFromEvents(
      [
        { type: 'tool_start', ref: 1, tool: 'a', args: {}, injected: true },
        { type: 'tool_end', ref: 1, tool: 'a', ms: 5, ok: true, result: '{}' },
        { type: 'tool_end', ref: 2, tool: 'b', ms: 5, ok: false, result: '{}' },
        { type: 'answer', text: 'done', partial: false },
        { type: 'done', usage: { prompt_tokens: 90, completion_tokens: 10 }, calls: 2, prompt_version: 'v', grounding: { checked: 2, ungrounded: ['9%'] } },
      ],
      1500
    );
    expect(o).toMatchObject({ answer: 'done', toolCalls: 2, toolErrors: 1, tokens: 100, ms: 1500 });

    const c = caseSchema.parse({ id: 'x', question: 'q', find: [['done']] });
    const sum = summarize([scoreCase(c, o), scoreCase(c, outcome('done'))]);
    expect(sum).toMatchObject({ cases: 2, passed: 1, driverFound: { hit: 2, of: 2 }, numbersChecked: 5, numbersUngrounded: 1 });
    expect(sum.avgToolCalls).toBe(3);
  });
});
