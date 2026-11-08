/**
 * The regression set inside the server: list cases and past runs, and run
 * the set in the background with the server's own workbench and LLM.
 *
 * One run at a time. A run uses the same prompt version the dashboard's
 * agent uses, so its score describes the agent people are talking to.
 */
import { type Workbench } from '../workbench/index.js';
import { type LlmLike } from '../workbench/session.js';
import { type RunMeta } from './report.js';
import { DEFAULT_CASES, DEFAULT_RESULTS, listRuns, loadCases, readRun, runCases, runName, saveRun, type SavedRun } from './run.js';
import { type EvalCase } from './score.js';

export interface EvalStatus {
  running: boolean;
  done: number;
  total: number;
  current: string | null;
  started_at: string | null;
  last_run: string | null;
  error: string | null;
}

export interface EvalServiceOptions {
  workbench: Workbench;
  llmFactory: () => LlmLike;
  llmConfigured: () => boolean;
  model: string;
  dataModes: string;
  casesPath?: string;
  resultsDir?: string;
}

export class EvalService {
  private status: EvalStatus = { running: false, done: 0, total: 0, current: null, started_at: null, last_run: null, error: null };
  readonly casesPath: string;
  readonly resultsDir: string;

  constructor(private readonly opts: EvalServiceOptions) {
    this.casesPath = opts.casesPath ?? DEFAULT_CASES;
    this.resultsDir = opts.resultsDir ?? DEFAULT_RESULTS;
  }

  cases(): EvalCase[] {
    return loadCases(this.casesPath);
  }

  overview() {
    return {
      cases: this.cases(),
      runs: listRuns(this.resultsDir),
      status: this.status,
      llm_configured: this.opts.llmConfigured(),
      model: this.opts.model,
      prompt_version: this.opts.workbench.system.version,
    };
  }

  run(name: string): SavedRun | null {
    return readRun(this.resultsDir, name);
  }

  /** Start a run in the background. Throws when one is running or no LLM is configured. */
  start(only?: string[], now: Date = new Date()): EvalStatus {
    if (this.status.running) throw Object.assign(new Error('A run is already in progress.'), { status: 409 });
    if (!this.opts.llmConfigured()) throw Object.assign(new Error('No LLM is configured (WHYDID_LLM_API_KEY).'), { status: 503 });
    const all = this.cases();
    const cases = only?.length ? all.filter((c) => only.includes(c.id)) : all;
    if (!cases.length) throw Object.assign(new Error('No cases selected.'), { status: 400 });

    const llm = this.opts.llmFactory();
    const model = llm.model ?? this.opts.model;
    const meta: RunMeta = {
      date: now.toISOString().slice(0, 10),
      startedAt: now.toISOString(),
      model,
      promptVersion: this.opts.workbench.system.version,
      dataModes: this.opts.dataModes,
      mock: /mock/i.test(model),
    };
    this.status = { running: true, done: 0, total: cases.length, current: cases[0]!.id, started_at: meta.startedAt!, last_run: this.status.last_run, error: null };

    void runCases({
      cases,
      workbench: this.opts.workbench,
      llm,
      onStart: (c) => (this.status = { ...this.status, current: c.id }),
      onCase: (_s, i) => (this.status = { ...this.status, done: i + 1 }),
    })
      .then((scores) => {
        const saved = saveRun(this.resultsDir, runName(meta, now), meta, cases, scores);
        this.status = { ...this.status, running: false, current: null, last_run: saved.name };
      })
      .catch((err: unknown) => {
        this.status = { ...this.status, running: false, current: null, error: err instanceof Error ? err.message : String(err) };
      });
    return this.status;
  }
}
