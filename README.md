# UI Bug Hunter

AI agent that drives a headless browser, captures multimodal evidence (screenshots, DOM,
console logs, network activity), and reports a categorized list of UI bugs found on a page.

This repository is a **Phase 1 MVP scaffold** — a runnable local prototype that exercises
the architecture end-to-end. Production-shaped infrastructure (Firecracker microVMs,
deployed staging, real eval set, two-pass adversarial verification) is planned for
Phase 1 weeks 2, 4, 5, and 6 and is intentionally not yet wired here.

See the project design doc for the full plan: components, taxonomy, agent loop,
false-positive controls, security model, cost envelope, pricing, eval methodology,
and phased rollout.

---

## Architecture at a glance

```
apps/
  web/           Next.js (App Router) dashboard + REST API
  worker/        Queue consumer, Playwright browser session, agent loop
packages/
  db/            Prisma schema + client (Postgres)
  shared/        Cross-package types, Redis Streams queue wrapper, URL validator
  eval/          Eval harness, fixture pages, synthetic bug injection, scoring
```

**Request lifecycle**

1. Client `POST`s `/api/v1/scans` with a project ID + URL.
2. Web app validates the URL (rejects RFC1918, link-local, cloud metadata, non-HTTP),
   creates a `Scan` row, and pushes a job onto the Redis Streams queue `ubh:scans`.
3. A worker dequeues the job, opens a Playwright browser, navigates to the URL,
   waits for `networkidle`, disables animations, and runs deterministic checks
   (axe-core, broken-image detector, console capture).
4. The worker hands the deterministic results + an initial screenshot to the LLM
   agent, which drives the browser through a constrained tool surface (`goto`,
   `screenshot`, `get_dom`, `get_console_logs`, `get_network_errors`, `click`,
   `type`, `scroll`, `check_accessibility`, `report_bug`).
5. The agent loop runs until the model emits a turn with no tool calls, the tool-call
   budget is exhausted, or the wall-time budget is exhausted.
6. Reported findings are persisted to Postgres; the dashboard renders findings
   above a 0.6 confidence threshold (lower-confidence findings are hidden by default).

**LLM provider abstraction.** The agent loop talks through a provider-agnostic
interface (`apps/worker/src/agent/llm.ts`). Three implementations ship:

- `mock` — scripted, no network calls, useful for end-to-end smoke tests.
- `anthropic` — Claude Messages API with vision + tool use.
- `openai` — Chat Completions with vision + function calls.

Switch with `LLM_PROVIDER=mock|anthropic|openai` and the matching API key.

---

## Quick start

Prereqs: Node 20+, pnpm 9+, Docker, and a willingness to install Chromium (~150 MB).

```bash
# 1. Install dependencies
corepack enable pnpm
pnpm install

# 2. Bring up Postgres + Redis
cp .env.example .env
docker compose up -d

# 3. Apply the schema
pnpm db:migrate

# 4. Install Playwright's Chromium
pnpm --filter @ubh/worker exec playwright install chromium

# 5. Start the web app and worker (two terminals)
pnpm web:dev      # http://localhost:3000
pnpm worker:dev
```

### Submitting a scan

The Phase 1 auth stub trusts the `x-dev-user` header (and falls back to `DEV_USER_EMAIL`
in the env). On first request a User + Org are created automatically.

```bash
# Create a project
curl -s -X POST http://localhost:3000/api/v1/projects \
  -H 'content-type: application/json' \
  -H 'x-dev-user: dev@local.test' \
  -d '{"name":"Smoke","baseUrl":"https://example.com"}' | jq

# Submit a scan
curl -s -X POST http://localhost:3000/api/v1/scans \
  -H 'content-type: application/json' \
  -H 'x-dev-user: dev@local.test' \
  -d '{"projectId":"<id>","url":"https://example.com"}' | jq

# Read findings
curl -s "http://localhost:3000/api/v1/scans/<scanId>/findings?min_confidence=0.6" \
  -H 'x-dev-user: dev@local.test' | jq
```

The dashboard at http://localhost:3000 lists projects and renders scan results
with bounding-box overlays where the agent provided one.

---

## Testing

The pure-logic surfaces (URL validator, queue, scoring, agent loop, provider
translators, tool input parsing) ship with vitest unit tests. Integration tests
that require a live Postgres / Redis / Chromium are intentionally not part of
the default `test` run — they belong in CI.

```bash
pnpm test               # vitest run
pnpm test:watch         # vitest --watch
pnpm test:coverage      # produces ./coverage/lcov.info + html report
```

Coverage thresholds are enforced at 70% lines / functions / branches / statements
across `packages/shared`, `packages/eval/src/scoring.ts`, and the pure-logic
modules under `apps/worker/src/agent` and `apps/worker/src/tools`. Browser-bound
modules (`browser.ts`, `runner.ts`, `deterministic/*`) are excluded — they are
covered by the eval harness against the local fixture server.

