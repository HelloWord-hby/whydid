import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EvalService } from '../src/evals/service.js';
import { ReleaseStore } from '../src/releases/store.js';
import { startServer } from '../src/server.js';
import { buildWorkbenchEnv, Workbench } from '../src/workbench/index.js';
import { demoBoards, fakeDb, mainConfig, NOW, ScriptedLlm } from './workbench-helpers.js';

const PORT = 20_000 + Math.floor(Math.random() * 1000);
const base = `http://localhost:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'whydid-http-'));
const casesPath = join(dir, 'cases.yaml');
writeFileSync(
  casesPath,
  [
    'cases:',
    '  - id: faith',
    '    entry: card',
    '    card: faithfulness',
    '    question: Why did faithfulness drop?',
    '    find: [[rag-answer]]',
    '  - id: exit_case',
    '    question: Why did revenue change?',
    '    exit: true',
  ].join('\n')
);

const releases = new ReleaseStore(join(dir, 'releases.md'));
const workbench = new Workbench(buildWorkbenchEnv(demoBoards(), mainConfig, fakeDb, () => NOW, releases));
let configured = true;
const evals = new EvalService({
  workbench,
  llmFactory: () => Object.assign(new ScriptedLlm([{ content: 'Faithfulness fell on rag-answer.' }]), { model: 'scripted-mock' }),
  llmConfigured: () => configured,
  model: 'scripted-mock',
  dataModes: 'model_output=demo',
  casesPath,
  resultsDir: join(dir, 'results'),
});
let server: ReturnType<typeof startServer>;

beforeAll(async () => {
  delete process.env.WHYDID_SERVE_TOKEN;
  server = startServer(mainConfig, fakeDb, { port: PORT, host: 'localhost', boards: workbench.env.boards, releases, evals });
  await new Promise<void>((r) => server.once('listening', () => r()));
});

afterAll(() => {
  server.close();
});

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe('/releases', () => {
  it('starts empty, saves Markdown, and returns parsed entries', async () => {
    expect(await json(await fetch(base + '/releases'))).toMatchObject({ origin: 'none', entries: [] });
    const r = await fetch(base + '/releases', { method: 'PUT', body: JSON.stringify({ markdown: '## v2.1 — 2026-11-06\n- smaller chunks' }) });
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ origin: 'file', entries: [{ version: 'v2.1', date: '2026-11-06' }] });
  });

  it('rejects bodies that are not {markdown}', async () => {
    const r = await fetch(base + '/releases', { method: 'PUT', body: JSON.stringify({ text: 'x' }) });
    expect(r.status).toBe(400);
  });
});

describe('/evals', () => {
  it('lists cases and no runs, then runs the set in the background and saves the result', async () => {
    const before = await json(await fetch(base + '/evals'));
    expect((before.cases as unknown[]).length).toBe(2);
    expect(before.runs).toEqual([]);

    const started = await fetch(base + '/evals/runs', { method: 'POST', body: JSON.stringify({ only: ['faith'] }) });
    expect(started.status).toBe(202);

    let status: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      status = (await json(await fetch(base + '/evals'))).status as Record<string, unknown>;
      if (!status.running) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(status).toMatchObject({ running: false, done: 1, total: 1, error: null });

    const runs = (await json(await fetch(base + '/evals'))).runs as Array<{ name: string; meta: { mock: boolean }; summary: { passed: number } }>;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.meta.mock).toBe(true);
    expect(runs[0]!.summary.passed).toBe(1);

    const run = await json(await fetch(`${base}/evals/runs/${runs[0]!.name}`));
    expect((run.scores as Array<{ outcome: { answer: string } }>)[0]!.outcome.answer).toContain('rag-answer');
  });

  it('refuses unknown runs, path tricks, and runs without an LLM', async () => {
    expect((await fetch(base + '/evals/runs/nope')).status).toBe(404);
    expect((await fetch(base + '/evals/runs/..%2Fcases')).status).toBe(404);
    configured = false;
    expect((await fetch(base + '/evals/runs', { method: 'POST', body: '{}' })).status).toBe(503);
    configured = true;
  });
});
