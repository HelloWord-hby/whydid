/**
 * Model-output data source: live Langfuse when keys are configured,
 * the deterministic demo dataset otherwise.
 *
 * The live path pulls traces and scores for the board window plus the
 * baseline window through the public API, caps the number of pages so a
 * busy project cannot stall the dashboard, and caches the result briefly.
 * The cap is reported (`truncated`) rather than hidden.
 */
import { LangfuseApi } from '../../connectors/langfuse/api.js';
import { type ModelDataset, type ModelScore, type ModelTrace } from './aggregate.js';
import { generateDemoModelDataset } from './demo.js';

export interface TraceDetail {
  id: string;
  timestamp: string;
  name: string | null;
  release: string | null;
  /** Raw question and answer text — untrusted, sanitized by the caller. */
  input: string;
  output: string;
  /** True when the text is synthetic demo content, not a real conversation. */
  synthetic: boolean;
}

export interface ModelSource {
  mode: 'live' | 'demo';
  load(from: string, to: string): Promise<ModelDataset>;
  getTrace(id: string): Promise<TraceDetail | null>;
}

function textOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

const DEMO_QUESTIONS: Record<string, string[]> = {
  chat: ['How do I paginate the list endpoint?', 'Can I call the API from a browser?'],
  'rag-answer': ['What is the rate limit on the free plan?', 'Which CLI flag enables verbose logging?'],
  troubleshoot: ['My webhook returns 401 after rotating keys.', 'Uploads fail with a timeout error.'],
  summarize: ['Summarize the changelog for the last release.', 'Summarize this support thread.'],
};

const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  at: number;
  data: Promise<ModelDataset>;
}

export interface LangfuseEnv {
  LANGFUSE_HOST?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
}

export function createModelSource(env: LangfuseEnv, maxPages: number): ModelSource {
  if (env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY) {
    const api = new LangfuseApi({
      baseUrl: env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
    });
    return liveSource(api, maxPages);
  }
  return demoSource();
}

function demoSource(): ModelSource {
  let cached: { day: string; data: ModelDataset } | null = null;
  const load = async (): Promise<ModelDataset> => {
    const day = new Date().toISOString().slice(0, 10);
    if (!cached || cached.day !== day) {
      cached = { day, data: generateDemoModelDataset() };
    }
    return cached.data;
  };
  return {
    mode: 'demo',
    load,
    getTrace: async (id) => {
      const ds = await load();
      const trace = ds.traces.find((t) => t.id === id);
      if (!trace) return null;
      const route = trace.name ?? 'chat';
      const options = DEMO_QUESTIONS[route] ?? DEMO_QUESTIONS.chat!;
      const index = Number(id.slice(-1)) % options.length || 0;
      const comments = ds.scores
        .filter((s) => s.traceId === id && s.comment)
        .map((s) => s.comment as string);
      return {
        id,
        timestamp: trace.timestamp,
        name: trace.name,
        release: trace.release,
        input: options[index]!,
        output: comments.length
          ? `[synthetic answer exhibiting: ${comments.join(' ')}]`
          : '[synthetic answer, no judge comments]',
        synthetic: true,
      };
    },
  };
}

function liveSource(api: LangfuseApi, maxPages: number): ModelSource {
  const cache = new Map<string, CacheEntry>();
  return {
    mode: 'live',
    load: (from, to) => {
      const key = `${from}|${to}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
      const data = fetchLive(api, from, to, maxPages);
      cache.set(key, { at: Date.now(), data });
      // Do not keep a failed fetch cached.
      data.catch(() => cache.delete(key));
      return data;
    },
    getTrace: async (id) => {
      const t = await api.getTrace(id);
      if (!t) return null;
      return {
        id: String(t.id ?? id),
        timestamp: String(t.timestamp ?? ''),
        name: (t.name as string | null) ?? null,
        release: (t.release as string | null) ?? null,
        input: textOf(t.input),
        output: textOf(t.output),
        synthetic: false,
      };
    },
  };
}

async function fetchLive(
  api: LangfuseApi,
  from: string,
  to: string,
  maxPages: number
): Promise<ModelDataset> {
  const fromTs = `${from}T00:00:00.000Z`;
  const toTs = `${to}T00:00:00.000Z`;
  let truncated = false;

  const traces: ModelTrace[] = [];
  let pages = 0;
  for await (const page of api.listTraces(fromTs, toTs)) {
    for (const t of page) {
      traces.push({
        id: t.id,
        timestamp: t.timestamp,
        name: t.name ?? null,
        release: t.release ?? null,
        latency: t.latency ?? null,
        cost: t.totalCost ?? null,
      });
    }
    if (++pages >= maxPages) {
      truncated = true;
      break;
    }
  }

  const scores: ModelScore[] = [];
  pages = 0;
  for await (const page of api.listScores(fromTs, toTs)) {
    for (const s of page) {
      scores.push({
        traceId: s.traceId ?? null,
        name: s.name,
        value: s.value ?? null,
        dataType: s.dataType ?? null,
        timestamp: s.timestamp,
        comment: s.comment ?? null,
      });
    }
    if (++pages >= maxPages) {
      truncated = true;
      break;
    }
  }

  return { traces, scores, truncated };
}
