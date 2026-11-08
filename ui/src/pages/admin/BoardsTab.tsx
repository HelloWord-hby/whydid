/** Boards and their cards: create, rename, rebind, reorder, and open the card editor. */
import { ArrowDown, ArrowUp, LayoutDashboard, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app-state';
import { Button, CardShell, cn, IconChip } from '../../components/ui';
import { loc } from '../../lib/i18n';
import { useAdmin } from './admin-state';
import { CardEditor } from './CardEditor';
import { Field, LocalizedInput, NativeSelect, TextInput, toId, useT } from './form';
import { type Bundle, type RawCard } from './types';

function newCard(d: Bundle, boardId: string, providers: Array<{ name: string; source: string; displays: string[] }>): RawCard {
  const board = d.boards.boards.find((b) => b.id === boardId)!;
  const kind = d.boards.sources[board.source]?.kind;
  const p = providers.find((x) => x.source === kind)!;
  return { id: toId('card', d.boards.cards.map((c) => c.id), 'card'), board: boardId, title: 'New card', display: p.displays[0]!, provider: p.name };
}

export function BoardsTab() {
  const t = useT();
  const { lang } = useApp();
  const { draft, edit, overview } = useAdmin();
  const boards = draft!.boards.boards;
  const [selected, setSelected] = useState<string>(boards[0]?.id ?? '');
  const [editing, setEditing] = useState<{ index: number; isNew: boolean } | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newSource, setNewSource] = useState(Object.keys(draft!.boards.sources)[0] ?? '');
  const bi = boards.findIndex((b) => b.id === selected);
  const board = boards[bi] ?? boards[0];
  const sourceIds = Object.keys(draft!.boards.sources);
  const cards = draft!.boards.cards.map((c, index) => ({ c, index })).filter(({ c }) => c.board === board?.id);

  if (editing && draft!.boards.cards[editing.index]) {
    return (
      <CardEditor
        index={editing.index}
        isNew={editing.isNew}
        onClose={(keep) => {
          if (!keep) edit((d) => d.boards.cards.splice(editing.index, 1));
          setEditing(null);
        }}
      />
    );
  }

  const addBoard = () => {
    const id = toId(newTitle, boards.map((b) => b.id), 'board');
    edit((d) => d.boards.boards.push({ id, title: newTitle, source: newSource }));
    setSelected(id);
    setNewTitle('');
  };
  const addCard = () => {
    const index = draft!.boards.cards.length;
    edit((d) => d.boards.cards.push(newCard(d, board!.id, overview!.providers)));
    setEditing({ index, isNew: true });
  };
  /** Swap with the previous/next card of the same board; file order is the default layout order. */
  const move = (index: number, dir: -1 | 1) => {
    const pos = cards.findIndex((x) => x.index === index);
    const other = cards[pos + dir];
    if (!other) return;
    edit((d) => {
      const list = d.boards.cards;
      [list[index], list[other.index]] = [list[other.index]!, list[index]!];
    });
  };
  const removeBoard = () => {
    if (!board || !window.confirm(t(`Delete board "${board.id}" and its ${cards.length} cards?`, `删除看板「${board.id}」和它的 ${cards.length} 张卡片？`))) return;
    edit((d) => {
      d.boards.boards = d.boards.boards.filter((b) => b.id !== board.id);
      d.boards.cards = d.boards.cards.filter((c) => c.board !== board.id);
    });
    setSelected(boards.find((b) => b.id !== board.id)?.id ?? '');
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <CardShell className="flex flex-col gap-1 p-3">
        <div className="mb-1 px-1 text-[11.5px] font-medium text-muted-foreground">{t('Boards', '看板')}</div>
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setSelected(b.id)}
            className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]', b.id === board?.id ? 'bg-popover font-medium shadow-emboss-sm' : 'hover:bg-muted')}
          >
            <LayoutDashboard size={14} className={b.id === board?.id ? 'text-primary' : 'text-muted-foreground'} />
            <span className="truncate">{loc(b.title, lang) || b.id}</span>
          </button>
        ))}
        <div className="mt-3 flex flex-col gap-2 border-t border-border/70 px-1 pt-3">
          <Field label={t('New board', '新建看板')}><TextInput value={newTitle} onChange={setNewTitle} placeholder={t('Title', '标题')} /></Field>
          <NativeSelect value={newSource} onChange={setNewSource} options={sourceIds.map((s) => ({ value: s, label: `${s} · ${draft!.boards.sources[s]!.kind}` }))} />
          <Button size="sm" onClick={addBoard} disabled={!newTitle.trim() || !newSource}><Plus size={13} /> {t('Add board', '添加看板')}</Button>
        </div>
      </CardShell>

      {board ? (
        <div className="flex min-w-0 flex-col gap-4">
          <CardShell className="p-5">
            <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
              <IconChip icon={LayoutDashboard} /> {t('Board', '看板')} <code className="text-[12px] font-normal text-muted-foreground">{board.id}</code>
              <Button size="sm" variant="ghost" className="ml-auto text-bad" onClick={removeBoard} disabled={boards.length <= 1}><Trash2 size={13} /> {t('Delete board', '删除看板')}</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_200px]">
              <Field label={t('Title', '标题')}><LocalizedInput value={board.title} onChange={(v) => edit((d) => (d.boards.boards[bi]!.title = v ?? board.id))} /></Field>
              <Field label={t('Data source', '数据源')} hint={t('Cards must match the source kind', '卡片要和数据源类型匹配')}>
                <NativeSelect value={board.source} onChange={(v) => edit((d) => (d.boards.boards[bi]!.source = v))} options={sourceIds.map((s) => ({ value: s, label: `${s} · ${draft!.boards.sources[s]!.kind}` }))} />
              </Field>
              <Field label={t('Description', '说明')} className="md:col-span-2">
                <LocalizedInput
                  value={board.description}
                  onChange={(v) =>
                    edit((d) => {
                      if (v === undefined) delete d.boards.boards[bi]!.description;
                      else d.boards.boards[bi]!.description = v;
                    })
                  }
                />
              </Field>
            </div>
          </CardShell>

          <CardShell className="p-5">
            <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
              {t('Cards', '卡片')} <span className="text-[12px] font-normal text-muted-foreground">{cards.length}</span>
              <Button size="sm" variant="primary" className="ml-auto" onClick={addCard}><Plus size={13} /> {t('Add card', '添加卡片')}</Button>
            </div>
            <div className="flex flex-col">
              {cards.map(({ c, index }, pos) => (
                <div key={index} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border/70 py-2 first:border-t-0">
                  <button type="button" onClick={() => setEditing({ index, isNew: false })} className="min-w-0 cursor-pointer text-left">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{loc(c.title, lang) || c.id}</span>
                      {c.default && <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10.5px] text-primary">{t('default', '默认')}</span>}
                    </div>
                    <div className="truncate text-[11.5px] text-muted-foreground"><code>{c.id}</code> · {c.provider} · {c.display} · {c.size ?? 1}/4</div>
                  </button>
                  <div className="flex items-center gap-0.5 text-muted-foreground">
                    <button type="button" title={t('Move up', '上移')} disabled={pos === 0} onClick={() => move(index, -1)} className="rounded-md p-1.5 hover:bg-muted disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button type="button" title={t('Move down', '下移')} disabled={pos === cards.length - 1} onClick={() => move(index, 1)} className="rounded-md p-1.5 hover:bg-muted disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button type="button" title={t('Edit', '编辑')} onClick={() => setEditing({ index, isNew: false })} className="rounded-md p-1.5 hover:bg-muted"><Pencil size={14} /></button>
                    <button type="button" title={t('Delete', '删除')} onClick={() => edit((d) => d.boards.cards.splice(index, 1))} className="rounded-md p-1.5 hover:bg-muted hover:text-bad"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              {cards.length === 0 && <p className="py-4 text-center text-[12.5px] text-muted-foreground">{t('No cards yet.', '还没有卡片。')}</p>}
            </div>
          </CardShell>
        </div>
      ) : (
        <CardShell className="p-6 text-[13px] text-muted-foreground">{t('Add a board to start.', '先添加一个看板。')}</CardShell>
      )}
    </div>
  );
}
