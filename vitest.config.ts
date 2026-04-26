import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "packages/shared/src/**/*.ts",
        "apps/worker/src/**/*.ts",
        "packages/eval/src/scoring.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "**/index.ts",
        "apps/worker/src/index.ts",
        "apps/worker/src/runner.ts", // requires Postgres + Playwright; covered by smoke tests
        "apps/worker/src/browser.ts", // requires Playwright
        "apps/worker/src/deterministic/**", // requires Playwright
        "apps/worker/src/artifacts.ts", // thin disk wrapper
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@ubh/shared": new URL("./packages/shared/src/index.ts", import.meta.url).pathname,
      "@ubh/db": new URL("./packages/db/src/index.ts", import.meta.url).pathname,
    },
  },
});
