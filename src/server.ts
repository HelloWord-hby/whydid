/**
 * whydid serve — the agent as an HTTP service, so dashboards and
 * observability platforms can embed it.
 *
 *   GET  /         the dashboard (ui/dist, built by npm run build:ui)
 *   GET  /healthz  liveness + semantic-layer summary
 *   POST /tool     {name, args}   deterministic tool call, no LLM involved.
 *                                 For dashboard panels that need numbers.
 *   POST /ask      {question, board?}  full attribution investigation (uses
 *                                 the LLM; returns report + tool-call log).
 *                                 With `board`, runs against that board's
 *                                 semantic config.
 *   GET  /boards   board + card catalog from whydid.boards.yaml
 *   GET  /cards/:id?days=7|14|30  one card's data, computed server-side
 *   /agent/...     workbench agent: sessions and SSE turns (src/workbench/http.ts)
 *   GET|PUT /releases   the team's release log (src/releases/http.ts)
 *   /evals/...     regression set: cases, past runs, start a run (src/evals/http.ts)
 *   /admin/...     configuration back office (src/admin/http.ts)
 *
 * Guards (src/http-guard.ts): Host allowlist against DNS rebinding, CORS off
 * unless WHYDID_CORS_ORIGIN lists origins, cross-site POST/PUT refused, and
 * configuration routes same-origin only.
 *
 * Defaults to binding 127.0.0.1. If you expose it beyond localhost, set
 * WHYDID_SERVE_TOKEN and put it behind TLS — /ask spends LLM tokens.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type Sql } from 'postgres';
import { type WhydidConfig } from './config/schema.js';
import { executeTool, listToolNames } from './tools/index.js';
import { runAgent } from './agent/orchestrator.js';
import { type BoardService } from './boards/service.js';
import { parseDays } from './boards/window.js';
import { readJsonBody, sendJson } from './http-util.js';
import { handleAgentRoute, type AgentRouteOptions } from './workbench/http.js';
import { serveUi } from './static-ui.js';
import { handleReleasesRoute } from './releases/http.js';
import { type ReleaseStore } from './releases/store.js';
import { handleEvalsRoute } from './evals/http.js';
import { type EvalService } from './evals/service.js';
import { handleAdminRoute, type AdminOptions } from './admin/http.js';
import { corsOriginFor, hostAllowed, isLoopbackBind, isSameOrigin, isUnwantedCrossSite, parseList, tokenMatches } from './http-guard.js';

export interface ServeOptions {
  port: number;
  host: string;
  /** Dashboard boards; when absent, /boards and /cards return 404. */
  boards?: BoardService;
  /** Workbench agent; when absent, /agent routes return 404. */
  agent?: AgentRouteOptions;
  /** Release log file; when absent, /releases returns 404. */
  releases?: ReleaseStore;
  /** Regression set runner; when absent, /evals returns 404. */
  evals?: EvalService;
  /** Configuration back office; when absent, /admin returns 404. */
  admin?: AdminOptions;
  /** Current main semantic config and its database, when it can change at run time. */
  main?: () => { config: WhydidConfig; db: Sql };
  /** Extra Host header values to accept (default: localhost names on a loopback bind). */
  allowedHosts?: string[];
  /** Origins allowed to call the API cross-origin; empty means no CORS. */
  corsOrigins?: string[];
}

/** Routes that change server state or spend tokens on the server's own behalf. */
function isProtectedWrite(method: string | undefined, path: string): boolean {
  if (path.startsWith('/admin/')) return true;
  return method !== 'GET' && (path === '/releases' || path.startsWith('/evals'));
}

