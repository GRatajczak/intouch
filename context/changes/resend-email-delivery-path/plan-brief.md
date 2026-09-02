# Resend Email Delivery Path — Plan Brief

> Full plan: `context/changes/resend-email-delivery-path/plan.md`

## What & Why

Prove the Worker can send one real email to a real inbox through Resend, fired by a Cloudflare Cron Trigger rather than a request handler, with the outcome observable in logs. This closes F-04 on the roadmap — the last unproven piece of FR-008's delivery channel — and unblocks S-04 (decay-driven reminders), the only slice that actually sends anything to real users.

## Starting Point

`RESEND_API_KEY` already sits in `.dev.vars`/`.env.example` but isn't wired into `astro.config.mjs`, GitHub Actions, or any code. No `resend` package, no `triggers.crons`, and `wrangler.jsonc`'s `main` points straight at Astro's default Cloudflare entrypoint, which only exports `fetch` — nothing in this repo runs on a schedule yet. This is also the first code that will execute with no authenticated user in scope.

## Desired End State

A daily Cron Trigger fires a custom Worker export that sends a minimal branded HTML email (the design bundle's header/footer chrome, placeholder body) to a configured test recipient via Resend, logging the outcome. Proven against a real deployed Worker, not `astro dev` — a real email lands in a real inbox.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Sending identity | Resend test sender (`onboarding@resend.dev`) | Zero DNS lead time; enough for an MVP with one user, domain swap tracked as a real gap before a second user exists | Plan |
| Cron cadence | Real daily schedule shipped from the start | Matches the NFR directly — no throwaway config to remember to change | Plan |
| Dispatch shape | Direct send only, no chunking scaffolding | Matches the roadmap's explicit "no reminder logic" scope cap; S-04 designs its own sweep pattern when it has real multi-recipient data | Plan |
| Production verification | Temporary tight cron interval, observed, then finalized to daily | No confirmed on-demand "fire cron now" mechanism exists in production — this gets a fast, real proof without waiting up to 24h | Plan |
| Email content | Design-bundle chrome (logo, wordmark, footer) as a reusable shell; placeholder body | Reuses real design work for the wrapper without pretending to build the ranking-dependent reminder content that's S-04's job | Plan |
| Send observability | `console.log`/`console.error` via Workers Logs only, no persistence | Matches this repo's existing "platform logs, no vendor" posture (same choice F-02 made for OpenAI failures) | Plan |
| Recipient config | `RESEND_TEST_RECIPIENT` env var, same three-location pattern as the API key | No personal email address hardcoded in source, consistent with how every other identity-adjacent value is handled here | Plan |

## Scope

**In scope:**
- `RESEND_API_KEY` + `RESEND_TEST_RECIPIENT` through `astro:env/server` and all three secret locations
- A custom Worker entrypoint (`src/worker.ts`) adding a `scheduled` export alongside Astro's `fetch`
- A daily `triggers.crons` entry in `wrangler.jsonc`
- A minimal reusable HTML email shell (chrome only) and a Resend client factory
- Production verification via a temporary tight interval, dashboard + `wrangler tail` + real inbox, then finalized to daily

**Out of scope:**
- Reminder content, decay logic, ranking data in the email
- Full email template design beyond the chrome shell
- Multi-recipient dispatch/chunking/queue scaffolding
- Owned-domain verification
- Any Supabase call inside the scheduled handler

## Architecture / Approach

`wrangler.jsonc`'s `main` moves from Astro's default Cloudflare entrypoint to a new `src/worker.ts`, which re-exports Astro's `fetch` unchanged (via the public `@astrojs/cloudflare/handler` export) and adds a `scheduled` handler. That handler calls a `resend` SDK client (mirroring the existing `src/lib/openai.ts` optional-client pattern) with HTML built by a small shell function styled from the design bundle's email mockup, sending to one configured test recipient.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Secret + env schema plumbing | `RESEND_API_KEY`/`RESEND_TEST_RECIPIENT` flowing through all three secret locations | Low — directly mirrors the already-proven `OPENAI_API_KEY` pattern |
| 2. Scheduled send mechanism | Custom Worker entrypoint, Resend client, email shell, Cron Trigger config | Getting the `fetch`+`scheduled` export shape wrong would break the whole Worker — de-risked by verifying `@astrojs/cloudflare/handler` exists in the installed version before writing code |
| 3. Production secret + verification | Real send proven against production, secrets set, final daily schedule shipped | Forgetting to swap the temporary tight interval back to daily before calling this done |

**Prerequisites:** None — F-04 has no dependencies on the roadmap.
**Estimated effort:** ~1 session across 3 phases, following the `F-02` precedent closely.

## Open Risks & Assumptions

- Domain verification lead time isn't solved here — the test sender is a deliberate, acknowledged gap that must close before this app has a second real user.
- No production mechanism is confirmed to fire a Cron Trigger on demand; Phase 3's temporary-interval approach is the best available substitute, not a guarantee Cloudflare won't change this later.
- The email shell reuses the design bundle's visual language but is not itself a design-reviewed artifact — S-04 should sanity-check it against the finished template before real reminder content goes in.

## Success Criteria (Summary)

- A real email, built from the reusable shell, arrives in the configured recipient's inbox as the result of an actual Cloudflare Cron Trigger firing against the deployed Worker.
- `wrangler tail` and the dashboard's `Trigger Events` both show a clean, successful invocation with no uncaught exceptions.
- The shipped `wrangler.jsonc` carries the real daily schedule, and both secrets are confirmed present in production via `wrangler secret list`.
