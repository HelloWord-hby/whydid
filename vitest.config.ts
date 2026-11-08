import { defineConfig } from 'vitest/config';

// Backend tests only; the dashboard in ui/ has its own vitest setup (npm run test:ui).
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
