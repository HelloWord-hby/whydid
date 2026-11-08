import { describe, expect, it } from 'vitest';
import { presetsFor } from '../agent/AskPopover';
import { markdownToHtml } from '../agent/markdown';
import { parseSseFrames } from './api';
import { deltaView, fmt } from './format';
import { initialLang, loc, t, tl } from './i18n';
import { addCard, cycleSize, KEY_PREFIX, loadLayout, moveCard, removeCard, resetLayout, saveLayout } from './layout';
import { type CatalogBoard, type CatalogCard } from './types';

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const card = (id: string, size = 1, extra: Partial<CatalogCard> = {}): CatalogCard => ({
  id, board: 'b', title: id, display: 'stat', provider: 'metric_stat', size, default: true, ...extra,
});
const cards = [card('a'), card('b', 2), card('c', 4)];
const board: CatalogBoard = {
  id: 'b', title: 'B', source: 's', source_kind: 'semantic', mode: 'live',
  default_layout: [{ id: 'a', size: 1 }, { id: 'b', size: 2 }],
};

describe('layout state', () => {
  it('falls back to the default and drops stale entries', () => {
    const s = memoryStore();
    expect(loadLayout(s, board, cards)).toEqual(board.default_layout);
    s.setItem(KEY_PREFIX + 'b', '{bad json');
    expect(loadLayout(s, board, cards)).toEqual(board.default_layout);
    s.setItem(KEY_PREFIX + 'b', JSON.stringify([{ id: 'gone', size: 1 }, { id: 'b', size: 9 }, { id: 'b', size: 1 }, null]));
    expect(loadLayout(s, board, cards)).toEqual([{ id: 'b', size: 2 }]);
  });

  it('saves, resets, and edits without mutating', () => {
    const s = memoryStore();
    saveLayout(s, 'b', [{ id: 'c', size: 4 }]);
    expect(loadLayout(s, board, cards)).toEqual([{ id: 'c', size: 4 }]);
    resetLayout(s, 'b');
    expect(loadLayout(s, board, cards)).toEqual(board.default_layout);

    const start = [{ id: 'a', size: 1 }];
    const added = addCard(start, cards[2]!, 0);
    expect(added).toEqual([{ id: 'c', size: 4 }, { id: 'a', size: 1 }]);
    expect(start).toEqual([{ id: 'a', size: 1 }]);
    expect(addCard(added, cards[2]!)).toEqual(added);
    expect(removeCard(added, 'c')).toEqual([{ id: 'a', size: 1 }]);
    expect(cycleSize(added, 'a')[1]).toEqual({ id: 'a', size: 2 });
    expect(cycleSize(added, 'c')[0]).toEqual({ id: 'c', size: 1 });
    expect(moveCard([{ id: 'a', size: 1 }, { id: 'b', size: 1 }, { id: 'c', size: 1 }], 'c', 'a').map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(moveCard(added, 'a', 'ghost')).toEqual(added);
  });
});

describe('formatting', () => {
  it('formats without changing the number', () => {
    expect(fmt(2166, 'int')).toBe('2,166');
    expect(fmt(0.1834, 'pct')).toBe('18.3%');
    expect(fmt(null, 'int')).toBe('—');
    expect(fmt('2026-11-04T20:03:00Z', 'datetime')).toBe('11-04 20:03');
  });

  it('colours a delta by the metric\'s good direction', () => {
    expect(deltaView({ delta: 0.046, delta_pct: 0.27, format: 'pct', good_direction: 'down' })).toEqual({ arrow: '▲', text: '4.6 pp', tone: 'bad' });
    expect(deltaView({ delta: -12, delta_pct: -0.059, format: 'int', good_direction: 'up' })).toEqual({ arrow: '▼', text: '5.9%', tone: 'bad' });
    expect(deltaView({ delta: null, delta_pct: null, format: 'int', good_direction: 'up' })).toBeNull();
  });
});

describe('i18n', () => {
  it('picks the saved language, else the browser language', () => {
    expect(initialLang({ getItem: () => 'en' }, 'zh-CN')).toBe('en');
    expect(initialLang({ getItem: () => null }, 'zh-CN')).toBe('zh');
    expect(initialLang({ getItem: () => null }, 'en-GB')).toBe('en');
  });

  it('localizes config text, server labels and captions', () => {
    expect(loc({ en: 'Sessions', zh: '会话' }, 'zh')).toBe('会话');
    expect(loc('Entry mix', 'zh')).toBe('入口分布');
    expect(loc('Entry mix', 'en')).toBe('Entry mix');
    expect(tl('Low rate', 'zh')).toBe('低分率');
    expect(tl('Low = score below 0.5 · faithfulness only', 'zh')).toBe('低分 = 分数低于 0.5 · 仅 faithfulness');
    expect(tl('Sessions by Entry point', 'zh')).toBe('会话数 · 按入口');
    expect(tl('Unknown label', 'zh')).toBe('Unknown label');
    expect(t('zh', 'top.window', { n: 7 })).toBe('近 7 天');
  });
});

describe('agent helpers', () => {
  it('parses complete SSE frames and keeps the remainder', () => {
    const { events, rest } = parseSseFrames('event: text\ndata: {"type":"text","text":"a"}\n\nevent: done\ndata: {"type":');
    expect(events).toEqual([{ type: 'text', text: 'a' }]);
    expect(rest).toBe('event: done\ndata: {"type":');
  });

  it('renders markdown safely and turns refs into citation buttons', () => {
    const html = markdownToHtml('**Conclusion** — fell 5.9% [#2]\n\n- a <script>x</script>\n- b');
    expect(html).toContain('<strong>Conclusion</strong>');
    expect(html).toContain('<button type="button" class="cite" data-ref="2">#2</button>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<ul><li>');
  });

  it('builds card presets by display, configured ask first', () => {
    expect(presetsFor(card('x', 1, { title: 'Sessions' }), 7, 'en')[0]).toBe('Why did Sessions change vs the previous 7 days?');
    expect(presetsFor(card('x', 1, { display: 'table', provider: 'low_score_samples' }), 7, 'zh')[0]).toBe('这些样本有什么共同问题？');
    expect(presetsFor(card('x', 1, { ask: { en: 'Custom?', zh: '自定义？' } }), 7, 'zh')[0]).toBe('自定义？');
  });
});
