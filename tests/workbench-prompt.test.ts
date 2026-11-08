import { describe, expect, it } from 'vitest';
import {
  assembleSystemPrompt,
  buildCatalog,
  choosePlaybook,
  contextBlock,
  loadPromptFiles,
  PROMPT_FILES,
} from '../src/workbench/prompt.js';
import { Workbench } from '../src/workbench/index.js';
import { demoEnv } from './workbench-helpers.js';

describe('prompt layers', () => {
  const files = loadPromptFiles();
  const env = demoEnv();
  const catalog = buildCatalog(env);
  const system = assembleSystemPrompt(files, catalog);

  it('ships every layer file with content', () => {
    for (const f of PROMPT_FILES) expect(files[f].length).toBeGreaterThan(200);
  });

  it('orders the system layers: principles, catalog, tool policy, playbooks, output', () => {
    const at = (needle: string) => system.text.indexOf(needle);
    expect(at('# Role')).toBe(0);
    expect(at('# Data catalog')).toBeGreaterThan(at('Non-negotiable rules'));
    expect(at('# How to use the tools')).toBeGreaterThan(at('# Data catalog'));
    expect(at('# Playbooks')).toBeGreaterThan(at('# How to use the tools'));
    expect(at('# Answer format')).toBeGreaterThan(at('# Playbooks'));
  });

  it('generates the catalog from the configs', () => {
    expect(catalog).toContain('### Source `main` (semantic, SQL)');
    expect(catalog).toContain('`resolution_rate` (rate)');
    expect(catalog).toContain('Caveat: Self-reported.');
    expect(catalog).toContain('Values: billing=Billing');
    expect(catalog).toContain('### Source `model` (model output, demo dataset)');
    expect(catalog).toContain('value 0 means thumbs-down');
    expect(catalog).toContain('Board `model_output`');
    expect(catalog).toContain('`faithfulness`');
  });

  it('keeps per-turn context out of the system message', () => {
    expect(system.text).not.toContain('<context>');
    const block = contextBlock({
      today: '2026-11-08',
      entry: 'card',
      playbook: 'explain_card',
      board: { id: 'model_output', title: 'Model Output' },
      card: { id: 'faithfulness', title: 'Faithfulness' },
      days: 7,
    });
    expect(block).toMatch(/^<context>\n/);
    expect(block).toContain('playbook: explain_card');
    expect(block).toContain('card: faithfulness ("Faithfulness")');
  });

  it('versions the prompt by content', () => {
    expect(system.version).toMatch(/^[0-9a-f]{12}$/);
    expect(assembleSystemPrompt(files, catalog).version).toBe(system.version);
    const edited = { ...files, '06-output.md': files['06-output.md'] + '\nBe brief.' };
    expect(assembleSystemPrompt(edited, catalog).version).not.toBe(system.version);
    expect(new Workbench(env, files).system.version).toBe(system.version);
  });
});

describe('choosePlaybook', () => {
  it('picks the playbook from the entry point, not from the text', () => {
    expect(choosePlaybook('board', undefined, undefined)).toBe('board_review');
    expect(choosePlaybook('card', 'score_average', undefined)).toBe('explain_card');
    expect(choosePlaybook('card', 'low_score_samples', 'explain_card')).toBe('sample_review');
    expect(choosePlaybook('chat', undefined, undefined)).toBe('explain_change');
    expect(choosePlaybook('chat', undefined, 'board_review')).toBe('followup');
  });
});