export function startServer(
  config: WhydidConfig,
  db: Sql,
  opts: ServeOptions
): ReturnType<typeof createServer> {
  const token = process.env.WHYDID_SERVE_TOKEN;
  const loopback = isLoopbackBind(opts.host);
  const allowedHosts = opts.allowedHosts ?? parseList(process.env.WHYDID_ALLOWED_HOSTS);
  const corsOrigins = opts.corsOrigins ?? parseList(process.env.WHYDID_CORS_ORIGIN);

  const server = createServer((req, res) => {
    void route(req, res).catch((err: unknown) => {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (!hostAllowed(req.headers.host, loopback, allowedHosts)) {
      sendJson(res, 403, { error: 'Unexpected Host header. Set WHYDID_ALLOWED_HOSTS to serve under another name.' });
      return;
    }
    const guarded = isProtectedWrite(req.method === 'OPTIONS' ? 'POST' : req.method, path);

    // CORS only for origins listed in WHYDID_CORS_ORIGIN, never for configuration routes.
    const allowOrigin = guarded ? null : corsOriginFor(req.headers.origin, corsOrigins);
    if (allowOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowOrigin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (guarded ? !isSameOrigin(req) : isUnwantedCrossSite(req, corsOrigins)) {
      sendJson(res, 403, { error: 'Cross-origin request refused.' });
      return;
    }
    const { config: mainConfig, db: mainDb } = opts.main?.() ?? { config, db };
    if (await serveUi(req, res, path)) return;

    if (req.method === 'GET' && path === '/healthz') {
      sendJson(res, 200, {
        ok: true,
        table: mainConfig.table,
        metrics: Object.entries(mainConfig.metrics).map(([name, m]) => ({
          name,
          kind: m.kind,
          label: m.label ?? name,
          unit: m.unit ?? null,
          decompose: m.decompose,
        })),
        dimensions: Object.entries(mainConfig.dimensions).map(([name, d]) => ({
          name,
          label: d.label ?? name,
        })),
        tools: listToolNames(),
      });
      return;
    }

    if (token && !tokenMatches(req.headers.authorization, token)) {
      sendJson(res, 401, { error: 'Missing or invalid bearer token.' });
      return;
    }

    if (req.method === 'GET' && path === '/boards') {
      if (!opts.boards) {
        sendJson(res, 404, { error: 'No boards configured (whydid.boards.yaml not loaded).' });
        return;
      }
      sendJson(res, 200, opts.boards.catalog());
      return;
    }

    const cardMatch = req.method === 'GET' ? /^\/cards\/([a-z][a-z0-9_]*)$/.exec(path) : null;
    if (cardMatch) {
      const cardId = cardMatch[1]!;
      if (!opts.boards || !opts.boards.hasCard(cardId)) {
        sendJson(res, 404, { error: `Unknown card "${cardId}".` });
        return;
      }
      let days: number;
      try {
        days = parseDays(url.searchParams.get('days'));
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        return;
      }
      sendJson(res, 200, await opts.boards.cardData(cardId, days));
      return;
    }

    if (path.startsWith('/admin/')) {
      if (!opts.admin) {
        sendJson(res, 404, { error: 'The admin page is not enabled on this server.' });
        return;
      }
      await handleAdminRoute(req, res, path, opts.admin);
      return;
    }

    if (path.startsWith('/agent/')) {
      if (!opts.agent) {
        sendJson(res, 404, { error: 'The workbench agent is not enabled on this server.' });
        return;
      }
      await handleAgentRoute(req, res, path, opts.agent);
      return;
    }

    if (path === '/releases') {
      if (!opts.releases) {
        sendJson(res, 404, { error: 'No release log is configured on this server.' });
        return;
      }
      await handleReleasesRoute(req, res, opts.releases);
      return;
    }

    if (path === '/evals' || path.startsWith('/evals/')) {
      if (!opts.evals) {
        sendJson(res, 404, { error: 'The regression set is not enabled on this server.' });
        return;
      }
      await handleEvalsRoute(req, res, path, opts.evals);
      return;
    }

    if (req.method === 'POST' && path === '/tool') {
      const body = await readJsonBody(req);
      const name = body.name;
      const args = body.args ?? {};
      if (typeof name !== 'string' || typeof args !== 'object' || args === null) {
        sendJson(res, 400, { error: 'Body must be {"name": string, "args": object}.' });
        return;
      }
      try {
        const result = await executeTool(
          { config: mainConfig, db: mainDb },
          name,
          args as Record<string, unknown>
        );
        sendJson(res, 200, { result });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === 'POST' && path === '/ask') {
      const body = await readJsonBody(req);
      if (typeof body.question !== 'string' || body.question.trim() === '') {
        sendJson(res, 400, { error: 'Body must be {"question": string, "board"?: string}.' });
        return;
      }
      let askConfig = mainConfig;
      if (body.board !== undefined) {
        const boardConfig =
          typeof body.board === 'string' ? opts.boards?.semanticConfigForBoard(body.board) : undefined;
        if (!boardConfig) {
          sendJson(res, 400, { error: 'The agent can only investigate boards backed by a semantic config.' });
          return;
        }
        askConfig = boardConfig;
      }
      const started = Date.now();
      const result = await runAgent(askConfig, mainDb, body.question);
      sendJson(res, 200, {
        report: result.report,
        tool_calls: result.tool_calls,
        usage: result.usage,
        duration_ms: Date.now() - started,
      });
      return;
    }

    sendJson(res, 404, {
      error: 'Not found. Routes: GET /healthz, GET /boards, GET /cards/:id, POST /tool, POST /ask.',
    });
  }

  server.listen(opts.port, opts.host, () => {
    process.stderr.write(
      `whydid serving on http://${opts.host}:${opts.port} ` +
        `(${token ? 'bearer token required' : 'no auth — localhost only'})\n`
    );
  });
  return server;
}
