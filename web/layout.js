/**
 * Board layout state — pure functions, no DOM. A layout is an ordered
 * list of {id, size}. Saved per board in localStorage; anything stale
 * (cards removed from the config, bad sizes, duplicates) is dropped on load.
 *
 * Loaded as a plain script in the browser and imported by the tests.
 */
(function (root) {
  'use strict';

  const KEY_PREFIX = 'whydid.layout.v1.';
  const MIN_SIZE = 1;
  const MAX_SIZE = 4;

  function clampSize(n, fallback) {
    const v = Number(n);
    if (!Number.isInteger(v) || v < MIN_SIZE || v > MAX_SIZE) return fallback;
    return v;
  }

  /**
   * Keep only entries whose id is a card of this board, at most once,
   * with a valid size. `cards` is the board's catalog card list.
   */
  function sanitize(layout, cards) {
    if (!Array.isArray(layout)) return null;
    const byId = new Map(cards.map(function (c) { return [c.id, c]; }));
    const seen = new Set();
    const out = [];
    layout.forEach(function (entry) {
      if (!entry || typeof entry.id !== 'string') return;
      const card = byId.get(entry.id);
      if (!card || seen.has(entry.id)) return;
      seen.add(entry.id);
      out.push({ id: entry.id, size: clampSize(entry.size, card.size) });
    });
    return out;
  }

  function load(storage, board, cards) {
    try {
      const raw = storage.getItem(KEY_PREFIX + board.id);
      if (raw == null) return board.default_layout.slice();
      const parsed = sanitize(JSON.parse(raw), cards);
      return parsed == null ? board.default_layout.slice() : parsed;
    } catch (_) {
      return board.default_layout.slice();
    }
  }

  function save(storage, boardId, layout) {
    storage.setItem(KEY_PREFIX + boardId, JSON.stringify(layout));
  }

  function reset(storage, boardId) {
    storage.removeItem(KEY_PREFIX + boardId);
  }

  /** Insert a card at index (end when index is out of range); no-op if present. */
  function add(layout, card, index) {
    if (layout.some(function (e) { return e.id === card.id; })) return layout.slice();
    const out = layout.slice();
    const at = index == null || index < 0 || index > out.length ? out.length : index;
    out.splice(at, 0, { id: card.id, size: card.size });
    return out;
  }

  function remove(layout, id) {
    return layout.filter(function (e) { return e.id !== id; });
  }

  /** Cycle 1 → 2 → 4 → 1 columns. */
  function cycleSize(layout, id) {
    const next = { 1: 2, 2: 4, 3: 4, 4: 1 };
    return layout.map(function (e) {
      return e.id === id ? { id: e.id, size: next[e.size] || 1 } : e;
    });
  }

  /** Rebuild the layout in the given id order, keeping sizes. */
  function reorder(layout, ids) {
    const byId = new Map(layout.map(function (e) { return [e.id, e]; }));
    return ids.filter(function (id) { return byId.has(id); }).map(function (id) { return byId.get(id); });
  }

  root.WhydidLayout = {
    KEY_PREFIX: KEY_PREFIX,
    sanitize: sanitize,
    load: load,
    save: save,
    reset: reset,
    add: add,
    remove: remove,
    cycleSize: cycleSize,
    reorder: reorder,
  };
})(typeof window !== 'undefined' ? window : globalThis);
