/**
 * whydid serve — the agent as an HTTP service, so dashboards and
 * observability platforms can embed it.
 *
 *   GET  /         built-in demo page (a reference client for the API)
 *   GET  /healthz  liveness + semantic-layer summary
 *   POST /tool     {name, args}   deterministic tool call, no LLM involved.
 *                                 For dashboard panels that need numbers.
 *   POST /ask      {question}     full attribution investigation (uses the
 *                                 LLM; returns report + tool-call log).
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
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

export interface ServeOptions {
  port: number;
  host: string;
}

const MAX_BODY_BYTES = 64 * 1024;

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

    const staticEntry = req.method === 'GET' ? STATIC_FILES[req.url ?? ''] : undefined;
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

    if (req.method === 'GET' && req.url === '/healthz') {
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

    if (req.method === 'POST' && req.url === '/tool') {
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

    if (req.method === 'POST' && req.url === '/ask') {
      const body = await readJsonBody(req);
      if (typeof body.question !== 'string' || body.question.trim() === '') {
        sendJson(res, 400, { error: 'Body must be {"question": string}.' });
        return;
      }
      const started = Date.now();
      const result = await runAgent(config, db, body.question);
      sendJson(res, 200, {
        report: result.report,
        tool_calls: result.tool_calls,
        usage: result.usage,
        duration_ms: Date.now() - started,
      });
      return;
    }

    sendJson(res, 404, {
      error: 'Not found. Routes: GET /healthz, POST /tool, POST /ask.',
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

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('Request body is not valid JSON.');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
