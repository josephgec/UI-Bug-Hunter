# UI Bug Hunter

AI agent that drives a headless browser, captures multimodal evidence (screenshots, DOM,
console logs, network activity), and reports a categorized list of UI bugs found on a page.

This repository tracks the design doc's phased rollout. **Phase 1 (MVP)** stood up the agent
loop, schema, queue, deterministic checks, and eval harness. **Phase 2 (Beta)** added
multi-viewport rendering, multi-page crawling, billing, encrypted credentials, and a GitHub
Action. **Phase 3 (GA)** layers on multi-step flows, destinations (Slack / Linear / Jira /
generic webhook), audit log + RBAC, SSO via WorkOS, org-level aggregations, and templates
for GitLab / CircleCI / Bitbucket on top of the existing GitHub Action.

Things that need infrastructure not in this codebase (live Stripe, real KMS, real WorkOS,
deployed staging, marketing site, multi-region browser pool, on-call rotation, real load
test at 10× peak) are abstracted behind interfaces with mock implementations — production
swaps the implementation without touching callers.

---

## Architecture at a glance

```
apps/
  web/           Next.js (App Router) dashboard + REST API
  worker/        Queue consumer, Playwright multi-viewport sessions, agent loop, flow executor, destinations
packages/
  db/            Prisma schema (Postgres) + client
  shared/        Cross-package types, queue, URL validator, KMS, billing, dedup, crawl, flows, RBAC, audit, aggregations
  eval/          Eval harness, fixtures, synthetic injection, scoring
actions/
  scan/          GitHub Action that submits scans + posts a PR comment
ci/
  gitlab/        GitLab CI template
  circleci/      CircleCI orb
  bitbucket/     Bitbucket Pipelines example
  scripts/       Shared bash scan runner used by all three
extension/
  recorder/      Browser extension (Chrome MV3) that records click/type/wait into the Flow JSON format
```

**Request lifecycle (Phase 2)**

1. Client `POST`s `/api/v1/scans` (single-page) or `/api/v1/crawls` (multi-page).
2. Web app validates the URL (rejects RFC1918, link-local, cloud metadata, non-HTTP),
   enforces the org's plan + quota, creates a `Scan` (or `Crawl`) row, and pushes a job
   onto Redis Streams (`ubh:scans` / `ubh:crawls`).
3. **Crawler worker** (for multi-page) discovers same-origin links from the seed page,
   enforces depth + page caps, and enqueues a `Scan` job per page.
4. **Scan worker** spins up a Playwright browser with one BrowserContext per viewport,
   navigates all viewports in parallel, waits for `networkidle`, disables animations,
   exercises lazy-loaded content, runs the deterministic checks (axe-core, broken images,
   dead links, console capture, content-issue regex), and hands the results + a screenshot
   per viewport to the agent in a single LLM turn.
5. The agent drives the browser through a constrained tool surface (`goto`, `screenshot`
   per viewport, `get_dom`, `get_console_logs`, `get_network_errors`, `click`, `type`,
   `scroll`, `check_accessibility`, `report_bug`).
6. Findings are dedup-hashed (sha256 prefix of normalized title + DOM snippet + category)
   and persisted; the runner skips findings whose hash already exists in a sibling scan
   of the same crawl.
7. The dashboard renders findings ≥0.6 confidence by default; the GitHub Action exits
   non-zero if any finding meets the configured severity threshold.

**LLM provider abstraction.** The agent loop talks through a provider-agnostic
interface (`apps/worker/src/agent/llm.ts`). Three implementations ship:

- `mock` — scripted, no network calls, useful for end-to-end smoke tests.
- `anthropic` — Claude Messages API with vision + tool use.
- `openai` — Chat Completions with vision + function calls.

Switch with `LLM_PROVIDER=mock|anthropic|openai` and the matching API key.

**KMS abstraction.** Credential vault uses `LocalKmsProvider` (AES-256-GCM with a key
derived from `KMS_LOCAL_KEY`) by default; an `AwsKmsProvider` stub is wired to the same
interface. Plaintext credentials never leave the worker's decrypt-then-inject stack —
they are never logged, never persisted in plaintext, and never sent to the LLM.

