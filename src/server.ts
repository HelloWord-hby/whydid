/**
 * whydid serve — the agent as an HTTP service, so dashboards and
 * observability platforms can embed it.
 *
 *   GET  /         built-in demo page (a reference client for the API)
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
 *
 * Defaults to binding 127.0.0.1. If you expose it beyond localhost, set
 * WHYDID_SERVE_TOKEN and put it behind TLS — /ask spends LLM tokens.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { type Sql } from 'postgres';
import { type WhydidConfig } from './config/schema.js';
import { executeTool, listToolNames } from './tools/index.js';
import { runAgent } from './agent/orchestrator.js';
import { type BoardService } from './boards/service.js';
import { parseDays } from './boards/window.js';
import { readJsonBody, sendJson } from './http-util.js';
import { handleAgentRoute, type AgentRouteOptions } from './workbench/http.js';

/**
 * The dashboard is plain static files in web/ at the package root — no
 * build step. Resolved relative to this module so it works both from
 * src/ (tsx) and dist/ (compiled). Exact-match whitelist, no path math.
 */
const WEB_DIR = new URL('../web/', import.meta.url);
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/lib.js': { file: 'lib.js', type: 'text/javascript; charset=utf-8' },
  '/layout.js': { file: 'layout.js', type: 'text/javascript; charset=utf-8' },
  '/boards.js': { file: 'boards.js', type: 'text/javascript; charset=utf-8' },
  '/agent.js': { file: 'agent.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

export interface ServeOptions {
  port: number;
  host: string;
  /** Dashboard boards; when absent, /boards and /cards return 404. */
  boards?: BoardService;
  /** Workbench agent; when absent, /agent routes return 404. */
  agent?: AgentRouteOptions;
}

export function startServer(
  config: WhydidConfig,
  db: Sql,
  opts: ServeOptions
): ReturnType<typeof createServer> {
  const token = process.env.WHYDID_SERVE_TOKEN;

  const server = createServer((req, res) => {
    void route(req, res).catch((err: unknown) => {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Minimal CORS so browser dashboards can call the API directly.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const staticEntry =
      req.method === 'GET' && Object.hasOwn(STATIC_FILES, path) ? STATIC_FILES[path] : undefined;
    if (staticEntry) {
      try {
        const content = await readFile(new URL(staticEntry.file, WEB_DIR));
        res.writeHead(200, {
          'Content-Type': staticEntry.type,
          'Cache-Control': 'no-cache',
        });
        res.end(content);
      } catch {
        sendJson(res, 500, { error: `Dashboard file ${staticEntry.file} not found.` });
      }
      return;
    }

    if (req.method === 'GET' && path === '/healthz') {
      sendJson(res, 200, {
        ok: true,
        table: config.table,
        metrics: Object.entries(config.metrics).map(([name, m]) => ({
          name,
          kind: m.kind,
          label: m.label ?? name,
          unit: m.unit ?? null,
          decompose: m.decompose,
        })),
        dimensions: Object.entries(config.dimensions).map(([name, d]) => ({
          name,
          label: d.label ?? name,
        })),
        tools: listToolNames(),
      });
      return;
    }

    if (token && req.headers.authorization !== `Bearer ${token}`) {
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

    if (path.startsWith('/agent/')) {
      if (!opts.agent) {
        sendJson(res, 404, { error: 'The workbench agent is not enabled on this server.' });
        return;
      }
      await handleAgentRoute(req, res, path, opts.agent);
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
          { config, db },
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
      let askConfig = config;
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
      const result = await runAgent(askConfig, db, body.question);
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
