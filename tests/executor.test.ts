import { describe, expect, it } from 'vitest';
import { configSchema, validateConfig } from '../src/config/schema.js';
import { executeTool } from '../src/tools/index.js';
import type { ToolContext } from '../src/tools/context.js';

const config = validateConfig(
  configSchema.parse({
    table: 'events',
    time_column: 'created_at',
    metrics: {
      conversations: { kind: 'additive', expr: 'COUNT(*)' },
    },
    dimensions: {
      intent: { column: 'intent' },
    },
  })
);

// Validation failures must surface before any database access, so a null db
// is fine for these cases — touching it would be the bug.
const ctx = { config, db: null } as unknown as ToolContext;

describe('executeTool argument validation', () => {
  it('rejects unknown tool names, including prototype-chain names', async () => {
    await expect(executeTool(ctx, 'nope', {})).rejects.toThrow(/Unknown tool/);
    await expect(executeTool(ctx, '__proto__', {})).rejects.toThrow(/Unknown tool/);
    await expect(executeTool(ctx, 'toString', {})).rejects.toThrow(/Unknown tool/);
  });

  it('rejects missing required arguments with a clean message', async () => {
    await expect(executeTool(ctx, 'get_metric', { metric: 'conversations' })).rejects.toThrow(
      /Invalid arguments for get_metric/
    );
  });

  it('rejects malformed period objects', async () => {
    await expect(
      executeTool(ctx, 'get_metric', {
        metric: 'conversations',
        period: { from: '2026-07-01' },
      })
    ).rejects.toThrow(/Invalid arguments/);
    await expect(
      executeTool(ctx, 'get_metric', {
        metric: 'conversations',
        period: { from: '2026-07-01', to: '2026-07-08', extra: true },
      })
    ).rejects.toThrow(/Invalid arguments/);
  });

  it('rejects unexpected top-level keys (strict schemas)', async () => {
    await expect(
      executeTool(ctx, 'get_metric', {
        metric: 'conversations',
        period: { from: '2026-07-01', to: '2026-07-08' },
        by_dimension: 'intent',
      })
    ).rejects.toThrow(/Invalid arguments/);
  });

  it('rejects out-of-range top_n', async () => {
    await expect(
      executeTool(ctx, 'decompose_change_additive', {
        metric: 'conversations',
        period_a: { from: '2026-07-01', to: '2026-07-08' },
        period_b: { from: '2026-07-08', to: '2026-07-15' },
        dimension: 'intent',
        top_n: 0,
      })
    ).rejects.toThrow(/Invalid arguments/);
  });
});
