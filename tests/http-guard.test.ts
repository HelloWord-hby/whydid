import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkSemanticPath, readBundle, validateBundle } from '../src/admin/bundle.js';
import { Runtime } from '../src/admin/runtime.js';
import { SettingsStore } from '../src/admin/settings.js';
import { corsOriginFor, hostAllowed, isUnwantedCrossSite, tokenMatches } from '../src/http-guard.js';
import { startServer } from '../src/server.js';

describe('http guards', () => {
  it('accepts only localhost names on a loopback bind (DNS rebinding)', () => {
    expect(hostAllowed('localhost:8787', true)).toBe(true);
    expect(hostAllowed('127.0.0.1:8787', true)).toBe(true);
    expect(hostAllowed('[::1]:8787', true)).toBe(true);
    expect(hostAllowed('evil.example:8787', true)).toBe(false);
    expect(hostAllowed('localhost.evil.example', true)).toBe(false);
    expect(hostAllowed(undefined, true)).toBe(false);
    expect(hostAllowed('whydid.internal:8787', true, ['whydid.internal'])).toBe(true);
    expect(hostAllowed('anything:80', false)).toBe(true);
  });

  it('gives CORS only to listed origins', () => {
    expect(corsOriginFor('https://a.example', [])).toBeNull();
    expect(corsOriginFor('https://a.example', ['https://a.example'])).toBe('https://a.example');
    expect(corsOriginFor('https://b.example', ['https://a.example'])).toBeNull();
    expect(corsOriginFor('https://b.example', ['*'])).toBe('*');
  });

  it('refuses cross-site writes that CORS does not allow', () => {
    const req = (method: string, origin?: string) => ({ method, headers: { host: 'localhost:8787', ...(origin ? { origin } : {}) } });
    expect(isUnwantedCrossSite(req('POST', 'https://evil.example'), [])).toBe(true);
    expect(isUnwantedCrossSite(req('POST', 'http://localhost:8787'), [])).toBe(false);
    expect(isUnwantedCrossSite(req('POST'), [])).toBe(false);
    expect(isUnwantedCrossSite(req('GET', 'https://evil.example'), [])).toBe(false);
    expect(isUnwantedCrossSite(req('POST', 'https://a.example'), ['https://a.example'])).toBe(false);
  });

  it('compares the bearer token in constant time and exactly', () => {
    expect(tokenMatches('Bearer s3cret', 's3cret')).toBe(true);
    expect(tokenMatches('Bearer s3cre', 's3cret')).toBe(false);
    expect(tokenMatches(undefined, 's3cret')).toBe(false);
  });
});

const MAIN = 'table: t\ntime_column: ts\nmetrics:\n  n: { kind: additive, expr: "COUNT(*)" }\ndimensions: {}\n';
const BOARDS = 'sources:\n  model:\n    kind: model_output\nboards:\n  - id: m\n    title: M\n    source: model\ncards: []\n';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'whydid-guard-'));
  writeFileSync(join(dir, 'whydid.config.yaml'), MAIN);
  writeFileSync(join(dir, 'whydid.boards.yaml'), BOARDS);
  writeFileSync(join(dir, 'docker-compose.yml'), 'services: {}\n');
  return { dir, files: { boards: join(dir, 'whydid.boards.yaml'), main: join(dir, 'whydid.config.yaml') } };
}

describe('semantic layer paths', () => {
  const layer = { table: 'x', time_column: 'ts', metrics: { n: { kind: 'additive', expr: 'COUNT(*)' } }, dimensions: {} };
  const withSource = (files: ReturnType<typeof workspace>['files'], config: string) => {
    const b = readBundle(files);
    return { ...b, boards: { ...b.boards, sources: { ...(b.boards.sources as object), ev: { kind: 'semantic', config } } }, semantic: { ev: layer } };
  };

  it('never overwrites an existing file or a whydid config, in any letter case', () => {
    const { files } = workspace();
    expect(() => validateBundle(files, withSource(files, 'docker-compose.yml'))).toThrow(/already exists/);
    expect(() => validateBundle(files, withSource(files, 'WHYDID.CONFIG.yaml'))).toThrow(/whydid config file/);
    expect(validateBundle(files, withSource(files, 'semantic/ev.yaml')).paths.ev).toBe('semantic/ev.yaml');
  });

  it('refuses a symlinked directory that leads outside', () => {
    const { dir } = workspace();
    const outside = mkdtempSync(join(tmpdir(), 'whydid-outside-'));
    mkdirSync(join(outside, 'x'));
    symlinkSync(join(outside, 'x'), join(dir, 'link'));
    expect(() => checkSemanticPath(dir, 'link/ev.yaml')).toThrow(/outside/);
  });
});

describe('guarded server', () => {
  const PORT = 22_000 + Math.floor(Math.random() * 1000);
  const { dir, files } = workspace();
  const env = { DATABASE_URL: 'postgres://u:p@db.invalid:5432/x', WHYDID_LLM_API_KEY: 'sk-stored-key-abcdefghijklmnop' };
  const settings = new SettingsStore(join(dir, '.whydid/settings.json'), env);
  const rt = new Runtime({ files, settings, releasesPath: join(dir, 'releases.md') });
  let server: ReturnType<typeof startServer>;

  beforeAll(async () => {
    delete process.env.WHYDID_SERVE_TOKEN;
    server = startServer(rt.parts.main.config, rt.parts.main.db, {
      port: PORT,
      host: '127.0.0.1',
      main: () => rt.parts.main,
      boards: rt.parts.boards,
      agent: rt.agent,
      admin: { runtime: rt, settings, settingsPath: '.whydid/settings.json', writable: true },
      corsOrigins: [],
    });
    await new Promise<void>((r) => server.once('listening', () => r()));
  });
  afterAll(() => server.close());

  const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) => fetch(`http://127.0.0.1:${PORT}${path}`, init);

  it('rejects a rebinding Host even when Origin matches it', async () => {
    // fetch() rewrites Host, so send raw requests to control it.
    const raw = (path: string, headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: PORT, path, headers }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
    expect(await raw('/boards', { Host: `evil.example:${PORT}` })).toBe(403);
    expect(await raw('/boards', { Host: `localhost:${PORT}` })).toBe(200);
    expect(await raw('/admin/config', { Host: `evil.example:${PORT}`, Origin: `http://evil.example:${PORT}` })).toBe(403);
  });

  it('sends no CORS headers by default and refuses cross-site writes', async () => {
    const read = await call('/boards', { headers: { Origin: 'https://evil.example' } });
    expect(read.headers.get('access-control-allow-origin')).toBeNull();
    const ask = await call('/ask', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' }, body: '{"question":"x"}' });
    expect(ask.status).toBe(403);
  });

  it('never sends the stored key to a different endpoint', async () => {
    const r = await call('/admin/test/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_url: 'https://collector.invalid/v1' }) });
    const body = (await r.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/different endpoint/);
    const save = await call('/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ llm: { base_url: 'https://collector.invalid/v1' } }) });
    expect(save.status).toBe(400);
    expect(settings.llm().baseUrl).not.toContain('collector');
  });
});
