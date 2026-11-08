import { beforeAll, describe, expect, it } from 'vitest';

interface Entry {
  id: string;
  size: number;
}
interface LayoutApi {
  KEY_PREFIX: string;
  load(storage: Storage, board: { id: string; default_layout: Entry[] }, cards: Entry[]): Entry[];
  save(storage: Storage, boardId: string, layout: Entry[]): void;
  reset(storage: Storage, boardId: string): void;
  add(layout: Entry[], card: Entry, index?: number): Entry[];
  remove(layout: Entry[], id: string): Entry[];
  cycleSize(layout: Entry[], id: string): Entry[];
  reorder(layout: Entry[], ids: string[]): Entry[];
}

let L: LayoutApi;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

const cards: Entry[] = [
  { id: 'a', size: 1 },
  { id: 'b', size: 2 },
  { id: 'c', size: 4 },
];
const board = {
  id: 'demo',
  default_layout: [
    { id: 'a', size: 1 },
    { id: 'b', size: 2 },
  ],
};

beforeAll(async () => {
  // Plain browser script: attaches WhydidLayout to globalThis.
  // @ts-expect-error — no type declarations for the web bundle.
  await import('../web/layout.js');
  L = (globalThis as unknown as { WhydidLayout: LayoutApi }).WhydidLayout;
});

describe('dashboard layout state', () => {
  it('falls back to the default layout when nothing or garbage is stored', () => {
    const s = memoryStorage();
    expect(L.load(s, board, cards)).toEqual(board.default_layout);
    s.setItem(L.KEY_PREFIX + 'demo', '{not json');
    expect(L.load(s, board, cards)).toEqual(board.default_layout);
  });

  it('round-trips a saved layout and drops stale or invalid entries', () => {
    const s = memoryStorage();
    L.save(s, 'demo', [
      { id: 'c', size: 4 },
      { id: 'a', size: 1 },
    ]);
    expect(L.load(s, board, cards)).toEqual([
      { id: 'c', size: 4 },
      { id: 'a', size: 1 },
    ]);
    s.setItem(
      L.KEY_PREFIX + 'demo',
      JSON.stringify([{ id: 'gone', size: 1 }, { id: 'b', size: 9 }, { id: 'b', size: 1 }, null])
    );
    expect(L.load(s, board, cards)).toEqual([{ id: 'b', size: 2 }]);
  });

  it('reset removes the saved layout', () => {
    const s = memoryStorage();
    L.save(s, 'demo', [{ id: 'c', size: 4 }]);
    L.reset(s, 'demo');
    expect(L.load(s, board, cards)).toEqual(board.default_layout);
  });

  it('adds, removes, resizes and reorders without mutating the input', () => {
    const start = [{ id: 'a', size: 1 }];
    const added = L.add(start, cards[2]!, 0);
    expect(added).toEqual([
      { id: 'c', size: 4 },
      { id: 'a', size: 1 },
    ]);
    expect(start).toEqual([{ id: 'a', size: 1 }]);
    expect(L.add(added, cards[2]!)).toEqual(added);
    expect(L.remove(added, 'c')).toEqual([{ id: 'a', size: 1 }]);
    expect(L.cycleSize(added, 'a')).toEqual([
      { id: 'c', size: 4 },
      { id: 'a', size: 2 },
    ]);
    expect(L.cycleSize(added, 'c')[0]).toEqual({ id: 'c', size: 1 });
    expect(L.reorder(added, ['a', 'c', 'zzz'])).toEqual([
      { id: 'a', size: 1 },
      { id: 'c', size: 4 },
    ]);
  });
});
