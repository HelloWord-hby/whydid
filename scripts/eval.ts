/**
 * Run the regression set against the workbench agent.
 *
 *   npm run eval                       # uses WHYDID_LLM_* from .env
 *   npm run eval -- --only main_resolution_drop,exit_no_data
 *   npm run eval:mock                  # scripted mock LLM: checks the harness, not quality
 *
 * Needs the seeded demo database (docker compose up -d && npm run seed).
 * The workbench is assembled exactly as `whydid serve` does it: same
 * configs, tools, prompt layers and grounding check. Results go to
 * evals/results/<date>-<model>.md and .json.
 */
import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { LlmClient } from '../src/agent/llm.js';
import { createBoardService } from '../src/boards/service.js';
import { loadConfig } from '../src/config/load.js';
import { closeDb, getDb } from '../src/db/client.js';
import { renderReport } from '../src/evals/report.js';
import { casesFileSchema, outcomeFromEvents, scoreCase, summarize, type CaseScore } from '../src/evals/score.js';
import { buildWorkbenchEnv, Workbench } from '../src/workbench/index.js';
import { type AgentEvent } from '../src/workbench/session.js';

const args = process.argv.slice(2);
const mock = args.includes('--mock');
const onlyArg = args[args.indexOf('--only') + 1];
const only = args.includes('--only') && onlyArg ? new Set(onlyArg.split(',')) : null;
const MOCK_PORT = process.env.EVAL_MOCK_PORT ?? '4011';

function startMock(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'scripts/mock-llm.ts'], {
      env: { ...process.env, MOCK_LLM_PORT: MOCK_PORT, MOCK_LLM_DELAY_MS: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout?.on('data', (b: Buffer) => {
      if (b.toString().includes('Mock LLM on')) resolve(child);
    });
    child.on('exit', (code) => reject(new Error(`mock LLM exited (${code})`)));
  });
}

async function main(): Promise<void> {
  const { cases: allCases } = casesFileSchema.parse(parse(readFileSync('evals/cases.yaml', 'utf8')));
  const cases = only ? allCases.filter((c) => only.has(c.id)) : allCases;
  if (!cases.length) throw new Error('No cases selected.');

  let mockProc: ChildProcess | undefined;
  if (mock) {
    mockProc = await startMock();
    process.env.WHYDID_LLM_BASE_URL = `http://localhost:${MOCK_PORT}/v1`;
    process.env.WHYDID_LLM_API_KEY = 'mock';
    process.env.WHYDID_LLM_MODEL = 'mock-llm';
  }
  const llm = new LlmClient();

  const config = loadConfig('whydid.config.yaml');
  const db = getDb(config.timezone);
  const boards = createBoardService('whydid.boards.yaml', { db, env: process.env });
  const wb = new Workbench(buildWorkbenchEnv(boards, config, db));
  const modes = boards.catalog().boards.map((b) => `${b.id}=${b.mode}`).join(', ');

  const scores: CaseScore[] = [];
  try {
    for (const c of cases) {
      const session = wb.createSession();
      const events: AgentEvent[] = [];
      const t0 = Date.now();
      await session.send({ text: c.question, entry: c.entry, board: c.board, card: c.card, days: c.days }, llm, (e) => events.push(e));
      const score = scoreCase(c, outcomeFromEvents(events, Date.now() - t0));
      scores.push(score);
      process.stdout.write(`${score.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(28)} ${score.failures.join('; ')}\n`);
    }
  } finally {
    await closeDb();
    mockProc?.kill();
  }

  const summary = summarize(scores);
  const date = new Date().toISOString().slice(0, 10);
  const slug = llm.model.replace(/[^A-Za-z0-9.-]+/g, '-');
  const meta = { date, model: llm.model, promptVersion: wb.system.version, dataModes: modes, mock };
  mkdirSync('evals/results', { recursive: true });
  const base = `evals/results/${date}-${slug}`;
  writeFileSync(`${base}.md`, renderReport(meta, cases, scores, summary));
  writeFileSync(`${base}.json`, JSON.stringify({ meta, summary, scores }, null, 2));

  const grounded = summary.numbersChecked - summary.numbersUngrounded;
  process.stdout.write(
    `\n${summary.passed}/${summary.cases} cases passed · driver ${summary.driverFound.hit}/${summary.driverFound.of}` +
      ` · direction errors ${summary.directionErrors}/${summary.directionChecked}` +
      ` · honest exit ${summary.honestExit.hit}/${summary.honestExit.of}` +
      ` · numbers grounded ${grounded}/${summary.numbersChecked}\n` +
      `Report: ${base}.md${mock ? '  (mock LLM — harness check only)' : ''}\n`
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`Eval failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
