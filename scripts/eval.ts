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
 * evals/results/<date>-<time>-<model>.md and .json; the dashboard's
 * Evals page lists the same files.
 */
import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { LlmClient } from '../src/agent/llm.js';
import { Runtime } from '../src/admin/runtime.js';
import { SettingsStore } from '../src/admin/settings.js';
import { closePools } from '../src/db/pools.js';
import { DEFAULT_RESULTS, loadCases, runCases, runName, saveRun } from '../src/evals/run.js';

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
  const allCases = loadCases();
  const cases = only ? allCases.filter((c) => only.has(c.id)) : allCases;
  if (!cases.length) throw new Error('No cases selected.');

  let mockProc: ChildProcess | undefined;
  // Same assembly as `whydid serve`: configs, saved connection settings, release log.
  const rt = new Runtime({
    files: { boards: 'whydid.boards.yaml', main: 'whydid.config.yaml' },
    settings: new SettingsStore(),
    releasesPath: 'whydid.releases.md',
  });
  let llm: LlmClient;
  if (mock) {
    mockProc = await startMock();
    llm = new LlmClient({ baseUrl: `http://localhost:${MOCK_PORT}/v1`, apiKey: 'mock', model: 'mock-llm' });
  } else {
    llm = rt.llm();
  }
  const wb = rt.parts.workbench;

  const started = new Date();
  const meta = {
    date: started.toISOString().slice(0, 10),
    startedAt: started.toISOString(),
    model: llm.model,
    promptVersion: wb.system.version,
    dataModes: rt.parts.dataModes,
    mock,
  };
  let scores;
  try {
    scores = await runCases({
      cases,
      workbench: wb,
      llm,
      onCase: (score) => process.stdout.write(`${score.pass ? 'PASS' : 'FAIL'}  ${score.id.padEnd(28)} ${score.failures.join('; ')}\n`),
    });
  } finally {
    await closePools();
    mockProc?.kill();
  }

  const name = runName(meta, started);
  const { summary } = saveRun(DEFAULT_RESULTS, name, meta, cases, scores);
  const grounded = summary.numbersChecked - summary.numbersUngrounded;
  process.stdout.write(
    `\n${summary.passed}/${summary.cases} cases passed · driver ${summary.driverFound.hit}/${summary.driverFound.of}` +
      ` · direction errors ${summary.directionErrors}/${summary.directionChecked}` +
      ` · honest exit ${summary.honestExit.hit}/${summary.honestExit.of}` +
      ` · numbers grounded ${grounded}/${summary.numbersChecked}\n` +
      `Report: ${DEFAULT_RESULTS}/${name}.md${mock ? '  (mock LLM — harness check only)' : ''}\n`
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`Eval failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
