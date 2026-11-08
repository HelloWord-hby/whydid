/**
 * Provider contract. A provider turns (params, source, window) into one
 * card payload using deterministic code only.
 */
import { type z } from 'zod';
import { type ToolContext } from '../../tools/context.js';
import { type ModelSettings } from '../model/aggregate.js';
import { type ModelSource } from '../model/source.js';
import { type CardPayload, type Display, type Window } from '../types.js';

export interface ModelSourceContext {
  kind: 'model_output';
  source: ModelSource;
  settings: ModelSettings;
}

export interface SemanticSourceContext {
  kind: 'semantic';
  tool: ToolContext;
}

export type SourceContext = ModelSourceContext | SemanticSourceContext;

export interface Provider<K extends SourceContext['kind'], P> {
  source: K;
  displays: readonly Display[];
  params: z.ZodType<P, z.ZodTypeDef, unknown>;
  /** Load-time checks against the source (e.g. metric names exist). */
  validate?: (params: P, ctx: Extract<SourceContext, { kind: K }>, display: Display) => void;
  run: (
    params: P,
    ctx: Extract<SourceContext, { kind: K }>,
    win: Window,
    display: Display
  ) => Promise<CardPayload>;
}

/** Erased provider type for the registry. */
export interface AnyProvider {
  source: SourceContext['kind'];
  displays: readonly Display[];
  params: z.ZodType<unknown, z.ZodTypeDef, unknown>;
  validate?: (params: unknown, ctx: SourceContext, display: Display) => void;
  run: (params: unknown, ctx: SourceContext, win: Window, display: Display) => Promise<CardPayload>;
}

export function defineProvider<K extends SourceContext['kind'], P>(p: Provider<K, P>): AnyProvider {
  return p as unknown as AnyProvider;
}
