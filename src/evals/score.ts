/**
 * Regression scoring — pure functions over one agent turn.
 *
 * Deterministic checks only: term matching for the expected driver, a
 * sentence-scoped direction check in the conclusion, exit markers, the
 * server's grounding report, language and budget. Heuristics are stated
 * where they are heuristics; none of this asks an LLM to grade an LLM.
 */
import { z } from 'zod';
import { type AgentEvent } from '../workbench/session.js';

const terms = z.array(z.string().min(1)).min(1);

export const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    note: z.string().optional(),
    entry: z.enum(['chat', 'card', 'board']).default('chat'),
    board: z.string().optional(),
    card: z.string().optional(),
    days: z.union([z.literal(7), z.literal(14), z.literal(30)]).default(7),
    question: z.string().min(1),
    find: z.array(terms).default([]),
    bonus: z.array(terms).default([]),
    direction: z.object({ subject: terms, expect: z.enum(['up', 'down']) }).optional(),
    exit: z.boolean().default(false),
    language: z.enum(['en', 'zh']).optional(),
    max_tool_calls: z.number().int().positive().default(15),
  })
  .strict();

export const casesFileSchema = z.object({ cases: z.array(caseSchema).min(1) });
export type EvalCase = z.infer<typeof caseSchema>;

const DOWN = ['drop', 'dropped', 'drops', 'fell', 'fall', 'falls', 'declin', 'decreas', 'lower', 'worse', 'worsen', 'down', 'reduc', 'shrank', 'shrink',
  '下降', '下滑', '降低', '减少', '变差', '走低', '回落'];
const UP = ['rose', 'rise', 'rises', 'increas', 'grew', 'grow', 'growth', 'higher', 'jump', 'spike', 'climb', 'up', 'gain',
  '上升', '增长', '提高', '增加', '上涨', '升高', '攀升'];
const EXIT = ['cannot', "can't", 'can not', 'unable', 'not available', 'no data', 'no such', 'does not exist', "doesn't exist", 'not defined',
  'not in the', 'no metric', 'insufficient', 'not enough data', 'outside the', 'before the data', 'no records', 'zero in both',
  '无法', '没有数据', '不存在', '没有该指标', '没有这个指标', '数据不足', '不在数据', '没有记录', '无数据'];

