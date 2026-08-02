/**
 * Mock Langfuse API server — lets you exercise `whydid sync langfuse` and
 * the full attribution loop without a real Langfuse instance.
 *
 *   npx tsx scripts/mock-langfuse.ts          # serves on :3999
 *   LANGFUSE_HOST=http://127.0.0.1:3999 \
 *   LANGFUSE_PUBLIC_KEY=pk LANGFUSE_SECRET_KEY=sk \
 *   npm run dev -- sync langfuse
 *
 * Serves 14 days of deterministic traces (fixed-seed PRNG) with two scores
 * (helpfulness NUMERIC, hallucinated BOOLEAN) and one injected incident:
 * release v2 ships 3 days before "now" and tanks helpfulness on the
 * "rag-answer" route.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_LANGFUSE_PORT ?? 3999);
const DAYS = 14;
const TRACES_PER_DAY = 120;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MockTrace {
  id: string;
  timestamp: string;
  name: string;
  userId: string;
  sessionId: string;
  release: string;
  version: string | null;
  environment: string;
  latency: number;
  totalCost: number;
}

interface MockScore {
  id: string;
  traceId: string;
  name: string;
  value: number;
  dataType: string;
  timestamp: string;
}

function generate(): { traces: MockTrace[]; scores: MockScore[] } {
  const rand = mulberry32(7);
  const traces: MockTrace[] = [];
  const scores: MockScore[] = [];
  const routes = ['chat', 'rag-answer', 'summarize'];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  for (let dayOffset = DAYS; dayOffset >= 1; dayOffset--) {
    const day = new Date(end.getTime() - dayOffset * 24 * 3600 * 1000);
    const release = dayOffset <= 3 ? 'v2' : 'v1';

    for (let i = 0; i < TRACES_PER_DAY; i++) {
      const name = routes[Math.floor(rand() * routes.length)]!;
      const ts = new Date(day.getTime() + Math.floor(rand() * 86_400) * 1000);
      const id = `tr_${day.toISOString().slice(0, 10)}_${i}`;

      traces.push({
        id,
        timestamp: ts.toISOString(),
        name,
        userId: `u_${Math.floor(rand() * 300)}`,
        sessionId: `s_${Math.floor(rand() * 800)}`,
        release,
        version: null,
        environment: 'production',
        latency: 1 + rand() * 4,
        totalCost: 0.001 + rand() * 0.004,
      });

      // Injected incident: v2 degrades helpfulness on the rag-answer route.
      const helpfulnessBase = release === 'v2' && name === 'rag-answer' ? 0.45 : 0.82;
      scores.push({
        id: `sc_h_${id}`,
        traceId: id,
        name: 'helpfulness',
        value: Math.min(1, Math.max(0, helpfulnessBase + (rand() - 0.5) * 0.2)),
        dataType: 'NUMERIC',
        timestamp: ts.toISOString(),
      });
      scores.push({
        id: `sc_x_${id}`,
        traceId: id,
        name: 'hallucinated',
        value: rand() < (helpfulnessBase < 0.6 ? 0.25 : 0.06) ? 1 : 0,
        dataType: 'BOOLEAN',
        timestamp: ts.toISOString(),
      });
    }
  }
  return { traces, scores };
}

const { traces, scores } = generate();

function paginate<T extends { timestamp: string }>(
  items: T[],
  url: URL
): { data: T[]; meta: { page: number; limit: number; totalItems: number; totalPages: number } } {
  const from = url.searchParams.get('fromTimestamp');
  const to = url.searchParams.get('toTimestamp');
  const page = Number(url.searchParams.get('page') ?? 1);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100);

  const filtered = items.filter(
    (t) => (!from || t.timestamp >= from) && (!to || t.timestamp < to)
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  return {
    data: filtered.slice((page - 1) * limit, page * limit),
    meta: { page, limit, totalItems: filtered.length, totalPages },
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (!req.headers.authorization?.startsWith('Basic ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  let body: unknown;
  if (url.pathname === '/api/public/traces') {
    body = paginate(traces, url);
  } else if (url.pathname === '/api/public/v2/scores') {
    body = paginate(scores, url);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
});

server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(
    `Mock Langfuse on http://127.0.0.1:${PORT} — ${traces.length} traces, ${scores.length} scores over ${DAYS} days.\n` +
      `Incident: release v2 (last 3 days) degrades "helpfulness" on the rag-answer route.\n`
  );
});
