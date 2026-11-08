import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';
import { Workbench } from '../src/workbench/index.js';
import { type LlmLike } from '../src/workbench/session.js';
import { demoEnv, fakeDb, mainConfig, ScriptedLlm } from './workbench-helpers.js';

const PORT = 19_000 + Math.floor(Math.random() * 1000);
const base = `http://localhost:${PORT}`;
const env = demoEnv();
let llmFactory: () => LlmLike = () => new ScriptedLlm([{ calls: [{ name: 'score_summary', args: {} }] }, { content: 'Done [#2].' }]);
let server: ReturnType<typeof startServer>;

beforeAll(async () => {
  delete process.env.WHYDID_SERVE_TOKEN;
  server = startServer(mainConfig, fakeDb, {
    port: PORT,
    host: 'localhost',
    boards: env.boards,
    agent: { workbench: new Workbench(env), llmFactory: () => llmFactory(), llmConfigured: () => true, model: 'scripted' },
  });
  await new Promise<void>((r) => server.once('listening', () => r()));
});

afterAll(() => {
  server.close();
});

async function newSession(): Promise<string> {
  const r = await fetch(base + '/agent/sessions', { method: 'POST' });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

function post(id: string, body: unknown): Promise<Response> {
  return fetch(`${base}/agent/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify(body) });
}

describe('agent routes', () => {
  it('reports status without exposing secrets', async () => {
    const s = (await (await fetch(base + '/agent/status')).json()) as Record<string, unknown>;
    expect(s).toMatchObject({ llm_configured: true, model: 'scripted' });
    expect(s.prompt_version).toMatch(/^[0-9a-f]{12}$/);
    expect(s.tools).toContain('read_card');
  });

  it('streams a turn as server-sent events and restores it afterwards', async () => {
    const id = await newSession();
    const r = await post(id, { text: 'why?', entry: 'card', card: 'faithfulness', days: 7 });
    expect(r.headers.get('content-type')).toMatch(/text\/event-stream/);
    const text = await r.text();
    const types = [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
    expect(types[0]).toBe('turn_start');
    expect(types.slice(-2)).toEqual(['answer', 'done']);
    expect(text).toContain('"tool":"read_card"');

    const restored = (await (await fetch(`${base}/agent/sessions/${id}`)).json()) as {
      transcript: Array<{ role: string }>;
      calls: Array<{ ref: number; tool: string; result?: unknown }>;
    };
    expect(restored.transcript.map((t) => t.role)).toEqual(['user', 'agent']);
    expect(restored.calls.map((c) => [c.ref, c.tool])).toEqual([[1, 'read_card'], [2, 'score_summary']]);
    expect(restored.calls[0]!.result).toBeUndefined();
  });

  it('validates the message before streaming', async () => {
    const id = await newSession();
    expect((await post(id, { text: '' })).status).toBe(400);
    expect((await post(id, { text: 'q', entry: 'card', card: 'ghost' })).status).toBe(400);
    expect((await post(id, { text: 'q', board: 'ghost' })).status).toBe(400);
    expect((await post(id, { text: 'q', extra: 1 })).status).toBe(400);
    expect((await post('00000000-0000-0000-0000-000000000000', { text: 'q' })).status).toBe(404);
  });

  it('returns 503 when no LLM can be created', async () => {
    const id = await newSession();
    llmFactory = () => {
      throw new Error('WHYDID_LLM_API_KEY is required.');
    };
    const r = await post(id, { text: 'q' });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toMatch(/WHYDID_LLM_API_KEY/);
  });
});
