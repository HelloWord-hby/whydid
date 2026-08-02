#!/usr/bin/env node
/**
 * whydid CLI
 *
 *   whydid ask "why did resolution_rate drop last week?"   agent investigation
 *   whydid tool get_metric --args '{...}'                  run one tool directly
 *   whydid tools                                           list tools & semantic layer
 *   whydid seed                                            create + fill the demo table
 */
import 'dotenv/config';
import { Command } from 'commander';
import { loadConfig } from './config/load.js';
import { metricExpr } from './config/schema.js';
import { getDb, closeDb } from './db/client.js';
import { buildToolSchemas, executeTool, listToolNames } from './tools/index.js';
import { runAgent } from './agent/orchestrator.js';

const program = new Command();

program
  .name('whydid')
  .description('An attribution agent for "why did my metric change?" — deterministic SQL does the math, the LLM only routes and narrates.')
  .option('-c, --config <path>', 'path to whydid.config.yaml', 'whydid.config.yaml');

program
  .command('ask')
  .description('Ask the agent an attribution question')
  .argument('<question>', 'natural-language question about a metric change')
  .option('-v, --verbose', 'print tool calls as they happen')
  .action(async (question: string, opts: { verbose?: boolean }) => {
    const config = loadConfig(program.opts().config);
    const db = getDb(config.timezone);
    try {
      const started = Date.now();
      const result = await runAgent(config, db, question, { verbose: opts.verbose });
      process.stdout.write(result.report + '\n\n');
      process.stderr.write(
        `— ${result.tool_calls.length} tool calls · ` +
          `${result.usage.prompt_tokens + result.usage.completion_tokens} tokens · ` +
          `${((Date.now() - started) / 1000).toFixed(1)}s\n`
      );
    } finally {
      await closeDb();
    }
  });

program
  .command('tool')
  .description('Run a single tool directly (debugging / scripting)')
  .argument('<name>', `one of: ${listToolNames().join(', ')}`)
  .requiredOption('-a, --args <json>', 'tool arguments as a JSON object')
  .action(async (name: string, opts: { args: string }) => {
    const config = loadConfig(program.opts().config);
    const db = getDb(config.timezone);
    try {
      const args = JSON.parse(opts.args) as Record<string, unknown>;
      const result = await executeTool({ config, db }, name, args);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } finally {
      await closeDb();
    }
  });

program
  .command('tools')
  .description('Show the semantic layer: tools, metrics, and dimensions')
  .action(() => {
    const config = loadConfig(program.opts().config);
    process.stdout.write('Tools:\n');
    for (const schema of buildToolSchemas(config)) {
      process.stdout.write(`  ${schema.function.name} — ${schema.function.description}\n`);
    }
    process.stdout.write('\nMetrics:\n');
    for (const [name, m] of Object.entries(config.metrics)) {
      process.stdout.write(
        `  ${name} (${m.kind}) = ${metricExpr(m)}${m.decompose ? '' : '  [decompose disabled]'}\n`
      );
    }
    process.stdout.write('\nDimensions:\n');
    for (const [name, d] of Object.entries(config.dimensions)) {
      process.stdout.write(`  ${name} → column ${d.column}\n`);
    }
  });

program
  .command('seed')
  .description('Create and fill the synthetic demo table (writes to DATABASE_URL)')
  .action(async () => {
    const { seedDemo } = await import('./demo/seed.js');
    await seedDemo();
  });

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
