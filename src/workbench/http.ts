/**
 * Workbench HTTP routes.
 *
 *   GET  /agent/status                  LLM configured? model, prompt version, tools
 *   POST /agent/sessions                new session → {id, prompt_version}
 *   GET  /agent/sessions/:id            transcript + call log (restore after reload)
 *   POST /agent/sessions/:id/messages   one turn, streamed as Server-Sent Events
 *
 * The message body is validated with zod: {text, entry, board?, card?, days?}.
 * `entry` (chat | card | board) picks the playbook; board/card give structured
 * context instead of burying it in the question text.
 */
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { readJsonBody, sendJson } from '../http-util.js';
import { ENTRIES } from './prompt.js';
import { type Workbench } from './index.js';
import { type AgentEvent, type LlmLike } from './session.js';

export interface AgentRouteOptions {
  workbench: Workbench;
  /** Creates the LLM client per turn; throws when no key is configured. */
  llmFactory: () => LlmLike;
  /** Whether an LLM is configured, for /agent/status (no secret exposed). */
  llmConfigured: () => boolean;
  model?: string;
}

const messageBody = z
  .object({
    text: z.string().trim().min(1).max(4000),
    entry: z.enum(ENTRIES).default('chat'),
    board: z.string().max(100).optional(),
    card: z.string().max(100).optional(),
    days: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional(),
  })
  .strict();

const SESSION_PATH = /^\/agent\/sessions\/([0-9a-f-]{36})(\/messages)?$/;

function writeEvent(res: ServerResponse, e: AgentEvent): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
}

export async function handleAgentRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  opts: AgentRouteOptions
): Promise<void> {
  const wb = opts.workbench;

  if (req.method === 'GET' && path === '/agent/status') {
    sendJson(res, 200, {
      llm_configured: opts.llmConfigured(),
      model: opts.model ?? null,
      prompt_version: wb.system.version,
      tools: wb.tools.map((t) => t.name),
    });
    return;
  }

  if (req.method === 'POST' && path === '/agent/sessions') {
    const s = wb.createSession();
    sendJson(res, 201, { id: s.id, prompt_version: s.promptVersion });
    return;
  }

  const m = SESSION_PATH.exec(path);
  const session = m ? wb.getSession(m[1]!) : undefined;
  if (m && !session) {
    sendJson(res, 404, { error: 'Unknown or expired session. Start a new one.' });
    return;
  }

  if (session && req.method === 'GET' && !m![2]) {
    sendJson(res, 200, {
      id: session.id,
      prompt_version: session.promptVersion,
      transcript: session.transcript,
      calls: session.calls.map(({ result: _r, ...rest }) => rest),
    });
    return;
  }

  if (session && req.method === 'POST' && m![2]) {
    const parsed = messageBody.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; ');
      sendJson(res, 400, { error: `Invalid message — ${issues}` });
      return;
    }
    const boards = wb.env.boards;
    const { card, board } = parsed.data;
    if (card && !boards.cardConfig(card)) {
      sendJson(res, 400, { error: `Unknown card "${card}".` });
      return;
    }
    if (board && !boards.boardsConfig().some((b) => b.id === board)) {
      sendJson(res, 400, { error: `Unknown board "${board}".` });
      return;
    }
    if (session.busy) {
      sendJson(res, 409, { error: 'This session is still answering. Wait for it to finish.' });
      return;
    }
    let llm: LlmLike;
    try {
      llm = opts.llmFactory();
    } catch (err) {
      sendJson(res, 503, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    await session.send(parsed.data, llm, (e) => writeEvent(res, e));
    res.end();
    return;
  }

  sendJson(res, 404, { error: 'Unknown agent route.' });
}
