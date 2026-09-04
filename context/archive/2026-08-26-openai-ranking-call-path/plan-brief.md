# OpenAI Call Path — Plan Brief

> Full plan: `context/changes/openai-ranking-call-path/plan.md`
> Plan review: `context/changes/openai-ranking-call-path/reviews/plan-review.md` (7 findings, all fixed; verdict SOUND)

## What & Why

This is `F-02` on the roadmap: prove the Worker can make a server-side OpenAI call that never blocks the user's view, with a "ready" signal that survives the user leaving and coming back — verified against Cloudflare's actual production limits, not just `astro dev`. It is the plumbing `S-02` (AI contact hierarchy) will build its real ranking call on top of; it deliberately contains no prompt design, no ranking logic, no UI.

## Starting Point

The repo has zero AI-related code today — no `openai` dependency, no KV/D1/Durable Object/Queue bindings, no custom Worker entrypoint. Secrets already follow an established three-location pattern (`.dev.vars` → `wrangler secret put` → GitHub Secrets), proven for Supabase and prepped-but-unused for Resend. The one "prove it works" precedent in this repo is `scripts/verify-rls.ts` — a standalone `tsx` script, no test framework exists. Its *shape* transfers (`assert()` + `failures[]`, non-zero exit); its *mechanics* do not — it reads the local stack via `supabase status`, refuses non-localhost URLs, and mints users with the service-role key, none of which reaches a deployed Worker.

## Desired End State

An authenticated route can be POSTed to and returns near-instantly with a job id, while a real OpenAI call keeps running in the background. A GET with that job id reports `pending`/`done`/`failed`, so a caller who left and came back still learns the result is ready. A standalone script proves this against a deployed preview URL.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Async mechanism | `Astro.locals.cfContext.waitUntil` | Confirmed live in the installed `@astrojs/cloudflare` v13 — no custom entrypoint, Queues, Durable Objects, or Workflows needed for a single fire-and-forget call. | Plan (research) |
| Trigger surface | New authenticated internal API route | Actually exercises the real Worker request path under production limits, which is the point of this foundation. | Plan |
| "Ready" signal | New KV namespace, pollable status | Only something that outlives the request satisfies the NFR that a user who leaves can still be told the result is ready. | Plan |
| Error handling | try/catch + structured log + terminal KV status | Matches the repo's existing "no error-tracking vendor, use platform logs" posture; gives a poller a real terminal state. | Plan |
| KV binding access | `import { env } from "cloudflare:workers"`, wrapped in `src/lib/ai-jobs.ts` | `astro:env/server` cannot model a namespace and `Astro.locals.runtime.env` throws in v13 — this is the one supported path, and one wrapper file keeps it contained. | Plan review (F1) |
| Job-status lifetime | `expirationTtl: 3600` on every KV write | A status is worthless an hour later, and `S-02` copies this helper under real traffic — the TTL belongs in the pattern, not in a later cleanup. | Plan review (F5) |
| Verification auth | Sign in through `/api/auth/signin`, reuse its `Set-Cookie` jar | Lets the app mint `@supabase/ssr` cookies instead of hand-crafting their chunked format, and exercises the real sign-in path. | Plan review (F2) |
| Verification | Manual production check + standalone `tsx` script | Matches the repo's one existing verification precedent (`verify-rls.ts`) and gives `S-02` something to build its trigger on. | Plan |
| Model | `gpt-4o-mini` (cheapest current small model) | Negligible cost per test call; the real ranking model choice belongs to `S-02`, not this foundation. | Plan |
| First thing to cut under time pressure | KV status → fall back to logs-only | Keeps the harder-to-redo parts (secret wiring, route, `waitUntil` call) intact if scope needs trimming. | Plan |

## Scope

**In scope:**
- `OPENAI_API_KEY` through `astro:env/server`, in all three secret locations
- One KV namespace + binding for job status
- `openai` SDK + a client factory mirroring `src/lib/supabase.ts`'s optional-client pattern
- `src/lib/ai-jobs.ts` — the only file that imports the KV binding, with TTL baked in
- `POST`/`GET /api/internal/ai-ping` route pair (auth-guarded)
- `scripts/verify-openai-call.ts` run against a deployed preview URL

**Out of scope:**
- Any ranking prompt, hierarchy data model, or UI (`S-02`)
- Custom `src/worker.ts`, Cloudflare Queues, Durable Objects, Workflows
- Retry-with-backoff beyond the `openai` SDK's own defaults
- Any error-tracking vendor

## Architecture / Approach

One authenticated route kicks off `Astro.locals.cfContext.waitUntil(openai.chat.completions.create(...))` and returns immediately; the background promise writes its terminal status through `src/lib/ai-jobs.ts` (the single importer of `cloudflare:workers`' `env`) into a new KV namespace, which the same route polls via GET. No new Worker entrypoint — this all runs inside the existing stock `@astrojs/cloudflare` handler.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Secret + env schema plumbing | `OPENAI_API_KEY` flowing through `astro:env/server` locally | Human forgets to add the GitHub Actions secret before Phase 3's CI-adjacent steps |
| 2. KV-backed async call route | Working `POST`/`GET` route pair proving the non-blocking shape locally | Auth check on an API route (401 JSON) is a slightly different contract than the existing page-redirect middleware pattern — easy to get inconsistent |
| 3. Production secret + verification | `verify-openai-call.ts` passing against a real deployed preview URL | Two human-run prerequisites, both easy to forget: the production secret, and a confirmed test account in *hosted* Supabase for the script to sign in as |

**Prerequisites:** `wrangler` already authenticated locally (established in the `deployment` change); user holds a valid OpenAI API key already; a confirmed test account in the hosted Supabase project before Phase 3 (see Open Risks).
**Estimated effort:** ~1 session across 3 phases — this is deliberately the smallest slice that proves the call path, not a domain feature.

## Open Risks & Assumptions

- Assumes the user's OpenAI account has billing enabled for `gpt-4o-mini` — not verified as part of this plan.
- KV's free-tier read/write limits are generous for this scope but not explicitly checked against production traffic volume (irrelevant until `S-02` drives real usage).
- The verification script's authentication is settled (plan review F2): it POSTs to `/api/auth/signin` with `redirect: "manual"` and reuses the returned cookie jar. What this adds is a one-off human step — a test account in the **hosted** Supabase project with its email already confirmed, since `signInWithPassword` rejects an unconfirmed address. Credentials reach the script as `VERIFY_EMAIL` / `VERIFY_PASSWORD`, never committed.
- Unverified: whether `@cloudflare/vite-plugin` exposes the KV binding through `cloudflare:workers`' `env` in `astro dev` exactly as production workerd does. Confirmed or falsified at step 2.4, before Phase 3 depends on it.

## Success Criteria (Summary)

- An authenticated `POST /api/internal/ai-ping` on a deployed preview URL — authenticated via the `/api/auth/signin` cookie jar — returns before the OpenAI call finishes, and `GET` polling reaches `done`.
- `wrangler tail` shows no uncaught errors during a full run.
- `wrangler secret list` confirms `OPENAI_API_KEY` is set in production.
