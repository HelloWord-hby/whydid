/**
 * Config loader — reads whydid.config.yaml, validates it, and returns
 * the typed semantic layer used by every tool and the system prompt.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { configSchema, validateConfig, type WhydidConfig } from './schema.js';

export const DEFAULT_CONFIG_PATH = 'whydid.config.yaml';

export function loadConfig(path?: string): WhydidConfig {
  const filePath = resolve(process.cwd(), path ?? DEFAULT_CONFIG_PATH);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(
      `Config file not found at ${filePath}. ` +
        `Create a whydid.config.yaml (see the demo config in the repo) or pass --config <path>.`
    );
  }
  const parsed = configSchema.safeParse(parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid config at ${filePath}:\n${issues}`);
  }
  return validateConfig(parsed.data);
}