What the tests assert today:

| File | What it covers |
|---|---|
| `packages/shared/src/url-validator.test.ts` | RFC1918 / link-local / metadata / IPv6 ULA / DNS-resolved private IPs / scheme allowlist |
| `packages/shared/src/queue.test.ts` | enqueue + readOne round-trip, ack, idempotent group creation, malformed payload tolerance |
| `packages/shared/src/types.test.ts` | Zod schemas for `ReportedBug` and `ScanJob`, including default fill-in and rejection cases |
| `packages/eval/src/scoring.test.ts` | TP/FP/FN math, micro-aggregation across categories, edge cases (empty / clean) |
| `apps/worker/src/agent/loop.test.ts` | Tool dispatch, missing-tool error path, exception path, tool-call budget hard-stop, wall-time hard-stop, no-tool-use early termination |
| `apps/worker/src/agent/providers/mock.test.ts` | Scripted walk + exhaustion, unique tool-use IDs, default-script coverage |
| `apps/worker/src/agent/providers/anthropic.test.ts` | Request translation (tools, multimodal user content, tool_result), response translation, stop-reason mapping |
| `apps/worker/src/agent/providers/openai.test.ts` | Chat Completions translation, malformed-JSON tolerance for tool args, image follow-up after tool message, finish-reason mapping |
| `apps/worker/src/tools/registry.test.ts` | Registry shape, schema sanity, `report_bug` validation + side effect on session buffer |

### Running the eval harness

```bash
# Terminal A — serve the fixture pages
pnpm --filter @ubh/eval serve-fixtures

# Terminal B — run the eval against the agent (uses LLM_PROVIDER from env)
pnpm eval
```

The runner writes `precision/recall/F1` per bug category to `.eval-output/report.txt`
and a JSON twin alongside. With `LLM_PROVIDER=mock` you can confirm the harness
works without an API key (precision will be 0 because the mock doesn't actually
report bugs — that's expected).

---

## Configuration

Every knob lives in `.env` (template in `.env.example`). The notable ones:

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | local docker | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis Streams queue |
| `LLM_PROVIDER` | `mock` | `mock` / `anthropic` / `openai` |
| `LLM_MODEL` | provider default | overrides provider's default model |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | required for non-mock providers |
| `SCAN_MAX_TOOL_CALLS` | `40` | hard stop in the agent loop |
| `SCAN_MAX_WALL_TIME_MS` | `120000` | hard stop in the agent loop |
| `WORKER_CONCURRENCY` | `1` | scans per worker process; v1 is one-at-a-time |
| `ARTIFACT_DIR` | `./.scan-artifacts` | local-disk screenshot store |
| `WORKER_TRACE` | unset | set to `1` to emit JSON trace events for every tool call |

---

## What's wired in this scaffold

- Workspace, schema, queue, REST API, dashboard skeleton, worker entrypoint
- Plan-act-observe agent loop with hard tool-call and wall-time budgets
- Provider-agnostic LLM interface (`mock` / `anthropic` / `openai`)
- Tool stack: `goto`, `screenshot`, `get_dom`, `get_console_logs`,
  `get_network_errors`, `click`, `type`, `scroll`, `check_accessibility`,
  `report_bug`
- Deterministic checks: axe-core, broken-image detector, filtered console
  capture; results piped into the agent's first turn so it doesn't re-derive
- Animation kill + two-shot stability check before any visual finding
- URL validator (private IPs, link-local, metadata IPs, non-HTTP schemes)
- Eval harness shell with fixtures, synthetic bug injection, precision/recall/F1
  scoring, and a local fixture HTTP server
- vitest test suite with v8 coverage reporting

## What's not wired yet (planned in Phase 1)

| Week | Item |
|---|---|
| 2 | Firecracker microVM sandbox (worker currently runs Playwright directly) |
| 2 | Egress proxy in front of the sandbox |
| 4 | Full 50-page hand-curated eval set with ground-truth labels |
| 5 | Two-pass adversarial verification of every reported finding |
| 5 | Embedding-similarity allowlist beyond exact match |
| 6 | Rich dashboard: bounding-box overlays, feedback rolling-up into eval, project allowlist UI |

---

## Contributing

This is an internal scaffold; external contribution model is TBD. While it's a
moving target:

- Run `pnpm typecheck && pnpm test` before committing.
- The bug taxonomy in `packages/shared/src/types.ts` is the source of truth — if
  you rename a category, update the system prompt in `apps/worker/src/agent/prompts.ts`
  in the same change.
- Keep `LLM_PROVIDER=mock` working: it's the contract the agent loop unit tests
  rely on and how new contributors verify the wiring without burning API credits.
