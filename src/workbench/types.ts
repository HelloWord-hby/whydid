/**
 * Workbench environment and the agent-tool contract.
 *
 * The workbench agent reads every data source the dashboard reads — the
 * same BoardService, the same semantic tool contexts — so a number in an
 * answer and the number on a card come from the same function.
 */
import { type z } from 'zod';
import { type BoardService } from '../boards/service.js';
import { type ModelSourceContext } from '../boards/providers/types.js';
import { type ToolContext } from '../tools/context.js';
import { type ReleaseStore } from '../releases/store.js';

export interface WorkbenchEnv {
  boards: BoardService;
  /** Semantic (SQL) sources by id, including the main config as "main". */
  semantic: ReadonlyMap<string, ToolContext>;
  /** The model-output source, when one is configured. */
  model?: { id: string; ctx: ModelSourceContext };
  /** The team's release log, when the server keeps one. */
  releases?: ReleaseStore;
  now: () => Date;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON schema shown to the LLM. */
  parameters: Record<string, unknown>;
  /** Runtime validation of the LLM's arguments. */
  args: z.ZodTypeAny;
  run(args: never, env: WorkbenchEnv): Promise<unknown>;
}

export function defineAgentTool<S extends z.ZodTypeAny>(tool: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  args: S;
  run(args: z.infer<S>, env: WorkbenchEnv): Promise<unknown>;
}): AgentTool {
  return tool as unknown as AgentTool;
}
