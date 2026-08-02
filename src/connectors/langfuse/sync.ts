/**
 * Langfuse sync — incremental pull of traces + scores into one wide
 * PostgreSQL table that whydid's semantic layer can query.
 *
 *   traces  → one row per trace (id, timestamps, user, session, release,
 *             version, environment, latency, cost)
 *   scores  → raw rows in langfuse_scores, then pivoted into `score_<name>`
 *             numeric columns on the wide table (AVG per trace)
 *
 * Sync state is a single cursor (the toTimestamp of the last successful
 * run). Each run re-fetches a 1-hour overlap before the cursor and upserts
 * by id, so late-arriving data heals itself and re-runs are idempotent.
 *
 * This module (like the demo seed) opens its own writable connection —
 * the agent's query pool stays read-only.
 */
import postgres, { type Sql } from 'postgres';
import { assertIdentifier, quoteIdentifier } from '../../config/schema.js';
import { LangfuseApi } from './api.js';
import {
  buildScoreColumnMap,
  scoreToRow,
  traceToRow,
  type ConversationRow,
  type ScoreRow,
} from './transform.js';

export interface SyncOptions {
  /** Initial backfill start (ISO date or timestamp). Default: 30 days ago. */
  from?: string;
  /** Target table name. Default: langfuse_conversations. */
  table?: string;
}

const DEFAULT_TABLE = 'langfuse_conversations';
const SCORES_TABLE = 'langfuse_scores';
const STATE_TABLE = 'whydid_sync_state';
const OVERLAP_MS = 60 * 60 * 1000;
const BACKFILL_DAYS = 30;
const CHUNK = 500;

