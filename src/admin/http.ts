/**
 * Admin routes — the configuration back office.
 *
 *   GET  /admin/config          files, the editable bundle, providers and their fields,
 *                               connection settings (masked), score names seen in the data
 *   PUT  /admin/config          {bundle}  validate, build, write the YAML files, hot-reload
 *   POST /admin/preview         {bundle, card, days?}  one card computed from an unsaved draft
 *   PUT  /admin/settings        {llm?, langfuse?, databases?}  save connection settings (patch)
 *   POST /admin/test/llm        {base_url?, api_key?, model?}  one tiny chat completion
 *   POST /admin/test/database   {source?, url?, table?}  connect, list tables, optionally columns
 *   POST /admin/test/langfuse   {host?, public_key?, secret_key?}  one traces request
 *
 * There is no login. Every admin route needs a server that is either bound
 * to a loopback address or protected by WHYDID_SERVE_TOKEN, and the server
 * accepts them from its own origin only (src/http-guard.ts). A stored key is
 * only sent to the endpoint it was stored for: testing or saving a different
 * base URL or Langfuse host needs its key in the same request.
 */
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { providerCatalog } from '../boards/providers/fields.js';
import { parseDays } from '../boards/window.js';
import { inspectDatabase } from '../db/pools.js';
import { readJsonBody, sendJson } from '../http-util.js';
import { boardsBaseDir, readBundle } from './bundle.js';
import { type Runtime } from './runtime.js';
import { maskDatabaseUrl, settingsPatchSchema, type SettingsStore } from './settings.js';

export interface AdminOptions {
  runtime: Runtime;
  settings: SettingsStore;
  settingsPath: string;
  /** False when the server is reachable beyond localhost without a token. */
  writable: boolean;
}

const MAX_ADMIN_BODY = 1024 * 1024;
const TEST_TIMEOUT_MS = 20_000;

const bundleSchema = z.object({
  boards: z.record(z.string(), z.unknown()),
  semantic: z.record(z.string(), z.unknown()),
  main: z.record(z.string(), z.unknown()),
});
const saveBody = z.object({ bundle: bundleSchema }).strict();
const previewBody = z.object({ bundle: bundleSchema, card: z.string().min(1).max(100), days: z.number().optional() }).strict();
const llmTestBody = z.object({ base_url: z.string().url().optional(), api_key: z.string().min(1).optional(), model: z.string().min(1).optional() }).strict();
const dbTestBody = z.object({ source: z.string().max(100).optional(), url: z.string().optional(), table: z.string().max(200).optional() }).strict();
const langfuseTestBody = z.object({ host: z.string().url().optional(), public_key: z.string().min(1).optional(), secret_key: z.string().min(1).optional() }).strict();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const trimSlash = (u: string) => u.replace(/\/+$/, '');
const NEW_ENDPOINT_NEEDS_KEY =
  'This is a different endpoint from the saved one: enter its key. A saved key is only sent to the endpoint it was saved for.';

