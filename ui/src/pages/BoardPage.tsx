/**
 * A board: its configured cards in a 12-column grid, sortable with dnd-kit,
 * plus a card library whose items can be dragged onto the board or added.
 * Generic over the catalog — nothing here knows which cards exist.
 */
import {
  closestCenter, DndContext, DragOverlay, PointerSensor, useDraggable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { LibraryBig, Plus, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app-state';
import { useAgent } from '../agent/agent-state';
import { BoardCard, iconFor } from '../components/BoardCard';
import { Button, CardShell, cn, IconChip } from '../components/ui';
import { loc } from '../lib/i18n';
import { addCard, cycleSize, loadLayout, moveCard, removeCard, resetLayout, saveLayout } from '../lib/layout';
import { type CatalogBoard, type CatalogCard, type LayoutEntry } from '../lib/types';

const LIB_PREFIX = 'lib:';

function LibraryItem({ card, onBoard, onAdd }: { card: CatalogCard; onBoard: boolean; onAdd: () => void }) {
  const { lang, tr } = useApp();
  const drag = useDraggable({ id: LIB_PREFIX + card.id, disabled: onBoard });
  return (
    <div
      ref={drag.setNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      className={cn(
        'flex items-center gap-2 rounded-xl border border-border bg-popover px-2.5 py-2 shadow-emboss-sm',
        onBoard ? 'opacity-50' : 'cursor-grab hover:border-primary/40',
        drag.isDragging && 'opacity-30'
      )}
    >
      <IconChip icon={iconFor(card)} size={22} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium">{loc(card.title, lang)}</div>
        <div className="font-mono text-[10.5px] text-muted-foreground">{card.display} · {card.provider}</div>
      </div>
      {onBoard ? (
        <span className="text-[11px] text-muted-foreground">{tr('lib.on')}</span>
      ) : (
        <Button size="sm" variant="outline" onPointerDown={(e) => e.stopPropagation()} onClick={onAdd}>
          <Plus size={13} /> {tr('lib.add')}
        </Button>
      )}
    </div>
  );
}

export function BoardPage({ board, cards }: { board: CatalogBoard; cards: CatalogCard[] }) {
  const { tr, lang, days } = useApp();
  const agent = useAgent();
  const [layout, setLayout] = useState<LayoutEntry[]>(() => loadLayout(localStorage, board, cards));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => setLayout(loadLayout(localStorage, board, cards)), [board, cards]);
  useEffect(() => {
    agent.setBoardContext({ id: board.id, title: loc(board.title, lang), days });
    return () => agent.setBoardContext(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id, lang, days]);

  const update = (next: LayoutEntry[]) => {
    setLayout(next);
    saveLayout(localStorage, board.id, next);
  };

  const onDragStart = (e: DragStartEvent) => setDragging(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (active.startsWith(LIB_PREFIX)) {
      const card = byId.get(active.slice(LIB_PREFIX.length));
      if (!card) return;
      const at = over ? layout.findIndex((x) => x.id === over) : -1;
      update(addCard(layout, card, at >= 0 ? at : undefined));
    } else if (over && over !== active) {
      update(moveCard(layout, active, over));
    }
  };

  const onBoard = new Set(layout.map((e) => e.id));
  const draggedLib = dragging?.startsWith(LIB_PREFIX) ? byId.get(dragging.slice(LIB_PREFIX.length)) : undefined;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[11.5px] font-medium',
            board.mode === 'demo' ? 'bg-warn/15 text-[oklch(0.5_0.1_60)] dark:text-warn' : 'bg-good/15 text-good'
          )}
        >
          {board.mode === 'demo' ? tr('board.demo') : board.source_kind === 'model_output' ? tr('board.live.langfuse') : tr('board.live.pg')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {agent.status && (
            <Button
              variant="dark"
              disabled={agent.running || !agent.status.llm_configured}
              onClick={() => agent.send(tr('board.analyzePrompt', { board: loc(board.title, lang), n: days }), { entry: 'board' })}
            >
              <Sparkles size={14} /> {tr('board.analyze')}
            </Button>
          )}
          <Button variant={libraryOpen ? 'primary' : 'outline'} onClick={() => setLibraryOpen((o) => !o)}>
            <LibraryBig size={14} /> {tr('board.library')}
          </Button>
          <Button variant="ghost" onClick={() => {
            resetLayout(localStorage, board.id);
            setLayout(board.default_layout.slice());
          }}>
            <RotateCcw size={14} /> {tr('board.reset')}
          </Button>
        </div>
      </div>

      {libraryOpen && (
        <CardShell className="mb-4 p-4">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-[14px] font-semibold">{tr('lib.title')}</span>
            <span className="text-[12px] text-muted-foreground">{tr('lib.hint', { n: cards.length })}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((c) => (
              <LibraryItem key={c.id} card={c} onBoard={onBoard.has(c.id)} onAdd={() => update(addCard(layout, c))} />
            ))}
          </div>
        </CardShell>
      )}

      <SortableContext items={layout.map((e) => e.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-12 gap-4">
          {layout.map((e) => {
            const card = byId.get(e.id);
            return card ? (
              <BoardCard
                key={e.id}
                card={card}
                size={e.size}
                onResize={() => update(cycleSize(layout, e.id))}
                onRemove={() => update(removeCard(layout, e.id))}
              />
            ) : null;
          })}
          {!layout.length && (
            <div className="col-span-12 rounded-2xl border-2 border-dashed border-border p-10 text-center text-muted-foreground">
              {tr('board.empty')}
            </div>
          )}
        </div>
      </SortableContext>
      <DragOverlay>
        {draggedLib && (
          <div className="rounded-xl border border-primary/50 bg-popover px-3 py-2 text-[12.5px] font-medium shadow-emboss">{loc(draggedLib.title, lang)}</div>
        )}
      </DragOverlay>
      <p className="mt-5 text-[11.5px] text-muted-foreground">{tr('board.foot', { n: days })}</p>
    </DndContext>
  );
}
