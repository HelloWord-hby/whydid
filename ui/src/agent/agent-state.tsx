/**
 * Agent conversation state: session id, turns, streaming, and the actions
 * cards and boards use to start a turn (ask about a card, review a board).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getJson, postJson, streamTurn } from '../lib/api';
import { type AgentEvent, type AgentStatus } from '../lib/types';

const SESSION_KEY = 'whydid.agent.session';

export interface Turn {
  text: string;
  events: AgentEvent[];
}

export interface TurnContext {
  board?: { id: string; title: string; days: number };
}

interface AgentState {
  status: AgentStatus | null;
  open: boolean;
  setOpen: (o: boolean) => void;
  turns: Turn[];
  running: boolean;
  send: (text: string, opts?: { entry?: 'chat' | 'card' | 'board'; card?: string }) => void;
  newChat: () => void;
  setBoardContext: (b: TurnContext['board'] | undefined) => void;
  board: TurnContext['board'] | undefined;
}

const Ctx = createContext<AgentState | null>(null);

interface SessionView {
  transcript: Array<{ role: 'user'; text: string } | { role: 'agent'; events: AgentEvent[] }>;
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [running, setRunning] = useState(false);
  const [board, setBoard] = useState<TurnContext['board']>();
  const sessionRef = useRef<string | null>(localStorage.getItem(SESSION_KEY));
  const boardRef = useRef(board);
  boardRef.current = board;

  useEffect(() => {
    getJson<AgentStatus>('/agent/status')
      .then(setStatus)
      .catch(() => setStatus(null));
    const id = sessionRef.current;
    if (!id) return;
    getJson<SessionView>(`/agent/sessions/${id}`)
      .then((s) => {
        const restored: Turn[] = [];
        for (const item of s.transcript) {
          if (item.role === 'user') restored.push({ text: item.text, events: [] });
          else if (restored.length) restored[restored.length - 1] = { ...restored[restored.length - 1]!, events: item.events };
        }
        setTurns(restored);
      })
      .catch(() => {
        sessionRef.current = null;
        localStorage.removeItem(SESSION_KEY);
      });
  }, []);

  const appendEvent = useCallback((e: AgentEvent) => {
    setTurns((ts) => {
      if (!ts.length) return ts;
      const last = ts[ts.length - 1]!;
      return [...ts.slice(0, -1), { ...last, events: [...last.events, e] }];
    });
  }, []);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionRef.current) return sessionRef.current;
    const r = await postJson<{ id: string }>('/agent/sessions', {});
    sessionRef.current = r.id;
    localStorage.setItem(SESSION_KEY, r.id);
    return r.id;
  }, []);

  const send = useCallback<AgentState['send']>(
    (text, opts = {}) => {
      const q = text.trim();
      if (!q || running || !status?.llm_configured) return;
      const b = boardRef.current;
      const body: Record<string, unknown> = { text: q, entry: opts.entry ?? 'chat' };
      if (b) {
        body.board = b.id;
        body.days = b.days;
      }
      if (opts.card) body.card = opts.card;
      setOpen(true);
      setRunning(true);
      setTurns((ts) => [...ts, { text: q, events: [] }]);
      void (async () => {
        try {
          let id = await ensureSession();
          try {
            await streamTurn(id, body, appendEvent);
          } catch (err) {
            if ((err as { status?: number }).status !== 404) throw err;
            // Session expired or the server restarted: start a new one once.
            sessionRef.current = null;
            id = await ensureSession();
            await streamTurn(id, body, appendEvent);
          }
        } catch (err) {
          appendEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        } finally {
          setRunning(false);
        }
      })();
    },
    [running, status, ensureSession, appendEvent]
  );

  const newChat = useCallback(() => {
    if (running) return;
    sessionRef.current = null;
    localStorage.removeItem(SESSION_KEY);
    setTurns([]);
  }, [running]);

  const value = useMemo<AgentState>(
    () => ({ status, open, setOpen, turns, running, send, newChat, setBoardContext: setBoard, board }),
    [status, open, turns, running, send, newChat, board]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAgent(): AgentState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAgent outside AgentProvider');
  return v;
}
