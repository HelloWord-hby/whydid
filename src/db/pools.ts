/**
 * Read-only PostgreSQL pools keyed by (URL, timezone), so each semantic
 * source can point at its own database and keep its own session timezone.
 * Same guarantees as src/db/client.ts: default_transaction_read_only and a
 * statement timeout, enforced by PostgreSQL itself.
 */
import postgres, { type Sql } from 'postgres';

const pools = new Map<string, Sql>();

function open(url: string, timezone: string, max: number): Sql {
  return postgres(url, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: {
      default_transaction_read_only: true,
      statement_timeout: 30_000,
      TimeZone: timezone,
    },
  });
}

export function poolFor(url: string, timezone: string): Sql {
  const key = `${timezone}\u0000${url}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = open(url, timezone, 5);
    pools.set(key, pool);
  }
  return pool;
}

export async function closePools(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map((p) => p.end({ timeout: 5 })));
}

export interface TableInfo {
  schema: string;
  name: string;
  kind: 'table' | 'view';
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface DatabaseInspection {
  database: string;
  server_version: string;
  tables: TableInfo[];
  /** Columns of the requested table, when one was given. */
  columns?: ColumnInfo[];
}

const MAX_TABLES = 300;

/**
 * Connect once with a short-lived pool, list user tables and views, and
 * optionally the columns of one table. Used by the admin page to test a
 * connection and to offer column pickers. Read-only, parameterized queries.
 */
export async function inspectDatabase(url: string, table?: string): Promise<DatabaseInspection> {
  const sql = open(url, 'UTC', 1);
  try {
    const [meta] = await sql<Array<{ database: string; server_version: string }>>`
      SELECT current_database() AS database, current_setting('server_version') AS server_version`;
    const tables = await sql<Array<{ schema: string; name: string; kind: string }>>`
      SELECT table_schema AS schema, table_name AS name,
             CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS kind
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%'
      ORDER BY table_schema, table_name
      LIMIT ${MAX_TABLES}`;
    const out: DatabaseInspection = {
      database: meta!.database,
      server_version: meta!.server_version,
      tables: tables.map((t) => ({ schema: t.schema, name: t.name, kind: t.kind === 'view' ? 'view' : 'table' })),
    };
    if (table) {
      const [schema, name] = table.includes('.') ? table.split('.', 2) : ['public', table];
      const cols = await sql<Array<{ name: string; type: string }>>`
        SELECT column_name AS name, data_type AS type
        FROM information_schema.columns
        WHERE table_schema = ${schema!} AND table_name = ${name!}
        ORDER BY ordinal_position`;
      out.columns = cols.map((c) => ({ name: c.name, type: c.type }));
    }
    return out;
  } finally {
    await sql.end({ timeout: 2 });
  }
}
