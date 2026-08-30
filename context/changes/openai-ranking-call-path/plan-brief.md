# OpenAI Call Path — Plan Brief

> Full plan: `context/changes/openai-ranking-call-path/plan.md`

## What & Why

This is `F-02` on the roadmap: prove the Worker can make a server-side OpenAI call that never blocks the user's view, with a "ready" signal that survives the user leaving and coming back — verified against Cloudflare's actual production limits, not just `astro dev`. It is the plumbing `S-02` (AI contact hierarchy) will build its real ranking call on top of; it deliberately contains no prompt design, no ranking logic, no UI.

## Starting Point

The repo has zero AI-related code today — no `openai` dependency, no KV/D1/Durable Object/Queue bindings, no custom Worker entrypoint. Secrets already follow an established three-location pattern (`.dev.vars` → `wrangler secret put` → GitHub Secrets), proven for Supabase and prepped-but-unused for Resend. The one "prove it works" precedent in this repo is `scripts/verify-rls.ts` — a standalone `tsx` script, no test framework exists.

## Desired End State

An authenticated route can be POSTed to and returns near-instantly with a job id, while a real OpenAI call keeps running in the background. A GET with that job id reports `pending`/`done`/`failed`, so a caller who left and came back still learns the result is ready. A standalone script proves this against a deployed preview URL.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Async mechanism | `Astro.locals.cfContext.waitUntil` | Confirmed live in the installed `@astrojs/cloudflare` v13 — no custom entrypoint, Queues, Durable Objects, or Workflows needed for a single fire-and-forget call. | Plan (research) |
| Trigger surface | New authenticated internal API route | Actually exercises the real Worker request path under production limits, which is the point of this foundation. | Plan |
| "Ready" signal | New KV namespace, pollable status | Only something that outlives the request satisfies the NFR that a user who leaves can still be told the result is ready. | Plan |
| Error handling | try/catch + structured log + terminal KV status | Matches the repo's existing "no error-tracking vendor, use platform logs" posture; gives a poller a real terminal state. | Plan |
| Verification | Manual production check + standalone `tsx` script | Matches the repo's one existing verification precedent (`verify-rls.ts`) and gives `S-02` something to build its trigger on. | Plan |
| Model | `gpt-4o-mini` (cheapest current small model) | Negligible cost per test call; the real ranking model choice belongs to `S-02`, not this foundation. | Plan |
| First thing to cut under time pressure | KV status → fall back to logs-only | Keeps the harder-to-redo parts (secret wiring, route, `waitUntil` call) intact if scope needs trimming. | Plan |

## Scope

**In scope:**
- `OPENAI_API_KEY` through `astro:env/server`, in all three secret locations
- One KV namespace + binding for job status
- `openai` SDK + a client factory mirroring `src/lib/supabase.ts`'s optional-client pattern
- `POST`/`GET /api/internal/ai-ping` route pair (auth-guarded)
- `scripts/verify-openai-call.ts` run against a deployed preview URL

**Out of scope:**
- Any ranking prompt, hierarchy data model, or UI (`S-02`)
- Custom `src/worker.ts`, Cloudflare Queues, Durable Objects, Workflows
- Retry-with-backoff beyond the `openai` SDK's own defaults
- Any error-tracking vendor

## Architecture / Approach

One authenticated route kicks off `Astro.locals.cfContext.waitUntil(openai.chat.completions.create(...))` and returns immediately; the background promise writes its terminal status to a new KV namespace, which a second route (or the same route via GET) polls. No new Worker entrypoint — this all runs inside the existing stock `@astrojs/cloudflare` handler.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Secret + env schema plumbing | `OPENAI_API_KEY` flowing through `astro:env/server` locally | Human forgets to add the GitHub Actions secret before Phase 3's CI-adjacent steps |
| 2. KV-backed async call route | Working `POST`/`GET` route pair proving the non-blocking shape locally | Auth check on an API route (401 JSON) is a slightly different contract than the existing page-redirect middleware pattern — easy to get inconsistent |
| 3. Production secret + verification | `verify-openai-call.ts` passing against a real deployed preview URL | Production secret is a human-run step — easy to forget before running verification |

**Prerequisites:** `wrangler` already authenticated locally (established in the `deployment` change); user holds a valid OpenAI API key already.
**Estimated effort:** ~1 session across 3 phases — this is deliberately the smallest slice that proves the call path, not a domain feature.

## Open Risks & Assumptions

- Assumes the user's OpenAI account has billing enabled for `gpt-4o-mini` — not verified as part of this plan.
- KV's free-tier read/write limits are generous for this scope but not explicitly checked against production traffic volume (irrelevant until `S-02` drives real usage).
- The verification script needs a way to authenticate against a deployed environment (reusing the existing Supabase auth flow) — exact test-account mechanics are an implementation detail resolved when Phase 3 is built, not a planning-time open question.

## Success Criteria (Summary)

- An authenticated `POST /api/internal/ai-ping` on a deployed preview URL returns before the OpenAI call finishes, and `GET` polling reaches `done`.
- `wrangler tail` shows no uncaught errors during a full run.
- `wrangler secret list` confirms `OPENAI_API_KEY` is set in production.
