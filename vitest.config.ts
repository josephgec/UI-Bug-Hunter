import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "actions/*/src/**/*.test.ts",
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
        "apps/web/src/sso/**/*.ts",
        "packages/eval/src/scoring.ts",
        "actions/scan/src/format.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "**/index.ts",
        "apps/worker/src/index.ts",
        "apps/worker/src/runner.ts", // requires Postgres + Playwright; covered by smoke tests
        "apps/worker/src/browser.ts", // requires Playwright
        "apps/worker/src/crawler.ts", // requires Playwright
        "apps/worker/src/deterministic/**", // requires Playwright
        "apps/worker/src/flows/**", // requires Playwright
        "apps/worker/src/destinations/dispatcher.ts", // requires Prisma at runtime; logic surface tested via autoDispatchAllowed
        "apps/worker/src/destinations/slack.ts", // requires Slack; integration-tested
        "apps/worker/src/destinations/linear.ts", // requires Linear
        "apps/worker/src/destinations/jira.ts", // requires Jira
        "apps/worker/src/security/credentials.ts", // requires Prisma at runtime
        "apps/worker/src/artifacts.ts", // thin disk wrapper
        "apps/web/src/sso/mock.ts", // mock helper
        "apps/web/src/sso/workos.ts", // requires WorkOS keys
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
