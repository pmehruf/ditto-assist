// @ts-check
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// NOTE: This project has no @types/react / @types/react-dom installed (see
// src/components/ErrorBoundary.tsx for the long-form explanation). Because of
// that, typescript-eslint's *type-checked* rule sets (recommendedTypeChecked,
// strictTypeChecked, etc.) would misfire constantly on JSX/React-typed code,
// so we intentionally stick to the syntax-only `recommended` config here
// rather than anything requiring full type information.
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "node_modules_*/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Only the two long-standing, battle-tested react-hooks rules are
      // enabled at meaningful severity. `recommended-latest` (react-hooks
      // v7+) also bundles a large set of newer "React Compiler" rules
      // (set-state-in-effect, immutability, static-components, etc.) that
      // assume a React Compiler-oriented codebase and flag many common,
      // intentional patterns (e.g. syncing state in an effect) that are not
      // bugs here. This project does not use the React Compiler, so those
      // are kept at "warn" (visible, non-blocking) rather than "error" to
      // avoid forcing risky behavioral rewrites just to satisfy lint.
      ...reactHooks.configs.flat["recommended-latest"].rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/void-use-memo": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/refs": "warn",
      ...reactRefresh.configs.vite.rules,
      // Unused vars: allow intentionally-ignored args/vars prefixed with "_"
      // (this codebase uses `catch (_) {}` deliberately in several places).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // The codebase intentionally uses `any` in a handful of places when
      // bridging untyped third-party/AI JSON payloads; keep this a warning
      // rather than an error so it surfaces without blocking CI.
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Server-only files run under Node, not the browser.
    files: ["server.ts", "vite.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  }
);
