/**
 * Database client — a lazily-created, read-only postgres.js pool.
 *
 * Read-only is enforced server-side via the default_transaction_read_only
 * startup GUC: any INSERT/UPDATE/DELETE/DDL the agent could ever be tricked
 * into is rejected by PostgreSQL itself, not by string matching.
 *
 * The session timezone is pinned to the configured timezone so that
 * date_trunc and date-literal casts behave identically regardless of the
 * host machine's locale.
 *
 * The pool is created on first use so pure modules (attribution math,
 * SQL builder) stay importable and testable without a DATABASE_URL.
 */
import postgres, { type Sql } from 'postgres';

let pool: Sql | null = null;
let poolTimezone: string | null = null;

export function getDb(timezone: string): Sql {
  if (pool) {
    if (poolTimezone !== timezone) {
      throw new Error(
        `Database pool already initialized with timezone ${poolTimezone}, requested ${timezone}.`
      );
    }
    return pool;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required. Copy .env.example to .env and point it at your PostgreSQL.'
    );
  }
  pool = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: {
      default_transaction_read_only: true,
      statement_timeout: 30_000,
      TimeZone: timezone,
    },
  });
  poolTimezone = timezone;
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end({ timeout: 5 });
    pool = null;
    poolTimezone = null;
  }
}
