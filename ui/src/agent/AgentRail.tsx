/** Docked agent rail: conversation, live tool calls, citations, grounding, input. */
import { ArrowUp, ChevronDown, ChevronRight, Loader2, Plus, Sparkles, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useApp } from '../app-state';
import { cn } from '../components/ui';
import { type AgentEvent } from '../lib/types';
import { useAgent, type Turn } from './agent-state';
import { markdownToHtml } from './markdown';

const WIDTH_KEY = 'whydid.agent.width';

interface Step {
  ref: number;
  tool: string;
  args: unknown;
  injected: boolean;
  end?: Extract<AgentEvent, { type: 'tool_end' }>;
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function TurnView({ turn, highlight, onCite }: { turn: Turn; highlight: number | null; onCite: (ref: number) => void }) {
  const { tr } = useApp();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [openRefs, setOpenRefs] = useState<Set<number>>(new Set());

  const { steps, texts, answer, done, error } = useMemo(() => {
    const steps = new Map<number, Step>();
    const texts: string[] = [];
    let answer: Extract<AgentEvent, { type: 'answer' }> | undefined;
    let done: Extract<AgentEvent, { type: 'done' }> | undefined;
    let error: string | undefined;
    for (const e of turn.events) {
      if (e.type === 'tool_start') steps.set(e.ref, { ref: e.ref, tool: e.tool, args: e.args, injected: e.injected });
      else if (e.type === 'tool_end') {
        const s = steps.get(e.ref);
        if (s) steps.set(e.ref, { ...s, end: e });
      } else if (e.type === 'text') texts.push(e.text);
      else if (e.type === 'answer') answer = e;
      else if (e.type === 'done') done = e;
      else if (e.type === 'error') error = e.message;
    }
    return { steps: [...steps.values()], texts, answer, done, error };
  }, [turn.events]);

  useEffect(() => {
    if (highlight != null && steps.some((s) => s.ref === highlight)) {
      setExpanded(true);
      setOpenRefs((o) => new Set(o).add(highlight));
    }
  }, [highlight, steps]);

  const finished = Boolean(answer || error);
  const showSteps = expanded ?? !finished;
  const html = useMemo(() => (answer ? markdownToHtml(answer.text) : ''), [answer]);

  return (
    <div className="flex flex-col gap-2">
      <div className="ml-auto max-w-[86%] rounded-[13px_13px_4px_13px] bg-primary/10 px-3 py-2 text-[12.5px] whitespace-pre-wrap text-primary">{turn.text}</div>
      {steps.length > 0 && (
        <div className="border-l-2 border-border pl-2.5">
          <button type="button" onClick={() => setExpanded(!showSteps)} className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground cursor-pointer">
            {finished ? (showSteps ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <Loader2 size={13} className="animate-spin text-primary" />}
            {finished ? tr('agent.steps', { n: steps.length }) : tr('agent.working')}
          </button>
          {showSteps && (
            <div className="mt-1.5 flex flex-col gap-1">
              {steps.map((s) => {
                const open = openRefs.has(s.ref);
                return (
                  <div key={s.ref} data-ref={s.ref} className={cn('rounded-[7px]', highlight === s.ref && 'ring-2 ring-primary/40')}>
                    <button
                      type="button"
                      onClick={() => setOpenRefs((o) => {
                        const n = new Set(o);
                        if (n.has(s.ref)) n.delete(s.ref);
                        else n.add(s.ref);
                        return n;
                      })}
                      className="flex w-full items-center gap-1.5 rounded-[7px] border border-border bg-muted px-2 py-1 text-left font-mono text-[10.5px] cursor-pointer"
                    >
                      {s.end ? <Wrench size={11} className={s.end.ok ? 'text-good' : 'text-bad'} /> : <Loader2 size={11} className="animate-spin text-primary" />}
                      <span className="font-semibold">#{s.ref}</span>
                      <span className="text-primary">{s.tool}</span>
                      {s.injected && <span className="rounded-full bg-secondary px-1.5 font-sans text-[10px] text-muted-foreground">{tr('agent.context')}</span>}
                      <span className="truncate text-muted-foreground">{JSON.stringify(s.args)}</span>
                      {s.end && <span className="ml-auto pl-1 text-muted-foreground">{s.end.ms}ms</span>}
                    </button>
                    {open && (
                      <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-background p-2 font-mono text-[10.5px] whitespace-pre-wrap break-words text-muted-foreground">
                        {`args ${JSON.stringify(s.args, null, 2)}${s.end ? `\n\nresult ${pretty(s.end.result)}` : ''}`}
                      </pre>
                    )}
                  </div>
                );
              })}
              {texts.map((x, i) => (
                <div key={i} className="text-[11.5px] text-muted-foreground italic">{x}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {answer && (
        <div
          className={cn('prose-agent max-w-full rounded-[13px_13px_13px_4px] border border-border bg-muted px-3 py-2 text-[12.5px]', answer.partial && 'border-warn')}
          onClick={(e: ReactMouseEvent<HTMLDivElement>) => {
            const ref = (e.target as HTMLElement).closest('.cite')?.getAttribute('data-ref');
            if (ref) onCite(Number(ref));
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      {error && <div className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-[12px] text-bad">{error}</div>}
      {done && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[10.5px] text-muted-foreground">
          {done.grounding.ungrounded.length ? (
            <span className="text-warn">⚠ {tr('agent.ungrounded', { n: done.grounding.ungrounded.length, list: done.grounding.ungrounded.join(', ') })}</span>
          ) : (
            <span className="text-good">✓ {tr('agent.grounded', { n: done.grounding.checked })}</span>
          )}
          <span>{tr('agent.tokens', { n: (done.usage.prompt_tokens + done.usage.completion_tokens).toLocaleString('en-US'), v: done.prompt_version })}</span>
        </div>
      )}
    </div>
  );
}

export function AgentRail() {
  const { tr } = useApp();
  const agent = useAgent();
  const [width, setWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || 360);
  const [text, setText] = useState('');
  const [highlight, setHighlight] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const lastEvents = agent.turns.at(-1)?.events.length ?? 0;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [agent.turns.length, lastEvents]);

  const startResize = (e: ReactMouseEvent) => {
    const startX = e.clientX;
    const startW = width;
    const move = (ev: MouseEvent) => setWidth(Math.min(640, Math.max(300, startW + startX - ev.clientX)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const cite = (ref: number) => {
    setHighlight(ref);
    setTimeout(() => logRef.current?.querySelector(`[data-ref="${ref}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    setTimeout(() => setHighlight(null), 1600);
  };

  if (!agent.status) return null;
  if (!agent.open) {
    return (
      <button
        type="button"
        onClick={() => agent.setOpen(true)}
        className="fixed right-6 bottom-6 z-30 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-[13px] font-semibold text-primary-foreground shadow-emboss cursor-pointer"
      >
        <Sparkles size={15} /> {tr('agent.open')}
      </button>
    );
  }

  const ready = agent.status.llm_configured;
  const submit = () => {
    agent.send(text);
    setText('');
  };

  return (
    <aside className="relative my-3 mr-3 flex shrink-0 flex-col rounded-2xl border border-border/60 bg-card shadow-emboss" style={{ width }}>
      <div onMouseDown={startResize} className="absolute top-0 bottom-0 -left-1.5 w-3 cursor-col-resize" />
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className={cn('size-[7px] rounded-full', agent.running ? 'bg-primary animate-[pulse-dot_1s_infinite]' : 'bg-good ring-2 ring-good/25')} />
        <span className="text-[13.5px] font-[660]">{tr('agent.title')}</span>
        <span className="truncate text-[11px] text-muted-foreground">{ready ? agent.status.model : ''}</span>
        <div className="ml-auto flex items-center">
          <button type="button" title={tr('agent.new')} onClick={agent.newChat} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted cursor-pointer">
            <Plus size={14} />
          </button>
          <button type="button" title={tr('agent.close')} onClick={() => agent.setOpen(false)} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted cursor-pointer">
            <X size={14} />
          </button>
        </div>
      </div>
      <div ref={logRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        {!ready && <div className="rounded-xl border border-dashed border-border p-3 text-[12px] text-muted-foreground">{tr('agent.noLlm')}</div>}
        {ready && !agent.turns.length && <div className="text-[12px] text-muted-foreground">{tr('agent.hint')}</div>}
        {agent.turns.map((turn, i) => (
          <TurnView key={i} turn={turn} highlight={highlight} onCite={cite} />
        ))}
      </div>
      <div className="border-t border-border p-3">
        {agent.board && (
          <div className="mb-2">
            <span className="rounded-full bg-secondary/70 px-2 py-0.5 text-[11px] text-muted-foreground">
              {tr('agent.board', { title: agent.board.title, n: agent.board.days })}
            </span>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-[11px] border border-border bg-muted p-1.5 pl-2.5 focus-within:border-primary/50">
          <textarea
            rows={2}
            value={text}
            disabled={!ready || agent.running}
            placeholder={tr('agent.placeholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="min-h-9 flex-1 resize-none bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            disabled={!ready || agent.running || !text.trim()}
            onClick={submit}
            className="grid size-[27px] shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40 cursor-pointer"
          >
            <ArrowUp size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
