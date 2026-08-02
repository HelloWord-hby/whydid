/**
 * Shared context passed to every tool: the semantic-layer config and the
 * database pool. Tools never touch process.env or global state directly.
 */
import { type Sql } from 'postgres';
import { type WhydidConfig } from '../config/schema.js';

export interface ToolContext {
  config: WhydidConfig;
  db: Sql;
}

/** postgres.js returns numerics as strings; normalize once, at the edge. */
export function toNumber(value: unknown): number {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error(`Expected a number from the database, got: ${String(value)}`);
  }
  return n;
}
