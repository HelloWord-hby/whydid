/**
 * API client. Talks to the whydid server that served the page, or to
 * ?api=<url> for a remote/dev server. ?token= is kept in sessionStorage.
 */
import { type AgentEvent } from './types';

const inBrowser = typeof window !== 'undefined';
const params = new URLSearchParams(inBrowser ? location.search : '');
export const API = (params.get('api') || import.meta.env.VITE_WHYDID_API || '').replace(/\/+$/, '');
if (inBrowser && params.get('token')) sessionStorage.setItem('whydid_token', params.get('token') as string);
const TOKEN = (inBrowser && sessionStorage.getItem('whydid_token')) || '';

export function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function parse<T>(r: Response, path: string): Promise<T> {
  let body: unknown = null;
  try {
    body = await r.json();
  } catch {
    /* not JSON */
  }
  if (!r.ok) {
    const msg = (body as { error?: string } | null)?.error;
    throw Object.assign(new Error(msg || `HTTP ${r.status} on ${path}`), { status: r.status });
  }
  return body as T;
}

export async function getJson<T>(path: string): Promise<T> {
  return parse<T>(await fetch(API + path, { headers: headers() }), path);
}

export async function putJson<T>(path: string, payload: unknown): Promise<T> {
  return parse<T>(await fetch(API + path, { method: 'PUT', headers: headers(), body: JSON.stringify(payload) }), path);
}

export async function postJson<T>(path: string, payload: unknown): Promise<T> {
  return parse<T>(await fetch(API + path, { method: 'POST', headers: headers(), body: JSON.stringify(payload) }), path);
}

/** Split a Server-Sent Events buffer into complete JSON payloads and the remainder. */
export function parseSseFrames(buffer: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  let rest = buffer;
  let i: number;
  while ((i = rest.indexOf('\n\n')) >= 0) {
    const frame = rest.slice(0, i);
    rest = rest.slice(i + 2);
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice(6))
      .join('');
    if (data) events.push(JSON.parse(data));
  }
  return { events, rest };
}

/** POST a message and feed each streamed event to onEvent. Throws with .status on HTTP errors. */
export async function streamTurn(sessionId: string, body: unknown, onEvent: (e: AgentEvent) => void): Promise<void> {
  const path = `/agent/sessions/${sessionId}/messages`;
  const r = await fetch(API + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  if (!r.ok || !r.body) {
    await parse(r, path);
    return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const { events, rest } = parseSseFrames(buf);
    buf = rest;
    events.forEach((e) => onEvent(e as AgentEvent));
  }
}
