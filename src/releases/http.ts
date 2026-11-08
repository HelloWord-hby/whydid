/**
 * Release log routes.
 *
 *   GET /releases   the log: origin (file | demo | none), Markdown, parsed entries
 *   PUT /releases   {markdown}  replace the log file; an empty string clears it
 */
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { readJsonBody, sendJson } from '../http-util.js';
import { MAX_RELEASE_LOG_BYTES, type ReleaseStore } from './store.js';

const putBody = z.object({ markdown: z.string() }).strict();

export async function handleReleasesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  store: ReleaseStore
): Promise<void> {
  if (req.method === 'GET') {
    sendJson(res, 200, store.read());
    return;
  }
  if (req.method === 'PUT') {
    let body: Record<string, unknown>;
    try {
      // JSON escaping can grow the text; allow headroom over the file limit.
      body = await readJsonBody(req, MAX_RELEASE_LOG_BYTES * 2);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const parsed = putBody.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'Body must be {"markdown": string}.' });
      return;
    }
    try {
      sendJson(res, 200, store.write(parsed.data.markdown));
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  sendJson(res, 405, { error: 'Use GET or PUT on /releases.' });
}
