/**
 * The editable configuration as one bundle: the boards file, the semantic
 * layer of every semantic source, and the main semantic config.
 *
 * The admin page edits a draft bundle and saves it whole. The server
 * validates the draft completely before any file is written, then writes
 * each changed file back as YAML, keeping comments and layout of the parts
 * that did not change (src/admin/yaml-merge.ts). Raw objects are stored,
 * not zod output, so defaults the user never set are not spelled out.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { writeYaml } from './yaml-merge.js';
import { parseBoardsConfig } from '../boards/service.js';
import { type BoardsConfig } from '../boards/schema.js';
import { configSchema, validateConfig, type WhydidConfig } from '../config/schema.js';

export interface ConfigFiles {
  /** Boards file, relative to the working directory or absolute. */
  boards: string;
  /** Main semantic config (the agent's "main" source and the Metrics page). */
  main: string;
}

export interface ConfigBundle {
  boards: Record<string, unknown>;
  /** Raw semantic config per semantic source id. */
  semantic: Record<string, unknown>;
  main: unknown;
}

export interface ValidBundle {
  boards: BoardsConfig;
  semantic: Map<string, WhydidConfig>;
  main: WhydidConfig;
  /** Semantic config path per source, relative to the boards file's directory. */
  paths: Record<string, string>;
  /** The raw bundle with config paths filled in, as it will be written. */
  raw: ConfigBundle;
}

function readYaml(path: string): unknown {
  return parse(readFileSync(path, 'utf8'));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function boardsBaseDir(files: ConfigFiles): string {
  return dirname(resolve(files.boards));
}

export function readBundle(files: ConfigFiles): ConfigBundle {
  const boards = readYaml(resolve(files.boards));
  if (!isRecord(boards)) throw new Error(`${files.boards} is not a YAML mapping.`);
  const base = boardsBaseDir(files);
  const semantic: Record<string, unknown> = {};
  const sources = isRecord(boards.sources) ? boards.sources : {};
  for (const [id, src] of Object.entries(sources)) {
    if (isRecord(src) && src.kind === 'semantic' && typeof src.config === 'string') {
      const p = resolve(base, src.config);
      semantic[id] = existsSync(p) ? readYaml(p) : {};
    }
  }
  return { boards, semantic, main: readYaml(resolve(files.main)) };
}

/** The real path of `p`, or of its nearest existing ancestor joined with the rest. */
function realish(p: string): string {
  let cur = p;
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.unshift(cur.slice(parent.length + 1));
    cur = parent;
  }
  return join(realpathSync(cur), ...rest);
}

/**
 * A semantic config path must be a relative .yaml file inside the boards
 * directory, also after following symlinks.
 */
export function checkSemanticPath(base: string, path: string): string {
  if (isAbsolute(path)) throw new Error(`Semantic config path "${path}" must be relative.`);
  const abs = resolve(base, path);
  const rel = relative(base, abs);
  if (rel.startsWith('..') || rel.split(sep).includes('..')) throw new Error(`Semantic config path "${path}" leaves the config directory.`);
  if (!['.yaml', '.yml'].includes(extname(abs).toLowerCase())) throw new Error(`Semantic config path "${path}" must end in .yaml.`);
  const realBase = realpathSync(base);
  if (relative(realBase, realish(abs)).startsWith('..')) throw new Error(`Semantic config path "${path}" points outside the config directory.`);
  return rel.split(sep).join('/');
}

/** Semantic config paths of the boards file on disk, by source id. */
function currentSemanticPaths(files: ConfigFiles): Record<string, string> {
  const raw = readYaml(resolve(files.boards));
  const sources = isRecord(raw) && isRecord(raw.sources) ? raw.sources : {};
  const out: Record<string, string> = {};
  for (const [id, src] of Object.entries(sources)) {
    if (isRecord(src) && src.kind === 'semantic' && typeof src.config === 'string') out[id] = src.config.replace(/\\/g, '/').replace(/^\.\//, '');
  }
  return out;
}

function parseSemantic(raw: unknown, where: string): WhydidConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Semantic layer ${where}: ${issues}`);
  }
  try {
    return validateConfig(parsed.data);
  } catch (err) {
    throw new Error(`Semantic layer ${where}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Validate every part of a draft bundle; throws with a message that names the part. */
export function validateBundle(files: ConfigFiles, draft: ConfigBundle): ValidBundle {
  const base = boardsBaseDir(files);
  // Compared case-insensitively: macOS and Windows file systems usually are.
  const key = (p: string) => p.toLowerCase();
  const reserved = new Set([files.main, files.boards].map((f) => key(relative(base, resolve(f)).split(sep).join('/'))));
  const onDisk = currentSemanticPaths(files);
  const rawSources = isRecord(draft.boards.sources) ? draft.boards.sources : {};
  const sources: Record<string, unknown> = {};
  const paths: Record<string, string> = {};
  for (const [id, src] of Object.entries(rawSources)) {
    if (isRecord(src) && src.kind === 'semantic') {
      const given = typeof src.config === 'string' && src.config.trim() ? src.config.trim() : `semantic/${id}.yaml`;
      const path = checkSemanticPath(base, given);
      if (reserved.has(key(path))) throw new Error(`Source "${id}": ${path} is a whydid config file, not a semantic layer of a board source.`);
      if (Object.values(paths).some((p) => key(p) === key(path))) throw new Error(`Source "${id}": another source already uses ${path}.`);
      // A source may keep its own file; a new or moved path must not overwrite an existing file.
      if (key(onDisk[id] ?? '') !== key(path) && existsSync(join(base, path))) {
        throw new Error(`Source "${id}": ${path} already exists. Choose a new file name for this semantic layer.`);
      }
      paths[id] = path;
      sources[id] = { ...src, config: path };
    } else {
      sources[id] = src;
    }
  }
  const rawBoards = { ...draft.boards, sources };
  const boards = parseBoardsConfig(rawBoards);
  const semantic = new Map<string, WhydidConfig>();
  for (const id of Object.keys(paths)) {
    if (!Object.hasOwn(draft.semantic, id)) throw new Error(`Source "${id}" has no semantic layer yet.`);
    semantic.set(id, parseSemantic(draft.semantic[id], `"${id}"`));
  }
  const main = parseSemantic(draft.main, '"main"');
  const keptSemantic = Object.fromEntries(Object.keys(paths).map((id) => [id, draft.semantic[id]]));
  return { boards, semantic, main, paths, raw: { boards: rawBoards, semantic: keptSemantic, main: draft.main } };
}

export function writeBundle(files: ConfigFiles, valid: ValidBundle): void {
  const base = boardsBaseDir(files);
  for (const [id, path] of Object.entries(valid.paths)) {
    writeYaml(join(base, path), valid.raw.semantic[id] as Record<string, unknown>);
  }
  writeYaml(resolve(files.main), valid.raw.main as Record<string, unknown>);
  writeYaml(resolve(files.boards), valid.raw.boards);
}