export async function syncLangfuse(opts: SyncOptions = {}): Promise<void> {
  const baseUrl = process.env.LANGFUSE_HOST ?? process.env.LANGFUSE_BASE_URL;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!baseUrl || !publicKey || !secretKey) {
    throw new Error(
      'LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required (see .env.example).'
    );
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is required.');

  const table = opts.table ?? DEFAULT_TABLE;
  assertIdentifier(table);

  const api = new LangfuseApi({ baseUrl, publicKey, secretKey });
  const sql = postgres(dbUrl, { max: 2, onnotice: () => {} });

  try {
    await ensureSchema(sql, table);

    const to = new Date().toISOString();
    const from = await resolveFrom(sql, opts.from);
    process.stdout.write(`Syncing Langfuse ${from} → ${to}\n`);

    let traceCount = 0;
    for await (const page of api.listTraces(from, to)) {
      const rows = page.map(traceToRow);
      await upsertConversations(sql, table, rows);
      traceCount += rows.length;
      process.stdout.write(`  traces: ${traceCount}\r`);
    }
    process.stdout.write(`  traces synced: ${traceCount}\n`);

    let scoreCount = 0;
    for await (const page of api.listScores(from, to)) {
      const rows = page.map(scoreToRow).filter((r): r is ScoreRow => r !== null);
      await upsertScores(sql, rows);
      scoreCount += rows.length;
      process.stdout.write(`  scores: ${scoreCount}\r`);
    }
    process.stdout.write(`  scores synced: ${scoreCount}\n`);

    const scoreColumns = await pivotScores(sql, table);

    await sql`
      INSERT INTO ${sql(STATE_TABLE)} (source, synced_to)
      VALUES ('langfuse', ${to})
      ON CONFLICT (source) DO UPDATE SET synced_to = EXCLUDED.synced_to
    `;

    printSummary(table, traceCount, scoreCount, scoreColumns);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function ensureSchema(sql: Sql, table: string): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(table)} (
      id          TEXT PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL,
      name        TEXT,
      user_id     TEXT,
      session_id  TEXT,
      release     TEXT,
      version     TEXT,
      environment TEXT,
      latency_sec DOUBLE PRECISION,
      total_cost  DOUBLE PRECISION,
      synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ${sql(table + '_created_at_idx')} ON ${sql(table)} (created_at)`;
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(SCORES_TABLE)} (
      id        TEXT PRIMARY KEY,
      trace_id  TEXT NOT NULL,
      name      TEXT NOT NULL,
      value     DOUBLE PRECISION,
      data_type TEXT,
      ts        TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS langfuse_scores_trace_idx ON ${sql(SCORES_TABLE)} (name, trace_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(STATE_TABLE)} (
      source    TEXT PRIMARY KEY,
      synced_to TIMESTAMPTZ NOT NULL
    )
  `;
}

async function resolveFrom(sql: Sql, override?: string): Promise<string> {
  if (override) {
    const d = new Date(override);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid --from value "${override}"`);
    return d.toISOString();
  }
  const [state] = await sql`
    SELECT synced_to FROM ${sql(STATE_TABLE)} WHERE source = 'langfuse'
  `;
  if (state?.synced_to) {
    return new Date(new Date(state.synced_to as string).getTime() - OVERLAP_MS).toISOString();
  }
  return new Date(Date.now() - BACKFILL_DAYS * 24 * 3600 * 1000).toISOString();
}

async function upsertConversations(
  sql: Sql,
  table: string,
  rows: ConversationRow[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await sql`
      INSERT INTO ${sql(table)} ${sql(
        chunk,
        'id',
        'created_at',
        'name',
        'user_id',
        'session_id',
        'release',
        'version',
        'environment',
        'latency_sec',
        'total_cost'
      )}
      ON CONFLICT (id) DO UPDATE SET
        created_at  = EXCLUDED.created_at,
        name        = EXCLUDED.name,
        user_id     = EXCLUDED.user_id,
        session_id  = EXCLUDED.session_id,
        release     = EXCLUDED.release,
        version     = EXCLUDED.version,
        environment = EXCLUDED.environment,
        latency_sec = EXCLUDED.latency_sec,
        total_cost  = EXCLUDED.total_cost,
        synced_at   = now()
    `;
  }
}

async function upsertScores(sql: Sql, rows: ScoreRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await sql`
      INSERT INTO ${sql(SCORES_TABLE)} ${sql(chunk, 'id', 'trace_id', 'name', 'value', 'data_type', 'ts')}
      ON CONFLICT (id) DO UPDATE SET
        trace_id = EXCLUDED.trace_id,
        name     = EXCLUDED.name,
        value    = EXCLUDED.value,
        data_type = EXCLUDED.data_type,
        ts       = EXCLUDED.ts
    `;
  }
}

/** Pivot numeric scores into `score_*` columns. Returns the column map. */
async function pivotScores(sql: Sql, table: string): Promise<Map<string, string>> {
  const names = await sql`
    SELECT DISTINCT name FROM ${sql(SCORES_TABLE)} WHERE value IS NOT NULL ORDER BY name
  `;
  const columnMap = buildScoreColumnMap(names.map((r) => String(r.name)));

  for (const [name, column] of columnMap) {
    assertIdentifier(column);
    await sql.unsafe(
      `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(column)} DOUBLE PRECISION`
    );
    await sql.unsafe(
      `UPDATE ${quoteIdentifier(table)} c
       SET ${quoteIdentifier(column)} = s.avg_value
       FROM (
         SELECT trace_id, AVG(value) AS avg_value
         FROM ${quoteIdentifier(SCORES_TABLE)}
         WHERE name = $1 AND value IS NOT NULL
         GROUP BY trace_id
       ) s
       WHERE c.id = s.trace_id
         AND c.${quoteIdentifier(column)} IS DISTINCT FROM s.avg_value`,
      [name]
    );
  }
  return columnMap;
}

function printSummary(
  table: string,
  traces: number,
  scores: number,
  scoreColumns: Map<string, string>
): void {
  process.stdout.write(
    `Done: ${traces} traces and ${scores} scores upserted into "${table}".\n`
  );
  if (scoreColumns.size === 0) return;

  process.stdout.write(`\nScore columns available as rate metrics:\n`);
  const lines = [...scoreColumns.entries()]
    .map(
      ([name, column]) =>
        `  ${column}:\n    kind: rate\n    of: ${column}\n    label: "${name.replace(/"/g, "'")}"`
    )
    .join('\n');
  process.stdout.write(
    `\nAdd to your whydid.config.yaml metrics section:\n\n${lines}\n\n` +
      `A ready-made starting config is in presets/langfuse.yaml.\n`
  );
}
