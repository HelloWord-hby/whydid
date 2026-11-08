/**
 * Board layout state — pure functions, no DOM. A layout is an ordered list
 * of {id, size}; sizes are 1–4 quarter-widths. Saved per board in
 * localStorage; stale entries (removed cards, bad sizes, duplicates) are
 * dropped on load.
 */
import { type CatalogBoard, type CatalogCard, type LayoutEntry } from './types';

export const KEY_PREFIX = 'whydid.layout.v2.';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function clampSize(n: unknown, fallback: number): number {
  const v = Number(n);
  return Number.isInteger(v) && v >= 1 && v <= 4 ? v : fallback;
}

export function sanitize(layout: unknown, cards: CatalogCard[]): LayoutEntry[] | null {
  if (!Array.isArray(layout)) return null;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: LayoutEntry[] = [];
  for (const entry of layout as Array<Partial<LayoutEntry> | null>) {
    if (!entry || typeof entry.id !== 'string') continue;
    const card = byId.get(entry.id);
    if (!card || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({ id: entry.id, size: clampSize(entry.size, card.size) });
  }
  return out;
}

export function loadLayout(store: Store, board: CatalogBoard, cards: CatalogCard[]): LayoutEntry[] {
  try {
    const raw = store.getItem(KEY_PREFIX + board.id);
    if (raw == null) return board.default_layout.slice();
    return sanitize(JSON.parse(raw), cards) ?? board.default_layout.slice();
  } catch {
    return board.default_layout.slice();
  }
}

export function saveLayout(store: Store, boardId: string, layout: LayoutEntry[]): void {
  store.setItem(KEY_PREFIX + boardId, JSON.stringify(layout));
}

export function resetLayout(store: Store, boardId: string): void {
  store.removeItem(KEY_PREFIX + boardId);
}

export function addCard(layout: LayoutEntry[], card: CatalogCard, index?: number): LayoutEntry[] {
  if (layout.some((e) => e.id === card.id)) return layout.slice();
  const out = layout.slice();
  const at = index == null || index < 0 || index > out.length ? out.length : index;
  out.splice(at, 0, { id: card.id, size: card.size });
  return out;
}

export function removeCard(layout: LayoutEntry[], id: string): LayoutEntry[] {
  return layout.filter((e) => e.id !== id);
}

const NEXT_SIZE: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 1 };

export function cycleSize(layout: LayoutEntry[], id: string): LayoutEntry[] {
  return layout.map((e) => (e.id === id ? { id: e.id, size: NEXT_SIZE[e.size] ?? 1 } : e));
}

export function moveCard(layout: LayoutEntry[], fromId: string, toId: string): LayoutEntry[] {
  const from = layout.findIndex((e) => e.id === fromId);
  const to = layout.findIndex((e) => e.id === toId);
  if (from < 0 || to < 0 || from === to) return layout.slice();
  const out = layout.slice();
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved!);
  return out;
}
