/**
 * Write a value back into an existing YAML file while keeping what people
 * wrote by hand: comments, blank lines, flow style ({en: …, zh: …}) and key
 * order survive on every node whose value did not change.
 *
 * The new value is merged into the parsed document node by node. Lists of
 * objects with an `id` (boards, cards) are matched by id, so reordering or
 * deleting a card keeps the comments of the others. A file whose content is
 * unchanged is not written at all.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Document, isMap, isScalar, isSeq, parseDocument, type Node } from 'yaml';

type Plain = Record<string, unknown>;

const FORMAT = { lineWidth: 0 } as const;

const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural equality, ignoring key order. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function keyOf(key: unknown): unknown {
  return isScalar(key) ? key.value : key;
}

function idOf(node: unknown): string | undefined {
  if (!isMap(node)) return undefined;
  const id = node.get('id');
  return typeof id === 'string' ? id : undefined;
}

/** Merge `next` into `node`; returns the node to keep (the same one when it could be updated in place). */
function merge(doc: Document, node: unknown, next: unknown): unknown {
  if (isMap(node) && isPlain(next)) {
    for (const pair of [...node.items]) {
      const k = keyOf(pair.key);
      if (typeof k !== 'string' || !Object.hasOwn(next, k)) node.delete(pair.key);
    }
    for (const [k, v] of Object.entries(next)) {
      const child = node.get(k, true);
      if (child === undefined) node.set(k, doc.createNode(v));
      else {
        const merged = merge(doc, child, v);
        if (merged !== child) node.set(k, merged);
      }
    }
    return node;
  }
  if (isSeq(node) && Array.isArray(next)) {
    const byId = next.every((v) => isPlain(v) && typeof v.id === 'string');
    if (byId) {
      const old = new Map<string, unknown>();
      for (const item of node.items) {
        const id = idOf(item);
        if (id && !old.has(id)) old.set(id, item);
      }
      // New entries get a blank line before them when the list already uses blank lines.
      const spaced = node.items.slice(1).some((item) => (item as Node).spaceBefore);
      node.items = next.map((v) => {
        const prev = old.get((v as Plain).id as string);
        if (prev) return merge(doc, prev, v) as (typeof node.items)[number];
        const created = doc.createNode(v);
        if (spaced) created.spaceBefore = true;
        return created as (typeof node.items)[number];
      });
    } else {
      node.items = next.map((v, i) => (i < node.items.length ? merge(doc, node.items[i], v) : doc.createNode(v)) as (typeof node.items)[number]);
    }
    return node;
  }
  if (isScalar(node) && !isPlain(next) && !Array.isArray(next) && node.value === next) return node;
  return doc.createNode(next) as Node;
}

/** Render `value` as YAML, merged into `existing` source text when there is one. */
export function mergeYaml(existing: string | null, value: Plain): string {
  if (existing === null) return new Document(value).toString(FORMAT);
  const doc = parseDocument(existing);
  if (!isMap(doc.contents)) return new Document(value).toString(FORMAT);
  merge(doc, doc.contents, value);
  return doc.toString(FORMAT);
}

/** Write `value` to a YAML file, keeping hand-written formatting. Returns false when nothing changed. */
export function writeYaml(path: string, value: Plain): boolean {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (existing !== null && deepEqual(parseDocument(existing).toJS(), value)) return false;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, mergeYaml(existing, value));
  renameSync(tmp, path);
  return true;
}
