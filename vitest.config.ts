import { defineConfig } from 'vitest/config';

// Separate, minimal config for pure-logic unit/regression tests.
// Deliberately does NOT pull in the React/Tailwind plugins from vite.config.ts —
// engine.ts and specificIllnessEngine.ts are plain TypeScript with no DOM dependency,
// so a plain node environment keeps the suite fast or CI.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
