# OpenAI Call Path — Non-Blocking Worker Proof — Implementation Plan

## Overview

This implements `F-02` on the roadmap: prove that the Worker can call OpenAI from a real request path without blocking the response, that a caller who leaves and comes back can still learn the result is ready, and that the whole thing survives Cloudflare's actual production limits — not just `astro dev`. It is deliberately not a ranking feature: no prompt design, no hierarchy schema, no UI. It is the plumbing `S-02` (AI contact hierarchy) will build its real call on top of.

## Current State Analysis

The repo has zero AI-related code today: no `openai` dependency, no KV/D1/Durable Object/Queue bindings, no `src/worker.ts` (the stock `@astrojs/cloudflare/entrypoints/server` handles all requests). Secrets follow an established three-location pattern (`.dev.vars` → Workers Secrets via `wrangler secret put` → GitHub Secrets), already exercised for `SUPABASE_URL`/`SUPABASE_KEY` and prepped (but unused) for `RESEND_API_KEY`. The one existing "prove it works" precedent is `scripts/verify-rls.ts` — a standalone `tsx` script, not a test framework (none exists in this repo).

### Key Discoveries:

- `Astro.locals.cfContext` is a real, already-available `ExecutionContext` — confirmed directly in `node_modules/@astrojs/cloudflare/dist/utils/handler.js:64-92` (`locals.cfContext = context`, and the removed `Astro.locals.runtime.ctx` getter's error message literally says `"Use 'Astro.locals.cfContext' instead."`). This means `Astro.locals.cfContext.waitUntil(promise)` works today, from any existing route, with **no** custom Worker entrypoint, no Queues, no Durable Objects, and no Workflows — the roadmap's open question about the non-blocking generation shape resolves in favor of the simplest option.
- The official `openai` npm SDK lists Cloudflare Workers as a supported runtime and needs no `nodejs_compat` for a standard (non-streaming) `chat.completions.create` call.
- Cloudflare's free-plan 10ms CPU limit only counts CPU-bound execution — time spent awaiting `fetch()` (i.e. waiting on OpenAI) does not count against it. A single background call is cheap against both the CPU budget and the 50-subrequests/request ceiling (1 subrequest).
- `src/lib/supabase.ts:6-9` establishes this repo's convention for an optional secret: return `null` from the client factory when the env var is absent, rather than throwing. The OpenAI client factory follows the same shape.
- `astro.config.mjs:22-25` is where `SUPABASE_URL`/`SUPABASE_KEY` are declared via `envField({ context: "server", access: "secret", optional: false })` — `OPENAI_API_KEY` is added the same way.

## Desired End State

An authenticated internal route can be POSTed to, kicks off a real OpenAI call in the background via `Astro.locals.cfContext.waitUntil`, and returns immediately with a job id. A GET on the same route with that job id reports `pending` / `done` / `failed` by reading a KV entry the background work wrote. `scripts/verify-openai-call.ts` proves this end-to-end against a deployed preview URL — not local `astro dev` — confirming the POST response returns before the OpenAI call completes and that the status eventually reaches `done`.

**Verification**: `npm run verify:ai-call` (against a deployed preview URL) passes; `wrangler tail` during the run shows no uncaught errors; the POST response time is decoupled from the OpenAI call's actual duration.

### Key Discoveries:

(see Current State Analysis above — kept together to avoid duplication for this small a foundation)

## What We're NOT Doing

- No ranking prompt, no hierarchy data model, no UI — that's `S-02`.
- No custom `src/worker.ts` entrypoint, no Cloudflare Queues, no Durable Objects, no Workflows — `ctx.waitUntil` is sufficient for a single fire-and-forget call, per research above.
- No retry-with-backoff logic beyond what the `openai` SDK already does by default.
- No error-tracking vendor — failures are logged via `console.error` and a KV `failed` status, matching this repo's existing "platform logs, no vendor" posture.
- No production secret rotation by the agent — `wrangler secret put OPENAI_API_KEY` is a human-run step, per `CLAUDE.md`.

## Implementation Approach

Add `OPENAI_API_KEY` through the exact same `astro:env/server` + three-location-secret pattern already used for Supabase and prepped for Resend. Add one new KV namespace as the minimal persistent "ready" signal (chosen over logs-only because the NFR requires a user who left the view to still learn the result is ready, which only something that outlives the request can do; chosen over a Durable Object because a single ephemeral status flag doesn't need DO's heavier state-machine model). Wire one authenticated route pair (`POST` to start, `GET` to poll) that calls the OpenAI SDK inside `Astro.locals.cfContext.waitUntil`, with a try/catch that writes a terminal KV status either way. Verify with a standalone `tsx` script against a real deployed preview URL, matching this repo's one existing verification precedent.

## Phase 1: Secret + env schema plumbing

### Overview

Get `OPENAI_API_KEY` flowing through `astro:env/server` locally, the same shape as `SUPABASE_URL`/`SUPABASE_KEY`, without yet touching production.

### Changes Required:

#### 1. Astro env schema

**File**: `astro.config.mjs`

**Intent**: Declare `OPENAI_API_KEY` as a server-only secret env var, following the existing `SUPABASE_URL`/`SUPABASE_KEY` entries in the same `env.schema` block.

**Contract**: `OPENAI_API_KEY: envField.string({ context: "server", access: "secret", optional: true })`. Use `optional: true` (unlike the Supabase vars' `optional: false`) — this foundation has no live traffic depending on it yet, and the client factory below already has a defensive `null`-return path for a missing key, matching `src/lib/supabase.ts`'s existing convention.

#### 2. Local secret

**File**: `.dev.vars` (gitignored, not committed)

**Intent**: The user adds their real key to `.dev.vars` locally (manual step — this is their existing OpenAI account key). The adapter loads `.dev.vars` into `process.env` during `astro:config:setup` (`node_modules/@astrojs/cloudflare/dist/index.js:292-300`), and that hook runs for both `dev` and `build` — so a local build sees the key too.

**Contract**: `.dev.vars` gains an `OPENAI_API_KEY` line. `.env.example` needs **no** change: the `OPENAI_API_KEY=###` placeholder already landed in `d4ea632`, after this plan was written.

#### 3. GitHub Secrets entry

**File**: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Intent**: Keep CI's build env in step with the schema, defensively — mirroring the existing `SUPABASE_URL`/`SUPABASE_KEY` entries. This is **not** load-bearing yet: because §1 declares the var `optional: true`, `npm run build` succeeds whether or not the secret is present. It becomes required the moment `S-02` flips it to `optional: false`, which is why the wiring goes in now rather than being discovered then.

**Contract**: Add `OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}` to the existing `env:` block under the `npm run build` step in both workflow files. Adding the GitHub Secret itself is a human step; until it exists the workflow passes an empty value and CI still goes green — so step 1.4 is a follow-up, not a blocker for this phase or for Phase 3.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Build succeeds locally with `OPENAI_API_KEY` present in `.dev.vars`: `npm run build`

#### Manual Verification:

- User has added their real `OPENAI_API_KEY` to local `.dev.vars`
- User has added `OPENAI_API_KEY` to the GitHub repo's Actions secrets
- `npm run dev` boots without a new config-related error

---

## Phase 2: KV-backed async call route

### Overview

Add the KV namespace, the `openai` package, and the authenticated route pair that actually proves the non-blocking call path.

### Changes Required:

#### 1. KV namespace + binding

**File**: `wrangler.jsonc`

**Intent**: A minimal KV namespace to hold ephemeral job-status entries (`pending` / `done` / `failed`), created via the Wrangler CLI for both remote and local-dev use.

**Contract**: Run `npx wrangler kv namespace create AI_JOBS` (remote id) and `npx wrangler kv namespace create AI_JOBS --preview` (local-dev id), then add the resulting `kv_namespaces` entry to `wrangler.jsonc`:
```jsonc
"kv_namespaces": [
  { "binding": "AI_JOBS", "id": "<remote-id-from-command-output>", "preview_id": "<preview-id-from-command-output>" }
]
```
Regenerate `worker-configuration.d.ts` afterward (`npx wrangler types`) so `Env.AI_JOBS` is typed. Typing the binding is not the same as reaching it at runtime — §3 below defines how the code actually gets hold of it.

#### 2. OpenAI package + client factory

**File**: `package.json` (dependency), `src/lib/openai.ts` (new)

**Intent**: Add the official `openai` SDK, and a client factory mirroring `src/lib/supabase.ts`'s `createClient` shape — returns `null` when `OPENAI_API_KEY` is absent, so callers can defensively no-op instead of throwing.

**Contract**: `npm install openai`. `src/lib/openai.ts` exports a `createOpenAIClient()` function reading `OPENAI_API_KEY` from `astro:env/server`, returning `null` if unset or a configured `OpenAI` client instance otherwise.

#### 3. KV access helper

**File**: `src/lib/ai-jobs.ts` (new)

**Intent**: One place that knows how to reach the `AI_JOBS` binding, so the route — and later `S-02` — never imports it directly. Same containment `src/lib/supabase.ts` gives the Supabase client.

**Contract**: The binding is **not** reachable through `astro:env/server` (`envField` models only string/number/boolean/enum, not a KV namespace) and **not** through `Astro.locals.runtime.env`, which throws in `@astrojs/cloudflare` v13 — `"has been removed in Astro v6. Use 'import { env } from \"cloudflare:workers\"' instead."` (`dist/utils/handler.js:66-70`). That message names the one supported path, and the module is declared and typed in `worker-configuration.d.ts:12188`. This is the repo's first Cloudflare binding, so this file sets the pattern for every later one.

Exports `readJob(jobId)` and `writeJob(jobId, status)` over `env.AI_JOBS`. Every write passes `expirationTtl: 3600` — a job status is worthless an hour later, and `S-02` will copy this module under real traffic, so the TTL belongs in the pattern rather than being retrofitted once keys have accumulated.

Note the companion rule appended to `context/foundation/lessons.md`: **config values** come from `astro:env/server`, **bindings** come from `cloudflare:workers`. The existing "env vars go through `astro:env/server` only" rule governs the former and does not forbid the latter.

#### 4. Trigger + status route

**File**: `src/pages/api/internal/ai-ping.ts` (new)

**Intent**: `POST` generates a job id, writes a `pending` entry through §3's `writeJob`, starts the OpenAI call via `Astro.locals.cfContext.waitUntil(...)` (model: `gpt-4o-mini`, a trivial fixed prompt — no ranking logic), and returns `202` with the job id immediately, before the OpenAI call resolves. The background promise's `try/catch` writes `done` (with the response text) or `failed` (with the error message) to the same key when it settles, again through `writeJob` — so the TTL applies to terminal states too. `GET` with a `?jobId=` query param returns `readJob`'s current status. Both methods require `context.locals.user` to be set (401 JSON response otherwise) — this route is not meant for anonymous or unauthenticated callers, since it triggers a real billed API call.

**Contract**: `POST /api/internal/ai-ping` → `202 { jobId }`. `GET /api/internal/ai-ping?jobId=<id>` → `200 { status: "pending" | "done" | "failed", result?: string, error?: string }`, or `404` if the job id is unknown to KV. Both return `401` when `context.locals.user` is null.

**Convention note**: every existing API route redirects to `/auth/signin` on a missing user (`src/pages/api/people.ts:8`, `src/pages/api/profile.ts`). This route deliberately does not — `/api/internal/*` is a JSON contract meant for machine callers (`202`/`200`/`401`/`404`), while the form-post routes stay with redirects because a browser form submission has somewhere to be redirected *to*. This is an intentional second convention, scoped to `/api/internal/*`.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Build succeeds: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- `npm run dev` → authenticated `POST /api/internal/ai-ping` returns `202` with a job id near-instantly (well before a real OpenAI round-trip would complete)
- Polling `GET /api/internal/ai-ping?jobId=...` shows `pending` then eventually `done` with a result string
- Unauthenticated request to either method returns `401`

---

## Phase 3: Production secret + verification

### Overview

Set the real production secret (human step), deploy to a preview URL, and prove the whole path against actual Cloudflare production limits — not `astro dev`.

### Changes Required:

#### 1. Production secret

**Human step, not delegated**: `npx wrangler secret put OPENAI_API_KEY`, then `npx wrangler secret list` to confirm the name is present (value is write-only and never displayed), matching this repo's existing posture that production secret rotation is a human operation.

#### 2. Verification script

**File**: `scripts/verify-openai-call.ts` (new), `package.json` (new script)

**Intent**: A standalone `tsx` script with no test framework, borrowing `verify-rls.ts`'s *shape* — `assert()` + a `failures[]` array, non-zero exit on any failure. It targets a **deployed** URL (argument or env var, never hardcoded to localhost), because the Outcome this foundation exists to prove ("checked against Cloudflare's production limits") cannot be demonstrated against `astro dev`.

**Authentication — the part `verify-rls.ts` does *not* answer.** That script reads the **local** stack via `supabase status -o json`, explicitly refuses to run against a non-localhost URL, and mints users with the `SERVICE_ROLE_KEY`. None of that transfers: this script must reach a deployed Worker backed by **hosted** Supabase, and the route's auth check reads `context.locals.user`, which the middleware derives from `@supabase/ssr` cookies on the request. A service-role key bypasses RLS at the database, but produces no browser session — the Worker never sees it.

So the script does not hand-craft those cookies (their chunked `sb-<ref>-auth-token.0/.1` format is `@supabase/ssr`'s internal detail and shifts between versions). It has the app mint them:

1. `POST` form-encoded `email`/`password` to `<url>/api/auth/signin` with `redirect: "manual"`, so the `302` is not followed and its headers survive.
2. Collect `response.headers.getSetCookie()` — these are the exact cookies the middleware will read back, produced by the same `createClient` (`src/pages/api/auth/signin.ts:20-23`).
3. Join them into one `Cookie:` header and send it on every subsequent request.
4. `POST /api/internal/ai-ping`, assert the response returns well under a real OpenAI round-trip (proving non-blocking), then poll `GET .../ai-ping?jobId=...` until `done`/`failed` or timeout, asserting the terminal status is `done`.

This keeps the script off `@supabase/ssr` internals and exercises the real sign-in path, which is the same contract step 2.6 tests from the unauthenticated side.

**Contract**: `npm run verify:ai-call -- <preview-or-prod-url>` runs the script. Test-account credentials arrive as env vars (`VERIFY_EMAIL` / `VERIFY_PASSWORD`) — never hardcoded, never committed. The script exits non-zero with a clear reason on any assertion failure.

**Prerequisite (human, one-off)**: a test account must exist in the **hosted** Supabase project, with its email already confirmed — `signInWithPassword` rejects an unconfirmed address when email confirmation is on, and this repo has a `/auth/confirm-email` route, so it is. Creating it is a human step, listed in this phase's manual verification.

### Success Criteria:

#### Automated Verification:

- `npm run verify:ai-call -- <preview-url>` passes against a deployed preview URL

#### Manual Verification:

- `wrangler tail` during the verification run shows the OpenAI call completing after the HTTP response was already sent, with no uncaught exceptions
- `wrangler secret list` shows `OPENAI_API_KEY` present in production
- A test account exists in the hosted Supabase project with its email confirmed, and signing in with it through the deployed app succeeds
- `VERIFY_EMAIL` / `VERIFY_PASSWORD` are exported in the shell running the script, and appear in no committed file

**Implementation Note**: After this phase's automated verification passes, pause for manual confirmation from the human that the `wrangler tail` observation and production secret check succeeded before considering this foundation done.

---

## Testing Strategy

### Unit Tests:

- None — this repo has no test framework; verification follows the existing standalone-script convention.

### Integration Tests:

- `scripts/verify-openai-call.ts` is the integration-level proof: real HTTP calls against a deployed Worker, real KV reads, a real (cheap) OpenAI call.

### Manual Testing Steps:

1. Deploy to preview (`npm run preview:upload`).
2. Run `npm run verify:ai-call -- <preview-url>`.
3. Watch `wrangler tail` during the run and confirm the response returns before the background OpenAI call finishes.
4. Confirm an unauthenticated request to `/api/internal/ai-ping` is rejected with `401`.

## Performance Considerations

A single OpenAI call costs ~0 CPU-ms (network wait isn't CPU time) and 1 of the 50-subrequest budget — no changes needed elsewhere to stay within Cloudflare's free-plan limits for this scope.

## Migration Notes

Not applicable — no Supabase schema changes in this foundation.

## References

- Related roadmap item: `context/foundation/roadmap.md` (`F-02: openai-ranking-call-path`)
- Existing verification precedent: `scripts/verify-rls.ts`
- Existing optional-secret client pattern: `src/lib/supabase.ts:6-9`
- Existing env schema: `astro.config.mjs:22-25`
- Confirmed `cfContext` API: `node_modules/@astrojs/cloudflare/dist/utils/handler.js:64-92`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Secret + env schema plumbing

#### Automated

- [x] 1.1 Type check passes: `npx astro check` — 7cbd2b3
- [x] 1.2 Build succeeds locally with `OPENAI_API_KEY` present in `.dev.vars`: `npm run build` — 7cbd2b3

#### Manual

- [x] 1.3 User has added their real `OPENAI_API_KEY` to local `.dev.vars` — 7cbd2b3
- [ ] 1.4 User has added `OPENAI_API_KEY` to the GitHub repo's Actions secrets
- [x] 1.5 `npm run dev` boots without a new config-related error — 7cbd2b3

### Phase 2: KV-backed async call route

#### Automated

- [x] 2.1 Type check passes: `npx astro check`
- [x] 2.2 Build succeeds: `npm run build`
- [x] 2.3 Lint passes: `npm run lint`

#### Manual

- [x] 2.4 `npm run dev` → authenticated `POST /api/internal/ai-ping` returns `202` with a job id near-instantly
- [x] 2.5 Polling `GET /api/internal/ai-ping?jobId=...` shows `pending` then eventually `done` with a result string
- [x] 2.6 Unauthenticated request to either method returns `401`

### Phase 3: Production secret + verification

#### Automated

- [ ] 3.1 `npm run verify:ai-call -- <preview-url>` passes against a deployed preview URL

#### Manual

- [ ] 3.2 `wrangler tail` during the verification run shows the OpenAI call completing after the HTTP response was already sent, with no uncaught exceptions
- [ ] 3.3 `wrangler secret list` shows `OPENAI_API_KEY` present in production
- [ ] 3.4 A test account exists in the hosted Supabase project with its email confirmed, and signing in with it through the deployed app succeeds
- [ ] 3.5 `VERIFY_EMAIL` / `VERIFY_PASSWORD` are exported in the shell running the script, and appear in no committed file