**Billing abstraction.** `MockBillingProvider` for dev, `StripeBillingProvider` skeleton
for prod. Quota enforcement against `Organization.quotaUsed` / `quotaLimit` is provider-
agnostic; only checkout / portal / webhook calls touch Stripe.

---

## Quick start

Prereqs: Node 20+, pnpm 9+, Docker, ~150 MB for Chromium.

```bash
corepack enable pnpm
pnpm install
cp .env.example .env

docker compose up -d            # postgres + redis
pnpm db:migrate                 # apply schema
pnpm --filter @ubh/worker exec playwright install chromium

# Two terminals:
pnpm web:dev      # http://localhost:3000
pnpm worker:dev   # consumes both ubh:scans and ubh:crawls
```

### Submitting work

```bash
# Create a project
curl -s -X POST http://localhost:3000/api/v1/projects \
  -H 'content-type: application/json' \
  -H 'x-dev-user: dev@local.test' \
  -d '{"name":"Smoke","baseUrl":"https://example.com"}' | jq

# Single-page scan, all three viewports
curl -s -X POST http://localhost:3000/api/v1/scans \
  -H 'content-type: application/json' \
  -H 'x-dev-user: dev@local.test' \
  -d '{
    "projectId":"<id>",
    "url":"https://example.com",
    "viewports":["mobile","tablet","desktop"]
  }' | jq

# Multi-page crawl (depth 2, up to 25 pages)
curl -s -X POST http://localhost:3000/api/v1/crawls \
  -H 'content-type: application/json' \
  -H 'x-dev-user: dev@local.test' \
  -d '{"projectId":"<id>","seedUrl":"https://example.com","maxDepth":2,"maxPages":25}' | jq

# Authenticated scan: store a credential, then reference it
curl -s -X POST http://localhost:3000/api/v1/projects/<projectId>/credentials \
  -H 'content-type: application/json' \
  -H 'x-dev-user: dev@local.test' \
  -d '{"name":"staging-cookie","kind":"COOKIE","data":{"name":"sid","value":"abc","domain":"staging.example.com"}}' | jq

# Multi-step flow (login → checkout)
curl -s -X POST http://localhost:3000/api/v1/flows \
  -H 'content-type: application/json' \
  -H 'x-dev-user: dev@local.test' \
  -d '{
    "projectId": "<id>",
    "name": "Login + Checkout",
    "definition": {
      "steps": [
        {"kind":"goto","url":"https://staging.example.com/login"},
        {"kind":"type","selector":"input#email","text":"{{credentials.user}}"},
        {"kind":"type","selector":"input#password","text":"{{credentials.pass}}"},
        {"kind":"click","selector":"button[type=submit]","postWaitMs":500},
        {"kind":"wait","selector":"[data-testid=dashboard]","state":"visible"},
        {"kind":"goto","url":"https://staging.example.com/checkout"},
        {"kind":"assert","urlMatches":"/checkout"}
      ]
    },
    "credentialIds": ["<credentialId>"]
  }' | jq

# Run that flow
curl -s -X POST http://localhost:3000/api/v1/flows/<flowId>/runs \
  -H 'content-type: application/json' \
  -H 'x-dev-user: dev@local.test' \
  -d '{"url":"https://staging.example.com/checkout","viewports":["desktop"]}' | jq
```

### CI integrations

**GitHub Action** (`actions/scan/`):

```yaml
- uses: josephgec/UI-Bug-Hunter/actions/scan@main
  with:
    api-url: https://api.uibughunter.dev
    api-token: ${{ secrets.UBH_TOKEN }}
    project-id: ${{ vars.UBH_PROJECT_ID }}
    urls: |
      https://staging.example.com/
      https://staging.example.com/checkout
    viewports: mobile,tablet,desktop
    severity-threshold: high
    min-confidence: "0.7"
    overage-behavior: hard-fail
```

