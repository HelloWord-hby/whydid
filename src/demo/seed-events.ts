/**
 * Demo product-analytics events for the Product Events board.
 *
 * One row per tracked event (app_open, chat_open, suggestion_impression,
 * question_sent, answer_received, feedback_submit) for the same imaginary
 * developer-tools assistant as the conversation demo. Fixed-seed PRNG, 60
 * days ending yesterday. Two findable changes:
 *
 * 1. The suggested-questions panel is redesigned 10 days ago: click-through
 *    on suggestions rises from ~7% to ~12%, lifting the ask step of the funnel.
 * 2. A push campaign in the last 3 days triples sessions from the `push` entry.
 */
import { type Sql } from 'postgres';

export const EVENTS_TABLE = 'app_events';
const DAYS = 60;
const REDESIGN_DAYS_AGO = 10;
const PUSH_CAMPAIGN_DAYS = 3;

const PLATFORMS: Array<[string, number]> = [
  ['ios', 40],
  ['android', 40],
  ['web', 20],
];

const ENTRIES: Array<[string, number]> = [
  ['home', 45],
  ['chat_tab', 25],
  ['push', 12],
  ['search', 10],
  ['share_link', 8],
];

const SUGGESTIONS: Array<[string, number]> = [
  ['How do I rotate an API key?', 18],
  ['Why is my webhook failing?', 16],
  ['How do I upgrade my plan?', 14],
  ['Where can I see rate limits?', 12],
  ['How do I invite a teammate?', 12],
  ['How do I export logs?', 10],
  ['How do I set up SSO?', 9],
  ['What changed in the latest SDK?', 9],
];

interface EventRow {
  created_at: Date;
  event_name: string;
  user_id: string;
  session_id: string;
  entry: string;
  platform: string;
  suggestion: string | null;
  clicked: boolean | null;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateEventRows(now: Date = new Date()): EventRow[] {
  const rand = mulberry32(1108);
  const pick = <T>(weighted: Array<[T, number]>): T => {
    const total = weighted.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [value, weight] of weighted) {
      r -= weight;
      if (r <= 0) return value;
    }
    return weighted[weighted.length - 1]![0];
  };

  const end = new Date(now.getTime());
  end.setUTCHours(0, 0, 0, 0);
  const rows: EventRow[] = [];

  for (let daysAgo = DAYS; daysAgo >= 1; daysAgo--) {
    const day = new Date(end.getTime() - daysAgo * 86_400_000);
    const weekday = day.getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.7 : 1;
    const growth = 1 + (0.2 * (DAYS - daysAgo)) / DAYS;
    const sessions = Math.round(650 * weekend * growth * (0.9 + rand() * 0.2));
    const ctr = daysAgo <= REDESIGN_DAYS_AGO ? 0.12 : 0.07;
    const pushBoost = daysAgo <= PUSH_CAMPAIGN_DAYS;
    const dayKey = day.toISOString().slice(0, 10);

    for (let i = 0; i < sessions + (pushBoost ? 160 : 0); i++) {
      const entry = i >= sessions ? 'push' : pick(ENTRIES);
      const platform = pick(PLATFORMS);
      const userId = `u_${Math.floor(rand() * 3000)}`;
      const sessionId = `s_${dayKey}_${i}`;
      let t = day.getTime() + Math.floor(rand() * 86_000) * 1000;
      const emit = (event_name: string, suggestion: string | null = null, clicked: boolean | null = null) => {
        t += 1000 + Math.floor(rand() * 20_000);
        rows.push({
          created_at: new Date(Math.min(t, day.getTime() + 86_399_000)),
          event_name,
          user_id: userId,
          session_id: sessionId,
          entry,
          platform,
          suggestion,
          clicked,
        });
      };

      emit('app_open');
      const pChat = entry === 'chat_tab' ? 0.95 : entry === 'push' ? 0.45 : 0.6;
      if (rand() >= pChat) continue;
      emit('chat_open');

      let clickedAny = false;
      const shown = new Set<string>();
      while (shown.size < 3) shown.add(pick(SUGGESTIONS));
      for (const s of shown) {
        const clicked: boolean = !clickedAny && rand() < ctr;
        clickedAny ||= clicked;
        emit('suggestion_impression', s, clicked);
      }

      if (!clickedAny && rand() >= 0.68) continue;
      emit('question_sent');
      if (rand() >= 0.96) continue;
      emit('answer_received');
      if (rand() < 0.15) emit('feedback_submit');
    }
  }
  return rows;
}

export async function seedEvents(sql: Sql): Promise<number> {
  await sql`DROP TABLE IF EXISTS ${sql(EVENTS_TABLE)}`;
  await sql`
    CREATE TABLE ${sql(EVENTS_TABLE)} (
      id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL,
      event_name  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      entry       TEXT NOT NULL,
      platform    TEXT NOT NULL,
      suggestion  TEXT,
      clicked     BOOLEAN
    )
  `;
  await sql`CREATE INDEX ON ${sql(EVENTS_TABLE)} (created_at)`;
  await sql`CREATE INDEX ON ${sql(EVENTS_TABLE)} (event_name, created_at)`;

  const rows = generateEventRows();
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await sql`INSERT INTO ${sql(EVENTS_TABLE)} ${sql(rows.slice(i, i + CHUNK))}`;
  }
  return rows.length;
}
