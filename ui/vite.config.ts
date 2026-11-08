/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Built into ui/dist and served by `whydid serve` at GET /.
// In development, run `npm run dev` here and point the app at a running
// whydid with ?api=http://localhost:8787 (CORS is open on the server).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