function hasTerm(text: string, term: string): boolean {
  const t = term.toLowerCase();
  // ASCII words match at a word start, so "up" does not match "support"; CJK matches anywhere.
  if (/^[a-z0-9 '-]+$/.test(t)) return new RegExp(`(^|[^a-z0-9])${t.replace(/[-]/g, '\\-')}`, 'i').test(text);
  return text.toLowerCase().includes(t);
}

const anyTerm = (text: string, list: string[]) => list.some((t) => hasTerm(text, t));

/** The conclusion: the "Conclusion"/"结论" section, else the first paragraph. */
export function conclusionOf(answer: string): string {
  const m = /\*\*(conclusion|结论)\*\*[\s\S]*?(?=\n\s*\*\*[^*\n]+\*\*|$)/i.exec(answer);
  if (m) return m[0];
  return answer.split(/\n\s*\n/)[0] ?? answer;
}

export function sentencesAbout(text: string, subject: string[]): string[] {
  return text
    .split(/(?<=[.!?。！？；;])\s*|\n+/)
    .filter((s) => anyTerm(s, subject));
}

export interface DirectionResult {
  ok: boolean;
  reason?: string;
}

export function checkDirection(answer: string, subject: string[], expect: 'up' | 'down'): DirectionResult {
  const sentences = sentencesAbout(conclusionOf(answer), subject);
  if (!sentences.length) return { ok: false, reason: 'conclusion does not mention the subject' };
  const want = expect === 'up' ? UP : DOWN;
  const opposite = expect === 'up' ? DOWN : UP;
  const stated = sentences.some((s) => anyTerm(s, want));
  // A sentence that states the expected direction may mention the other one
  // as a cause ("thumbs-down rose because faithfulness fell"); only a
  // sentence about the subject that states the opposite *alone* is a flip.
  const flipped = sentences.some((s) => anyTerm(s, opposite) && !anyTerm(s, want));
  if (flipped) return { ok: false, reason: 'conclusion states the opposite direction' };
  if (!stated) return { ok: false, reason: 'conclusion does not state a direction' };
  return { ok: true };
}

export interface TurnOutcome {
  answer: string;
  partial: boolean;
  error?: string;
  toolCalls: number;
  toolErrors: number;
  grounding: { checked: number; ungrounded: string[] };
  tokens: number;
  ms: number;
}

/** Fold a turn's event stream into the outcome the scorer needs. */
export function outcomeFromEvents(events: AgentEvent[], ms: number): TurnOutcome {
  const out: TurnOutcome = { answer: '', partial: false, toolCalls: 0, toolErrors: 0, grounding: { checked: 0, ungrounded: [] }, tokens: 0, ms };
  for (const e of events) {
    if (e.type === 'tool_end') {
      out.toolCalls += 1;
      if (!e.ok) out.toolErrors += 1;
    } else if (e.type === 'answer') {
      out.answer = e.text;
      out.partial = e.partial;
    } else if (e.type === 'done') {
      out.grounding = e.grounding;
      out.tokens = e.usage.prompt_tokens + e.usage.completion_tokens;
    } else if (e.type === 'error') {
      out.error = e.message;
    }
  }
  return out;
}

export interface CaseScore {
  id: string;
  pass: boolean;
  checks: Record<string, boolean>;
  bonus: { found: number; total: number };
  failures: string[];
  outcome: TurnOutcome;
}

const CJK = /[一-鿿]/g;

export function scoreCase(c: EvalCase, o: TurnOutcome): CaseScore {
  const checks: Record<string, boolean> = {};
  const failures: string[] = [];
  const check = (name: string, ok: boolean, why: string) => {
    checks[name] = ok;
    if (!ok) failures.push(`${name}: ${why}`);
  };

  check('completed', !o.error && !o.partial && o.answer.trim().length > 0, o.error ?? (o.partial ? 'hit the turn limit' : 'empty answer'));
  if (c.find.length) {
    const missing = c.find.filter((group) => !anyTerm(o.answer, group));
    check('driver', missing.length === 0, `missing ${missing.map((g) => g.join('|')).join(', ')}`);
  }
  if (c.direction) {
    const d = checkDirection(o.answer, c.direction.subject, c.direction.expect);
    check('direction', d.ok, d.reason ?? '');
  }
  if (c.exit) check('honest_exit', anyTerm(o.answer, EXIT), 'no statement that the data cannot answer');
  check('grounded', o.grounding.ungrounded.length === 0, `numbers not in tool results: ${o.grounding.ungrounded.join(', ')}`);
  if (c.language === 'zh') {
    const cjk = (o.answer.match(CJK) ?? []).length;
    check('language', cjk >= 20, 'answer is not in Chinese');
  }
  check('budget', o.toolCalls <= c.max_tool_calls, `${o.toolCalls} tool calls > ${c.max_tool_calls}`);

  const bonusFound = c.bonus.filter((group) => anyTerm(o.answer, group)).length;
  return {
    id: c.id,
    pass: Object.values(checks).every(Boolean),
    checks,
    bonus: { found: bonusFound, total: c.bonus.length },
    failures,
    outcome: o,
  };
}

export interface EvalSummary {
  cases: number;
  passed: number;
  driverFound: { hit: number; of: number };
  directionErrors: number;
  directionChecked: number;
  honestExit: { hit: number; of: number };
  numbersChecked: number;
  numbersUngrounded: number;
  avgToolCalls: number;
  avgTokens: number;
  avgSeconds: number;
}

export function summarize(scores: CaseScore[]): EvalSummary {
  const n = scores.length || 1;
  const count = (key: string, val: boolean) => scores.filter((s) => s.checks[key] === val).length;
  const has = (key: string) => scores.filter((s) => key in s.checks).length;
  return {
    cases: scores.length,
    passed: scores.filter((s) => s.pass).length,
    driverFound: { hit: count('driver', true), of: has('driver') },
    directionErrors: count('direction', false),
    directionChecked: has('direction'),
    honestExit: { hit: count('honest_exit', true), of: has('honest_exit') },
    numbersChecked: scores.reduce((s, x) => s + x.outcome.grounding.checked, 0),
    numbersUngrounded: scores.reduce((s, x) => s + x.outcome.grounding.ungrounded.length, 0),
    avgToolCalls: scores.reduce((s, x) => s + x.outcome.toolCalls, 0) / n,
    avgTokens: scores.reduce((s, x) => s + x.outcome.tokens, 0) / n,
    avgSeconds: scores.reduce((s, x) => s + x.outcome.ms, 0) / n / 1000,
  };
}
