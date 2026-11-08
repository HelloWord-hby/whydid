/**
 * Serves the built dashboard (ui/dist) — index.html plus hashed assets.
 *
 * Only two shapes of path are served: "/" (or /index.html) and
 * "/assets/<file>" where <file> is a plain file name. No other path math,
 * so nothing outside ui/dist/assets can be reached. Assets are
 * content-hashed by the build, so they are cached for a year; index.html
 * is never cached.
 */
import { readFile } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { extname } from 'node:path';

const UI_DIR = new URL('../ui/dist/', import.meta.url);
const ASSET = /^\/assets\/[A-Za-z0-9._-]+$/;
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>whydid</title>
<body style="font:14px system-ui;padding:40px;color:#444">
<h3>The dashboard is not built yet.</h3>
<p>Run <code>npm run build:ui</code> in the whydid directory, then reload. The API is running.</p></body>`;

/** Returns true when the request was a dashboard file and has been answered. */
export async function serveUi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (req.method !== 'GET') return false;
  if (path === '/' || path === '/index.html') {
    try {
      const html = await readFile(new URL('index.html', UI_DIR));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(html);
    } catch {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(NOT_BUILT);
    }
    return true;
  }
  if (!ASSET.test(path) || path.includes('..')) return false;
  const type = TYPES[extname(path)];
  if (!type) return false;
  try {
    const body = await readFile(new URL(`.${path}`, UI_DIR));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
  return true;
}
