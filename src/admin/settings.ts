/**
 * Connection settings set from the admin page: the LLM endpoint, Langfuse
 * keys and per-source database URLs.
 *
 * Stored in .whydid/settings.json (gitignored, file mode 0600). A value
 * saved here overrides the environment; anything not saved falls back to
 * .env, so existing setups keep working. Secrets never leave the server:
 * the admin page only sees masked values and where each value comes from.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

export const DEFAULT_SETTINGS_PATH = '.whydid/settings.json';
export const DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_LLM_MODEL = 'anthropic/claude-sonnet-4.5';
export const DEFAULT_LANGFUSE_HOST = 'https://cloud.langfuse.com';

const url = z.string().trim().url().max(500);
const secret = z.string().trim().min(1).max(500);

const settingsSchema = z
  .object({
    llm: z.object({ base_url: url.optional(), api_key: secret.optional(), model: z.string().trim().min(1).max(200).optional() }).strict().default({}),
    langfuse: z.object({ host: url.optional(), public_key: secret.optional(), secret_key: secret.optional() }).strict().default({}),
    databases: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().trim().min(1).max(1000)).default({}),
  })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;

/** Patch semantics: a missing field keeps the saved value, null removes it, a string sets it. */
const patchValue = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();
export const settingsPatchSchema = z
  .object({
    llm: z.object({ base_url: patchValue(url), api_key: patchValue(secret), model: patchValue(z.string().trim().min(1).max(200)) }).strict().optional(),
    langfuse: z.object({ host: patchValue(url), public_key: patchValue(secret), secret_key: patchValue(secret) }).strict().optional(),
    databases: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), patchValue(z.string().trim().min(1).max(1000).refine(isPostgresUrl, 'expected a postgres:// URL'))).optional(),
  })
  .strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export function isPostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\//.test(value);
}

export type ValueOrigin = 'saved' | 'env' | 'default' | 'none';

export interface FieldView {
  value: string | null;
  origin: ValueOrigin;
}

/** Only the last four characters of a long secret are shown; short secrets are fully hidden. */
export function maskSecret(value: string): string {
  if (value.length < 20) return '••••';
  return `••••${value.slice(-4)}`;
}

const trimSlash = (u: string | undefined) => (u ?? '').replace(/\/+$/, '');

/** postgres://user:pass@host:5432/db → postgres://user:••••@host:5432/db */
export function maskDatabaseUrl(value: string): string {
  try {
    const u = new URL(value);
    if (!u.password) return u.toString();
    // URL setters percent-encode non-ASCII, so mask with ASCII and swap afterwards.
    u.password = 'MASKED';
    return u.toString().replace(':MASKED@', ':••••@');
  } catch {
    return '••••';
  }
}

function applyPatch<T extends Record<string, string | undefined>>(current: T, patch: Record<string, string | null | undefined> | undefined): T {
  if (!patch) return current;
  const next: Record<string, string | undefined> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next as T;
}

export class SettingsStore {
  private readonly path: string;
  private data: Settings;