async function body<T>(req: IncomingMessage, res: ServerResponse, schema: z.ZodType<T>): Promise<T | null> {
  let raw: Record<string, unknown>;
  try {
    raw = await readJsonBody(req, MAX_ADMIN_BODY);
  } catch (err) {
    sendJson(res, 400, { error: message(err) });
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    sendJson(res, 400, { error: parsed.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; ') });
    return null;
  }
  return parsed.data;
}

async function overview(opts: AdminOptions) {
  const { runtime, settings } = opts;
  const files = runtime.opts.files;
  const bundle = readBundle(files);
  let scores: string[] = [];
  let scoresError: string | null = null;
  try {
    scores = await runtime.modelScoreNames();
  } catch (err) {
    scoresError = message(err);
  }
  const sources = (bundle.boards.sources ?? {}) as Record<string, { kind?: string; config?: string }>;
  return {
    writable: opts.writable,
    files: { boards: files.boards, main: files.main, settings: opts.settingsPath, base_dir: boardsBaseDir(files) },
    bundle,
    semantic_paths: Object.fromEntries(Object.entries(sources).filter(([, s]) => s.kind === 'semantic').map(([id, s]) => [id, s.config ?? null])),
    providers: providerCatalog(),
    settings: settings.publicView(),
    model_scores: scores,
    model_scores_error: scoresError,
    prompt_version: runtime.parts.workbench.system.version,
  };
}

async function testLlm(opts: AdminOptions, b: z.infer<typeof llmTestBody>) {
  const saved = opts.settings.llm();
  const base = trimSlash(b.base_url ?? saved.baseUrl);
  // A stored key is only ever sent to the endpoint it was stored for.
  const moved = base !== trimSlash(saved.baseUrl);
  const key = b.api_key ?? (moved ? undefined : saved.apiKey);
  const model = b.model ?? saved.model;
  if (!key) return { ok: false, error: moved ? NEW_ENDPOINT_NEEDS_KEY : 'No API key: enter one or save it first.' };
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 8, temperature: 0 }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      redirect: 'error',
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, status: r.status, error: text.slice(0, 300) };
    const data = JSON.parse(text) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
    return { ok: true, model: data.model ?? model, latency_ms: Date.now() - t0, reply: (data.choices?.[0]?.message?.content ?? '').slice(0, 100) };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

async function testDatabase(opts: AdminOptions, b: z.infer<typeof dbTestBody>) {
  const url = b.url ?? opts.settings.databaseUrl(b.source ?? 'main');
  if (!url) return { ok: false, error: 'No database URL: set DATABASE_URL or enter one.' };
  if (!/^postgres(ql)?:\/\//.test(url)) return { ok: false, error: 'Expected a postgres:// URL.' };
  try {
    return { ok: true, url: maskDatabaseUrl(url), ...(await inspectDatabase(url, b.table)) };
  } catch (err) {
    return { ok: false, url: maskDatabaseUrl(url), error: message(err) };
  }
}

async function testLangfuse(opts: AdminOptions, b: z.infer<typeof langfuseTestBody>) {
  const env = opts.settings.langfuseEnv();
  const host = trimSlash(b.host ?? env.LANGFUSE_HOST ?? '');
  const moved = host !== trimSlash(env.LANGFUSE_HOST ?? '');
  const pk = b.public_key ?? (moved ? undefined : env.LANGFUSE_PUBLIC_KEY);
  const sk = b.secret_key ?? (moved ? undefined : env.LANGFUSE_SECRET_KEY);
  if (moved && (!pk || !sk)) return { ok: false, error: NEW_ENDPOINT_NEEDS_KEY };
  if (!host || !pk || !sk) return { ok: false, error: 'Host, public key and secret key are all needed.' };
  try {
    const r = await fetch(`${host}/api/public/traces?limit=1`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${pk}:${sk}`).toString('base64') },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 300) };
    const data = (await r.json()) as { meta?: { totalItems?: number } };
    return { ok: true, traces: data.meta?.totalItems ?? null };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function handleAdminRoute(req: IncomingMessage, res: ServerResponse, path: string, opts: AdminOptions): Promise<void> {
  if (!opts.writable) {
    sendJson(res, 403, { error: 'The settings page is disabled: the server is reachable beyond localhost without WHYDID_SERVE_TOKEN.' });
    return;
  }
  if (req.method === 'GET' && path === '/admin/config') {
    sendJson(res, 200, await overview(opts));
    return;
  }

  if (req.method === 'PUT' && path === '/admin/config') {
    const b = await body(req, res, saveBody);
    if (!b) return;
    try {
      opts.runtime.save(b.bundle);
      sendJson(res, 200, { ok: true, prompt_version: opts.runtime.parts.workbench.system.version });
    } catch (err) {
      sendJson(res, 400, { error: message(err) });
    }
    return;
  }

  if (req.method === 'POST' && path === '/admin/preview') {
    const b = await body(req, res, previewBody);
    if (!b) return;
    try {
      const draft = opts.runtime.tryDraft(b.bundle);
      if (!draft.boards.hasCard(b.card)) throw new Error(`Card "${b.card}" is not in the draft.`);
      sendJson(res, 200, await draft.boards.cardData(b.card, parseDays(b.days == null ? null : String(b.days))));
    } catch (err) {
      sendJson(res, 400, { error: message(err) });
    }
    return;
  }

  if (req.method === 'PUT' && path === '/admin/settings') {
    const b = await body(req, res, settingsPatchSchema);
    if (!b) return;
    try {
      opts.settings.update(b);
      // Langfuse keys and database URLs are bound when the services are built.
      if (b.langfuse || b.databases) opts.runtime.reload();
      sendJson(res, 200, { ok: true, settings: opts.settings.publicView() });
    } catch (err) {
      sendJson(res, 400, { error: message(err) });
    }
    return;
  }

  const tests: Record<string, () => Promise<void>> = {
    '/admin/test/llm': async () => {
      const b = await body(req, res, llmTestBody);
      if (b) sendJson(res, 200, await testLlm(opts, b));
    },
    '/admin/test/database': async () => {
      const b = await body(req, res, dbTestBody);
      if (b) sendJson(res, 200, await testDatabase(opts, b));
    },
    '/admin/test/langfuse': async () => {
      const b = await body(req, res, langfuseTestBody);
      if (b) sendJson(res, 200, await testLangfuse(opts, b));
    },
  };
  if (req.method === 'POST' && Object.hasOwn(tests, path)) {
    await tests[path]!();
    return;
  }
  sendJson(res, 404, { error: 'Unknown admin route.' });
}
