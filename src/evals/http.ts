/**
 * Regression set routes.
 *
 *   GET  /evals              cases, past runs (summaries), run status, LLM configured?
 *   GET  /evals/runs/:name   one run with every case's answer and checks
 *   POST /evals/runs         {only?: string[]}  start a run in the background (spends LLM tokens)
 */
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { readJsonBody, sendJson } from '../http-util.js';
import { type EvalService } from './service.js';

const startBody = z.object({ only: z.array(z.string().max(100)).max(100).optional() }).strict();
const RUN_PATH = /^\/evals\/runs\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;

function statusOf(err: unknown): number {
  const s = (err as { status?: unknown }).status;
  return typeof s === 'number' ? s : 500;
}

export async function handleEvalsRoute(req: IncomingMessage, res: ServerResponse, path: string, evals: EvalService): Promise<void> {
  if (req.method === 'GET' && path === '/evals') {
    sendJson(res, 200, evals.overview());
    return;
  }
  const m = RUN_PATH.exec(path);
  if (req.method === 'GET' && m) {
    const run = evals.run(m[1]!);
    if (!run) sendJson(res, 404, { error: `No run named "${m[1]}".` });
    else sendJson(res, 200, run);
    return;
  }
  if (req.method === 'POST' && path === '/evals/runs') {
    const parsed = startBody.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { error: 'Body must be {"only"?: string[]}.' });
      return;
    }
    try {
      sendJson(res, 202, evals.start(parsed.data.only));
    } catch (err) {
      sendJson(res, statusOf(err), { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  sendJson(res, 404, { error: 'Routes: GET /evals, GET /evals/runs/:name, POST /evals/runs.' });
}