  constructor(
    path: string = DEFAULT_SETTINGS_PATH,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {
    this.path = resolve(path);
    this.data = this.load();
  }

  private load(): Settings {
    if (!existsSync(this.path)) return settingsSchema.parse({});
    const parsed = settingsSchema.safeParse(JSON.parse(readFileSync(this.path, 'utf8')));
    if (!parsed.success) {
      throw new Error(`Invalid settings file ${this.path}: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
    }
    return parsed.data;
  }

  update(patch: SettingsPatch): void {
    const before = { llm: this.llm(), langfuse: this.langfuseEnv() };
    const next: Settings = {
      llm: applyPatch(this.data.llm, patch.llm),
      langfuse: applyPatch(this.data.langfuse, patch.langfuse),
      databases: applyPatch(this.data.databases, patch.databases) as Record<string, string>,
    };
    const checked = settingsSchema.parse(next);
    this.assertKeysFollowEndpoint(before, checked, patch);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(checked, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
    chmodSync(this.path, 0o600);
    this.data = checked;
  }

  /**
   * A key must not silently follow a changed endpoint: whoever controls the
   * new URL would receive it on the next call. Changing the LLM base URL or
   * the Langfuse host therefore needs the key(s) for it in the same save.
   */
  private assertKeysFollowEndpoint(
    before: { llm: ReturnType<SettingsStore['llm']>; langfuse: ReturnType<SettingsStore['langfuseEnv']> },
    next: Settings,
    patch: SettingsPatch
  ): void {
    const nextBase = next.llm.base_url ?? this.env.WHYDID_LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL;
    if (trimSlash(nextBase) !== trimSlash(before.llm.baseUrl) && before.llm.apiKey && typeof patch.llm?.api_key !== 'string') {
      throw new Error('Changing the base URL needs the API key for the new endpoint in the same save.');
    }
    const nextHost = next.langfuse.host ?? this.env.LANGFUSE_HOST ?? DEFAULT_LANGFUSE_HOST;
    const hadKeys = Boolean(before.langfuse.LANGFUSE_PUBLIC_KEY || before.langfuse.LANGFUSE_SECRET_KEY);
    const newKeys = typeof patch.langfuse?.public_key === 'string' && typeof patch.langfuse?.secret_key === 'string';
    if (trimSlash(nextHost) !== trimSlash(before.langfuse.LANGFUSE_HOST) && hadKeys && !newKeys) {
      throw new Error('Changing the Langfuse host needs the public and secret key for it in the same save.');
    }
  }

  llm(): { baseUrl: string; apiKey: string | undefined; model: string } {
    const s = this.data.llm;
    return {
      baseUrl: s.base_url ?? this.env.WHYDID_LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL,
      apiKey: s.api_key ?? (this.env.WHYDID_LLM_API_KEY || undefined),
      model: s.model ?? this.env.WHYDID_LLM_MODEL ?? DEFAULT_LLM_MODEL,
    };
  }

  /** Langfuse credentials in the shape the model source expects. */
  langfuseEnv(): { LANGFUSE_HOST?: string; LANGFUSE_PUBLIC_KEY?: string; LANGFUSE_SECRET_KEY?: string } {
    const s = this.data.langfuse;
    return {
      LANGFUSE_HOST: s.host ?? this.env.LANGFUSE_HOST ?? DEFAULT_LANGFUSE_HOST,
      LANGFUSE_PUBLIC_KEY: s.public_key ?? (this.env.LANGFUSE_PUBLIC_KEY || undefined),
      LANGFUSE_SECRET_KEY: s.secret_key ?? (this.env.LANGFUSE_SECRET_KEY || undefined),
    };
  }

  /** Database URL for a source: saved per source, else DATABASE_URL. */
  databaseUrl(sourceId: string): string | undefined {
    const own = Object.hasOwn(this.data.databases, sourceId) ? this.data.databases[sourceId] : undefined;
    return own ?? (this.env.DATABASE_URL || undefined);
  }

  /** Everything the admin page may see: masked secrets and where each value comes from. */
  publicView() {
    const field = (saved: string | undefined, envValue: string | undefined, fallback?: string, mask?: (v: string) => string): FieldView => {
      const show = (v: string) => (mask ? mask(v) : v);
      if (saved) return { value: show(saved), origin: 'saved' };
      if (envValue) return { value: show(envValue), origin: 'env' };
      if (fallback) return { value: fallback, origin: 'default' };
      return { value: null, origin: 'none' };
    };
    const s = this.data;
    return {
      llm: {
        base_url: field(s.llm.base_url, this.env.WHYDID_LLM_BASE_URL, DEFAULT_LLM_BASE_URL),
        api_key: field(s.llm.api_key, this.env.WHYDID_LLM_API_KEY, undefined, maskSecret),
        model: field(s.llm.model, this.env.WHYDID_LLM_MODEL, DEFAULT_LLM_MODEL),
      },
      langfuse: {
        host: field(s.langfuse.host, this.env.LANGFUSE_HOST, DEFAULT_LANGFUSE_HOST),
        public_key: field(s.langfuse.public_key, this.env.LANGFUSE_PUBLIC_KEY, undefined, maskSecret),
        secret_key: field(s.langfuse.secret_key, this.env.LANGFUSE_SECRET_KEY, undefined, maskSecret),
      },
      databases: {
        default: field(undefined, this.env.DATABASE_URL, undefined, maskDatabaseUrl),
        sources: Object.fromEntries(Object.entries(s.databases).map(([id, v]) => [id, maskDatabaseUrl(v)])),
      },
    };
  }
}
