/**
 * Workbench — wires the agent to the dashboard's data sources and keeps
 * the in-memory session store.
 *
 * The system prompt and tool list are built once at startup from the
 * configs, so every session in a process shares one prompt version.
 * Sessions live in memory: a restart drops them (MVP trade-off, see the
 * design doc); the browser keeps its own transcript for display.
 */
import { type Sql } from 'postgres';
import { type WhydidConfig } from '../config/schema.js';
import { type BoardService } from '../boards/service.js';
import { type ToolContext } from '../tools/context.js';
import { type ReleaseStore } from '../releases/store.js';
import { assembleSystemPrompt, buildCatalog, loadPromptFiles, type AssembledPrompt, type PromptFiles } from './prompt.js';
import { AgentSession } from './session.js';
import { buildAgentTools } from './tools.js';
import { type AgentTool, type WorkbenchEnv } from './types.js';

export const MAIN_SOURCE_ID = 'main';
const SESSION_TTL_MS = 6 * 3600_000;
const MAX_SESSIONS = 200;

export function buildWorkbenchEnv(
  boards: BoardService,
  mainConfig: WhydidConfig,
  db: Sql,
  now: () => Date = () => new Date(),
  releases?: ReleaseStore
): WorkbenchEnv {
  const semantic = new Map<string, ToolContext>([[MAIN_SOURCE_ID, { config: mainConfig, db }]]);
  let model: WorkbenchEnv['model'];
  for (const [id, ctx] of boards.sourceContexts()) {
    if (ctx.kind === 'semantic') semantic.set(id, ctx.tool);
    else if (!model) model = { id, ctx };
  }
  return { boards, semantic, model, now, ...(releases ? { releases } : {}) };
}

export class Workbench {
  readonly tools: AgentTool[];
  readonly system: AssembledPrompt;
  private readonly sessions = new Map<string, AgentSession>();

  constructor(
    readonly env: WorkbenchEnv,
    files: PromptFiles = loadPromptFiles()
  ) {
    this.tools = buildAgentTools(env);
    this.system = assembleSystemPrompt(files, buildCatalog(env));
  }

  createSession(): AgentSession {
    this.prune();
    const s = new AgentSession(this.env, this.tools, this.system);
    this.sessions.set(s.id, s);
    return s;
  }

  getSession(id: string): AgentSession | undefined {
    const s = this.sessions.get(id);
    if (s) s.lastUsed = Date.now();
    return s;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (!s.busy && now - s.lastUsed > SESSION_TTL_MS) this.sessions.delete(id);
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].filter((s) => !s.busy).sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (oldest) this.sessions.delete(oldest.id);
    }
  }
}
