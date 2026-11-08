/**
 * Run the regression set and keep the results — shared by `npm run eval`
 * and the dashboard's Evals page, so both produce the same files.
 *
 * Results live in evals/results/<date>-<time>-<model>.{md,json}. The JSON
 * is what the dashboard lists; the Markdown is for reading and diffing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { type Workbench } from '../workbench/index.js';
import { type AgentEvent, type LlmLike } from '../workbench/session.js';
import { renderReport, type RunMeta } from './report.js';
import { casesFileSchema, outcomeFromEvents, scoreCase, summarize, type CaseScore, type EvalCase, type EvalSummary } from './score.js';

export const DEFAULT_CASES = 'evals/cases.yaml';
export const DEFAULT_RESULTS = 'evals/results';
const RUN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface SavedRun {
  name: string;
  meta: RunMeta;
  summary: EvalSummary;
  scores: CaseScore[];
}

export function loadCases(path = DEFAULT_CASES): EvalCase[] {
  return casesFileSchema.parse(parse(readFileSync(path, 'utf8'))).cases;
}

export async function runCases(opts: {
  cases: EvalCase[];
  workbench: Workbench;
  llm: LlmLike;
  onCase?: (score: CaseScore, index: number) => void;
  onStart?: (c: EvalCase, index: number) => void;
}): Promise<CaseScore[]> {
  const scores: CaseScore[] = [];
  for (const [i, c] of opts.cases.entries()) {
    opts.onStart?.(c, i);
    const session = opts.workbench.createSession();
    const events: AgentEvent[] = [];
    const t0 = Date.now();
    await session.send({ text: c.question, entry: c.entry, board: c.board, card: c.card, days: c.days }, opts.llm, (e) => events.push(e));
    const score = scoreCase(c, outcomeFromEvents(events, Date.now() - t0));
    scores.push(score);
    opts.onCase?.(score, i);
  }
  return scores;
}

export function runName(meta: RunMeta, at: Date): string {
  const time = at.toISOString().slice(11, 19).replace(/:/g, '');
  return `${meta.date}-${time}-${meta.model.replace(/[^A-Za-z0-9.-]+/g, '-').replace(/-+$/, '')}`;
}

export function saveRun(dir: string, name: string, meta: RunMeta, cases: EvalCase[], scores: CaseScore[]): SavedRun {
  const summary = summarize(scores);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), renderReport(meta, cases, scores, summary));
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ meta, summary, scores }, null, 2));
  return { name, meta, summary, scores };
}

export function readRun(dir: string, name: string): SavedRun | null {
  if (!RUN_NAME.test(name)) return null;
  const file = join(dir, `${name}.json`);
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, 'utf8')) as Omit<SavedRun, 'name'>;
  return { name, ...data };
}

/** Every saved run, newest first, without the per-case answers. */
export function listRuns(dir: string): Array<Omit<SavedRun, 'scores'>> {
  if (!existsSync(dir)) return [];
  const runs: Array<Omit<SavedRun, 'scores'>> = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const run = readRun(dir, f.slice(0, -5));
      if (run?.meta && run.summary) runs.push({ name: run.name, meta: run.meta, summary: run.summary });
    } catch {
      // A malformed result file is skipped rather than breaking the list.
    }
  }
  const key = (r: Omit<SavedRun, 'scores'>) => r.meta.startedAt ?? r.meta.date;
  return runs.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}
