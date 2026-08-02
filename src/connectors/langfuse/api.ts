/**
 * Langfuse public API client — just the two read endpoints the sync needs.
 *
 * Uses the long-stable page-based endpoints for maximum compatibility with
 * self-hosted deployments:
 *   GET /api/public/traces      (page/limit, fromTimestamp/toTimestamp)
 *   GET /api/public/v2/scores   (page/limit, fromTimestamp/toTimestamp)
 *
 * Newer Langfuse versions gate trace latency/cost behind the `fields`
 * parameter; older versions don't know it and may reject it. The client
 * sends `fields=core,metrics` first and falls back to no `fields` on 400.
 */
import { type LangfuseScore, type LangfuseTrace } from './transform.js';

export interface LangfuseApiOptions {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

interface PageMeta {
  page: number;
  limit: number;
  totalItems?: number;
  totalPages?: number;
}

const PAGE_LIMIT = 100;
const MAX_PAGES = 10_000;

export class LangfuseApi {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private tracesFieldsSupported: boolean | null = null;

  constructor(opts: LangfuseApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.authHeader =
      'Basic ' + Buffer.from(`${opts.publicKey}:${opts.secretKey}`).toString('base64');
  }

  async *listTraces(from: string, to: string): AsyncGenerator<LangfuseTrace[]> {
    yield* this.paginate<LangfuseTrace>('/api/public/traces', {
      fromTimestamp: from,
      toTimestamp: to,
    });
  }

  async *listScores(from: string, to: string): AsyncGenerator<LangfuseScore[]> {
    yield* this.paginate<LangfuseScore>('/api/public/v2/scores', {
      fromTimestamp: from,
      toTimestamp: to,
    });
  }

  private async *paginate<T>(
    path: string,
    params: Record<string, string>
  ): AsyncGenerator<T[]> {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.get(path, { ...params, page: String(page), limit: String(PAGE_LIMIT) });
      const data = (body.data ?? []) as T[];
      if (data.length > 0) yield data;

      const meta = body.meta as PageMeta | undefined;
      const lastPage =
        data.length < PAGE_LIMIT || (meta?.totalPages != null && page >= meta.totalPages);
      if (lastPage) return;
    }
    throw new Error(`Langfuse pagination exceeded ${MAX_PAGES} pages for ${path} — aborting.`);
  }

  private async get(
    path: string,
    params: Record<string, string>
  ): Promise<{ data?: unknown[]; meta?: unknown }> {
    const isTraces = path === '/api/public/traces';
    const attempts: Array<Record<string, string>> = [];
    if (isTraces && this.tracesFieldsSupported !== false) {
      attempts.push({ ...params, fields: 'core,metrics' });
    }
    if (!isTraces || this.tracesFieldsSupported !== true) {
      attempts.push(params);
    }

    let lastError: Error | null = null;
    for (const attempt of attempts) {
      const url = new URL(this.baseUrl + path);
      for (const [k, v] of Object.entries(attempt)) url.searchParams.set(k, v);

      const response = await fetch(url, {
        headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        if (isTraces) this.tracesFieldsSupported = 'fields' in attempt;
        return (await response.json()) as { data?: unknown[]; meta?: unknown };
      }

      const text = (await response.text()).slice(0, 300);
      lastError = new Error(`Langfuse API ${response.status} on ${path}: ${text}`);
      // Only a 400 with the fields param warrants a retry without it.
      if (!(isTraces && 'fields' in attempt && response.status === 400)) {
        throw lastError;
      }
      this.tracesFieldsSupported = false;
    }
    throw lastError ?? new Error(`Langfuse API request failed for ${path}`);
  }
}
