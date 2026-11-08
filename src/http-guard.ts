/**
 * Request guards for `whydid serve`, kept as pure functions so they can be
 * tested without a server.
 *
 * - Host allowlist: on a loopback bind only localhost names are accepted.
 *   This stops DNS rebinding, where a web page on an attacker's domain is
 *   pointed at 127.0.0.1 and becomes "same-origin" with the server.
 * - CORS is off unless WHYDID_CORS_ORIGIN lists origins (or "*"); the
 *   dashboard itself is same-origin and needs none.
 * - Browsers send Origin on cross-site POST/PUT. Such a request is refused
 *   unless its origin is allowed by CORS, so a page cannot spend tokens or
 *   change state with a "simple" form-like request. Configuration routes
 *   accept their own origin only, whatever CORS allows.
 */
import { timingSafeEqual } from 'node:crypto';
import { type IncomingMessage } from 'node:http';

const LOOPBACK_BINDS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isLoopbackBind(host: string): boolean {
  return LOOPBACK_BINDS.has(host);
}

export function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** The Host header must name this machine on a loopback bind, or be listed explicitly. */
export function hostAllowed(host: string | undefined, loopbackBind: boolean, extra: string[] = []): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  if (extra.includes(h) || extra.includes(h.replace(/:\d+$/, ''))) return true;
  return loopbackBind ? LOOPBACK_HOST.test(h) : true;
}

/** Value for Access-Control-Allow-Origin, or null when this origin gets no CORS. */
export function corsOriginFor(origin: string | undefined, allowed: string[]): string | null {
  if (!origin || allowed.length === 0) return null;
  if (allowed.includes('*')) return '*';
  return allowed.includes(origin.toLowerCase()) ? origin : null;
}

export function isSameOrigin(req: Pick<IncomingMessage, 'headers'>): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === (req.headers.host ?? '').toLowerCase();
  } catch {
    return false;
  }
}

/** A state-changing request from another site that CORS does not allow. */
export function isUnwantedCrossSite(req: Pick<IncomingMessage, 'headers' | 'method'>, corsAllowed: string[]): boolean {
  if (SAFE_METHODS.has((req.method ?? 'GET').toUpperCase())) return false;
  if (isSameOrigin(req)) return false;
  return corsOriginFor(req.headers.origin, corsAllowed) === null;
}

export function tokenMatches(header: string | undefined, token: string): boolean {
  const a = Buffer.from(header ?? '');
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
