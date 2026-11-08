/**
 * Demo seed — synthetic conversations for an imaginary AI support assistant.
 *
 * 60 days of data ending yesterday, generated with a fixed-seed PRNG so
 * every clone of the repo produces the same dataset. Two incidents are
 * injected into the final week so attribution questions have real answers:
 *
 * 1. BEHAVIOR change: a model rollout ("m-2" ramping from 20% to 90% of
 *    traffic) tanks the resolution rate of `integration` conversations
 *    from ~0.78 to ~0.45. → decompose_change_rate finds a behavior effect
 *    concentrated in one intent / one model version.
 *
 * 2. MIX change: `billing` volume roughly doubles in the last 5 days
 *    (think: a pricing change hit the news). Billing resolves below
 *    average, so the global rate also dips via composition. →
 *    decompose_change_additive finds billing as the growth driver.
 *
 * This script is the only part of whydid that writes to the database.
 * It opens its own (non-read-only) connection instead of the shared pool.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { EVENTS_TABLE, seedEvents } from './seed-events.js';

const TABLE = 'assistant_conversations';
const DAYS = 60;
const SEED = 42;

/** mulberry32 — tiny deterministic PRNG, plenty for demo data. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);

function pick<T>(weighted: Array<[T, number]>): T {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, weight] of weighted) {
    r -= weight;
    if (r <= 0) return value;
  }
  return weighted[weighted.length - 1]![0];
}

const INTENTS: Array<[string, number]> = [
  ['how_to', 30],
  ['billing', 15],
  ['bug_report', 15],
  ['integration', 15],
  ['account', 10],
  ['refund', 8],
  ['other', 7],
];

const LANGUAGES: Array<[string, number]> = [
  ['en', 50],
  ['de', 15],
  ['es', 12],
  ['fr', 10],
  ['pt', 8],
  ['ja', 5],
];

const CHANNELS: Array<[string, number]> = [
  ['web', 55],
  ['app', 35],
  ['api', 10],
];

const BASE_RESOLUTION: Record<string, number> = {
  how_to: 0.85,
  billing: 0.72,
  bug_report: 0.6,
  integration: 0.78,
  account: 0.8,
  refund: 0.7,
  other: 0.65,
};

interface Row {
  created_at: Date;
  session_id: string;
  user_id: string;
  channel: string;
  language: string;
  intent: string;
  model_version: string;
  resolved: boolean;
  escalated: boolean;
  latency_ms: number;
}

function generateRows(): Row[] {
  const rows: Row[] = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0); // yesterday 23:59 is the last data point

  for (let dayOffset = DAYS; dayOffset >= 1; dayOffset--) {
    const day = new Date(end.getTime() - dayOffset * 24 * 3600 * 1000);
    const daysFromEnd = dayOffset; // 1 = yesterday
    const weekday = day.getUTCDay();
    const weekendDip = weekday === 0 || weekday === 6 ? 0.7 : 1.0;

    // Slow organic growth over the window.
    const growth = 1 + (0.25 * (DAYS - dayOffset)) / DAYS;
    let volume = Math.round(280 * weekendDip * growth * (0.9 + rand() * 0.2));

    // Incident 2: billing surge in the last 5 days.
    const billingSurge = daysFromEnd <= 5;
    if (billingSurge) volume = Math.round(volume * 1.18);

    // Incident 1: model m-2 rollout ramps over the last 7 days.
    const rolloutShare =
      daysFromEnd > 7 ? 0 : 0.2 + (0.7 * (7 - daysFromEnd)) / 6; // 0.2 → 0.9

    for (let i = 0; i < volume; i++) {
      let intent = pick(INTENTS);
      if (billingSurge && rand() < 0.12) intent = 'billing';

      const language = pick(LANGUAGES);
      const channel = pick(CHANNELS);
      const modelVersion = rand() < rolloutShare ? 'm-2' : 'm-1';

      let pResolved = BASE_RESOLUTION[intent] ?? 0.7;
      if (intent === 'integration' && modelVersion === 'm-2') pResolved = 0.45;

      const resolved = rand() < pResolved;
      const escalated = !resolved && rand() < 0.6;

      const baseLatency = intent === 'bug_report' ? 4200 : 3000;
      const latency = Math.round(baseLatency * (0.5 + rand() * 1.5));

      const hour = Math.floor(rand() * 24);
      const minute = Math.floor(rand() * 60);
      const createdAt = new Date(day.getTime() + (hour * 3600 + minute * 60) * 1000);

      const userId = `u_${Math.floor(rand() * 4000)}`;
      rows.push({
        created_at: createdAt,
        session_id: `s_${userId}_${day.toISOString().slice(0, 10)}_${Math.floor(rand() * 3)}`,
        user_id: userId,
        channel,
        language,
        intent,
        model_version: modelVersion,
        resolved,
        escalated,
        latency_ms: latency,
      });
    }
  }
  return rows;
}

export async function seedDemo(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required (see .env.example / docker-compose.yml).');
  }
  const sql = postgres(url, { max: 2, onnotice: () => {} });

  try {
    await sql`DROP TABLE IF EXISTS ${sql(TABLE)}`;
    await sql`
      CREATE TABLE ${sql(TABLE)} (
        id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        created_at    TIMESTAMPTZ NOT NULL,
        session_id    TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        channel       TEXT NOT NULL,
        language      TEXT NOT NULL,
        intent        TEXT NOT NULL,
        model_version TEXT NOT NULL,
        resolved      BOOLEAN NOT NULL,
        escalated     BOOLEAN NOT NULL,
        latency_ms    INTEGER NOT NULL
      )
    `;
    await sql`CREATE INDEX ON ${sql(TABLE)} (created_at)`;

    const rows = generateRows();
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await sql`INSERT INTO ${sql(TABLE)} ${sql(rows.slice(i, i + CHUNK))}`;
    }

    const [countRow] = await sql`SELECT COUNT(*)::int AS count FROM ${sql(TABLE)}`;
    const eventCount = await seedEvents(sql);
    process.stdout.write(
      `Seeded ${countRow?.count ?? 0} synthetic conversations over ${DAYS} days into "${TABLE}".\n` +
        `Seeded ${eventCount} synthetic product events into "${EVENTS_TABLE}".\n` +
        `Injected incidents (last 7 days): integration resolution drop on model m-2, billing volume surge.\n` +
        `Try:  npm run dev -- ask "why did resolution_rate drop in the last 7 days?"\n`
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Allow running directly via `npm run seed`.
const isMain = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isMain) {
  seedDemo().catch((err: unknown) => {
    process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