**GitLab CI**:

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/josephgec/UI-Bug-Hunter/main/ci/gitlab/template.gitlab-ci.yml'
variables:
  UBH_PROJECT_ID: $UBH_PROJECT_ID
  UBH_URLS: |
    https://staging.example.com/
    https://staging.example.com/checkout
  UBH_VIEWPORTS: "mobile,tablet,desktop"
  UBH_SEVERITY_THRESHOLD: "high"
```

**CircleCI orb** (`ci/circleci/orb.yml`) and **Bitbucket Pipelines example**
(`ci/bitbucket/bitbucket-pipelines.yml.example`) follow the same pattern; all
three CI providers share a single bash runner at `ci/scripts/ubh-scan.sh`.

**Generic webhook** (`POST /api/v1/integrations/webhook`) accepts a batch of
`{projectId, url}` pairs from any CI system and returns the scan IDs to poll.

Build the GitHub Action's bundled output locally:

```bash
pnpm --filter @ubh/action-scan build
```

### Browser-extension flow recorder

Phase 3 ships a Chrome MV3 extension under `extension/recorder/` that captures
clicks, input, and navigation into the same Flow JSON format the API accepts.
See `extension/recorder/README.md` for the local-install instructions.

---

## Testing

```bash
pnpm test               # vitest run — 142 tests across 21 files
pnpm test:watch         # vitest --watch
pnpm test:coverage      # v8 coverage (lines / branches / funcs / statements)
```

Coverage gates at 70% are enforced across the pure-logic surface; the latest run
sits at **93.2% lines / 85.4% branches / 84.9% functions**. Browser-bound modules
(`browser.ts`, `crawler.ts`, `deterministic/*`, `flows/*`, `runner.ts`) and
provider modules that hit live third-party APIs (`destinations/{slack,linear,jira}.ts`,
`sso/workos.ts`) are excluded from coverage and exercised by the eval harness +
integration tests instead.

What the suite covers:

| File | What it covers |
|---|---|
| `packages/shared/src/url-validator.test.ts` | RFC1918 / link-local / metadata / IPv6 ULA / DNS-resolved private IPs / scheme allowlist |
| `packages/shared/src/queue.test.ts` | enqueue + readOne round-trip, ack, idempotent group creation, malformed payload tolerance |
| `packages/shared/src/types.test.ts` | Zod schemas for `ReportedBug` and `ScanJob`, including default fill-in and rejection cases |
| `packages/shared/src/crawl.test.ts` | URL normalization (fragments / trailing slash / query-param order), same-origin filter, frontier maxDepth + maxPages enforcement, dedup |
| `packages/shared/src/dedup.test.ts` | Whitespace / case insensitivity, category-sensitive hashes, scan fingerprint stability |
| `packages/shared/src/billing.test.ts` | Quota math: hard-cap rejection, soft-cap overage units, 80%/100% threshold crossing |
| `packages/shared/src/kms.test.ts` | LocalKmsProvider AES-256-GCM round-trip, IV uniqueness, tamper detection, key-id rotation guard |
| `packages/eval/src/scoring.test.ts` | TP/FP/FN math, micro-aggregation, edge cases (clean / empty) |
| `apps/worker/src/agent/loop.test.ts` | Tool dispatch, missing-tool error path, exception path, tool-call budget hard-stop, wall-time hard-stop |
| `apps/worker/src/agent/providers/{mock,anthropic,openai}.test.ts` | Provider translators (request + response), stop-reason mapping, malformed-JSON tolerance |
| `apps/worker/src/tools/registry.test.ts` | Registry shape, schema sanity, `report_bug` validation + side effect |
| `actions/scan/src/format.test.ts` | PR-comment renderer: green / red summaries, top-5 inline + collapsed-by-category for the rest, dashboard links |
| `packages/shared/src/flows.test.ts` | Flow JSON schema: realistic login flow, step-shape validation, wait/assert mutual-exclusion |
| `packages/shared/src/rbac.test.ts` | Role × permission matrix, admin-only carve-outs (audit, sso, member.role_change), sorted-unique invariant |
| `packages/shared/src/audit.test.ts` | Payload redactor: top-level + nested + array, case-insensitive keys, cycle safety, AUDIT_ACTIONS shape |
| `packages/shared/src/aggregations.test.ts` | Cross-project aggregation, day/week bucketing with gap-filling, top-regression delta math |
| `apps/worker/src/destinations/{dispatcher,webhook}.test.ts` | Routing rule (severity threshold), HMAC-signed webhook body, non-2xx error path |
| `apps/web/src/sso/state.test.ts` | HMAC-signed SSO state token: round-trip, tamper rejection, wrong-secret rejection, fresh-nonce |

### Running the eval harness

```bash
pnpm --filter @ubh/eval serve-fixtures   # http://localhost:4173
pnpm eval                                 # writes .eval-output/report.{json,txt}
```

---

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | local docker | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis Streams queue |
| `LLM_PROVIDER` | `mock` | `mock` / `anthropic` / `openai` |
| `LLM_MODEL` | provider default | overrides provider's default model |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | required for non-mock providers |
| `BILLING_PROVIDER` | `mock` | `mock` / `stripe` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_TEAM` / `STRIPE_PRICE_BUSINESS` | — | required when `BILLING_PROVIDER=stripe` |
| `KMS_PROVIDER` | `local` | `local` / `aws` |
| `KMS_LOCAL_KEY` | — | passphrase for the local AES-256-GCM provider; min 16 chars |
| `AWS_KMS_KEY_ID` | — | required when `KMS_PROVIDER=aws` |
| `SSO_PROVIDER` | `mock` | `mock` / `workos` |
| `SSO_STATE_SECRET` | — | HMAC secret for the OAuth `state` token; min 32 bytes recommended |
| `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` | — | required when `SSO_PROVIDER=workos` |
| `SLACK_PROVIDER` / `LINEAR_PROVIDER` / `JIRA_PROVIDER` | unset | set to `mock` to short-circuit external API calls in dev |
| `PUBLIC_DASHBOARD_URL` | `http://localhost:3000` | dashboard base URL the dispatcher embeds in destination messages |
| `SCAN_MAX_TOOL_CALLS` | `40` | hard stop in the agent loop |
| `SCAN_MAX_WALL_TIME_MS` | `120000` | hard stop in the agent loop |
| `WORKER_CONCURRENCY` | `1` | scans per worker process |
| `ARTIFACT_DIR` | `./.scan-artifacts` | local-disk screenshot store |
| `WORKER_TRACE` | unset | set to `1` to emit JSON trace events for every tool call |

---

## What's wired

### Phase 1
- Workspace, schema, queue, REST API, dashboard skeleton, worker entrypoint
- Plan-act-observe agent loop with tool-call and wall-time budgets
- Provider-agnostic LLM interface (`mock` / `anthropic` / `openai`)
- Deterministic checks: axe-core, broken-image detector, console capture
- Animation kill + lazy-load + two-shot stability check
- URL validator, eval harness, vitest suite

### Phase 2
- Multi-viewport rendering: one Playwright context per viewport, navigated in parallel,
  all screenshots batched into the agent's first user message
- Multi-page crawl: same-origin link discovery, BFS frontier with maxDepth/maxPages,
  per-page Scan jobs spawned, finding dedup across the crawl via sha256 hashes
- New deterministic checks: dead-link detector (HEAD-then-GET fallback, concurrency-
  limited, same-origin only by default), lorem-ipsum detector, broken-templating
  detector ({{var}} / {%var%})
- Billing: `Plan` enum, quota fields on `Organization`, `Subscription` table,
  `BillingProvider` interface with `MockBillingProvider` (dev) and `StripeBillingProvider`
  (skeleton), checkout + webhook routes, quota enforcement at scan/crawl submission with
  402 on hard-cap exceeded and overage reporting on soft-cap exceeded
- Encrypted credentials: `Credential` table with KMS-encrypted ciphertext, `KmsProvider`
  interface with `LocalKmsProvider` (AES-256-GCM, env-derived key) and `AwsKmsProvider`
  skeleton, header / cookie / basic-auth shapes, plaintext lifecycle bounded to
  `loadAuthInjection` → `BrowserSession` and never logged
- GitHub Action: `actions/scan/` with `action.yml` + bundled `index.ts`, submits scans,
  polls until complete, posts a PR comment grouped by severity, exits non-zero on
  threshold-breaching findings, configurable overage behavior (hard-fail / soft-fail /
  continue)

### Phase 3
- Multi-step flows: JSON `goto`/`click`/`type`/`wait`/`assert` schema in shared,
  `executeFlow` in worker with strict-assertion mode, findings tagged with
  `flowStepIndex`, `/v1/flows` CRUD + `/v1/flows/:id/runs` quota-billed submission,
  credential substitution (`{{credentials.foo}}`) in type steps so plaintext never
  lives in the stored Flow
- Destinations: `Destination` + `DestinationDispatch` tables (KMS-encrypted config),
  `dispatchFinding()` routes a finding to every eligible destination per project,
  Slack / Linear / Jira / generic-webhook providers, `autoSeverity` threshold rule,
  every dispatch persisted with external id + URL or error
- RBAC: explicit per-role permission map (admin / member / viewer), `requirePermission`
  middleware on mutation routes, deny-by-default; `OrgMembership` carries the role
- Audit log: `AuditLog` table, `writeAudit()` helper with cycle-safe payload redactor,
  paginated `/v1/audit-log` API
- SSO: `SsoConnection` table, `SsoProvider` interface with `MockSsoProvider` (dev) and
  `WorkOSSsoProvider` skeleton, HMAC-signed state token, `/v1/sso/initiate` +
  `/v1/sso/callback` routes that provision users + memberships on first login
- Org-level aggregations: `aggregateFindings` / `trendOverTime` / `topRegressions`
  pure-logic reducers in shared, exposed via `/v1/orgs/:id/aggregations` and
  `/v1/orgs/:id/trends` (day or week buckets with zero-fill)
- CI providers: GitLab template (`ci/gitlab/`), CircleCI orb (`ci/circleci/`),
  Bitbucket Pipelines example (`ci/bitbucket/`), shared `ubh-scan.sh` runner, generic
  `/v1/integrations/webhook` fallback
- Browser-extension recorder: Chrome MV3 manifest + content / background / popup
  scripts under `extension/recorder/` that capture click / input / navigation into
  the Flow JSON format

## What's not wired

| Item | Reason | Status |
|---|---|---|
| Firecracker microVM sandbox | Requires production infra | Worker runs Playwright directly |
| Real Stripe integration | Needs live keys | `BILLING_PROVIDER=mock` works end-to-end; Stripe path is wired but stubs throw without env |
| AWS KMS | Needs AWS account | `KMS_PROVIDER=local` works end-to-end; AWS path is wired but stubs throw without env |
| 50-page hand-curated eval set | Needs human curation | Synthetic + 7 fixtures shipped; runner ready for more |
| Two-pass adversarial verification | Phase 2 week 5 | Confidence threshold only |
| Marketing site, status page | Not code | n/a |
| Load test at 100 / 10× concurrent scans | Needs cloud infra | n/a |
| Onboarding flow tuned for first scan in 60s | Needs UX iteration | n/a |
| Real WorkOS SSO | Needs WorkOS account | `SSO_PROVIDER=mock` works end-to-end; WorkOS path throws without env |
| Real Slack / Linear / Jira | Needs OAuth apps + API tokens | `*_PROVIDER=mock` short-circuits external calls |
| Multi-region browser-worker deployment | Needs cloud infra | n/a |
| On-call rotation / PagerDuty | Operational, not code | n/a |
| Browser-extension Web Store packaging | Submission process | Skeleton ships, load-unpacked works locally |

---

## Contributing

- Run `pnpm typecheck && pnpm test` before committing.
- The bug taxonomy in `packages/shared/src/types.ts` is the source of truth — if you
  rename a category, update the system prompt in `apps/worker/src/agent/prompts.ts`
  in the same change.
- Keep `LLM_PROVIDER=mock` working: it's the contract the agent loop tests rely on.
- New deterministic checks belong in `apps/worker/src/deterministic/`; wire them into
  `runDeterministicChecks` and `formatDeterministicForPrompt` so the agent sees their
  results in its first turn.
