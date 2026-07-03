import { defineConfig } from 'vitest/config';

// Separate, minimal config for pure-logic unit/regression tests.
// Deliberately does NOT pull in the React/Tailwind plugins from vite.config.ts —
// engine.ts and specificIllnessEngine.ts are plain TypeScript with no DOM dependency,
// so a plain node environment keeps the suite fast or CI.
export default defineConfig({
  test: {
    environment: 'node',
    // PGlite (WASM Postgres) doesn't work reliably when tests are run
    // in worker threads; run tests in the main process to avoid timeouts.
    // Some tests run migrations or long data-driven checks — extend timeouts.
    hookTimeout: 60000,
    testTimeout: 60000,
    include: ['src/**/*.test.ts'],
  },
});
