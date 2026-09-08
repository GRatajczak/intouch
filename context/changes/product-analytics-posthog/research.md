---
date: 2026-09-04T22:13:01+02:00
researcher: g.ratajczak97@gmail.com (Claude Code, Opus 5)
git_commit: 9df35c0758a83b6eb22af99e4386832ef54e20b6
branch: main
repository: intouch
topic: "PostHog product analytics for the primary success funnel (roadmap F-06)"
tags: [research, codebase, analytics, posthog, cloudflare-workers, privacy, funnel]
status: complete
last_updated: 2026-09-04
last_updated_by: g.ratajczak97@gmail.com (Claude Code, Opus 5)
---

# Research: PostHog product analytics for the primary success funnel

**Date**: 2026-09-04 22:13 CEST
**Researcher**: g.ratajczak97@gmail.com (Claude Code, Opus 5)
**Git Commit**: `9df35c0` (`9df35c0758a83b6eb22af99e4386832ef54e20b6`)
**Branch**: `main` — **18 commits ahead of `origin/main`; this commit is not pushed**, so GitHub permalinks would resolve to nothing. All references below are local paths.
**Repository**: `intouch`

## Research Question

Roadmap foundation `F-06` (`product-analytics-posthog`) wants the PRD's primary success funnel measurable in PostHog — five named events, no third-party personal data in any payload. Before planning: where does each funnel step truthfully complete in this codebase, what personal data sits within arm's reach at each of those points, how does this repo already wire a vendor and its secret, how should an event physically leave a Cloudflare Worker, and where would a consent toggle land?

Scope agreed with the user before research began:
- **Repo mapping + PostHog/Workers feasibility** (not one without the other).
- **Exactly the five Success-Criteria steps** — not every mutating API route.
- Focus on all four of: PII audit at call sites, vendor+secret pattern, prior art from the archive, opt-out placement.

## Summary

**The good news is unusually good.** PostHog documents a Cloudflare-Workers-native path whose recommended code is *the same line this repo already runs in production*. PostHog's docs prescribe `Astro.locals.cfContext.waitUntil()` for Astro 6; `src/pages/api/rankings.ts:69-79` already dispatches the ranking job exactly that way, and the property is confirmed in the installed adapter at `node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts:2` (`cfContext: ExecutionContext`). `posthog-node@5.51.6` ships a real `workerd` export condition (verified against the published package, not just the docs). The transport question is effectively already answered by this codebase's own prior art: fire-and-forget inside `waitUntil`, ~0 CPU-ms (I/O does not count against the 10ms limit), 1 subrequest of 50.

**The bad news is structural, and it is about step 1.** The funnel's first step — "user signed up" — has **no place to emit an event from today**. Three independent facts combine: `src/pages/api/auth/signup.ts:14` destructures only `{ error }` and throws away the `data.user.id` that Supabase returns; in production the account is unconfirmed at that moment so there is no session and no `locals.user`; and email confirmation never re-enters application code at all, because `src/pages/auth/confirm.ts:4` allows only `"recovery"` and `"email_change"`, with no signup template in `supabase/templates/`. Signup completes inside GoTrue, outside this app. **This is a product decision before it is an implementation detail** — it changes what "conversion" means in the funnel — and it is not one of the four Unknowns the roadmap already recorded for `F-06`.

**The privacy risk is concentrated, not diffuse.** Steps 2, 3 and 5 have modest exposure. Step 4 (`src/lib/ranking/run.ts:120-131`) is the densest concentration of third-party personal data anywhere in the repo — the full people array, the profile, contact notes, the literal prompt string sent to OpenAI, the raw model response, and the model-authored `reason` text are all in one lexical scope, at exactly the point where the event must fire. That single call site is the reason the wrapper must take an allow-list rather than a free-form property object.

**Two things that look like precedent are not.** (a) F-02's KV + polling machinery is *not* prior art to copy — it exists because a user had to leave and come back for a result; nobody polls "did my event land". Only the `waitUntil` and CPU/subrequest facts transfer. (b) `src/lib/config-status.ts` declares a contract ("vendor factory returns null, a banner says so") that **neither OpenAI nor Resend ever joined** — the precedent is already inconsistent with itself, so PostHog's entry there is a decision to make, not a pattern to copy.

## Detailed Findings

### 1. Where each funnel step truthfully completes

| # | Step | Authoritative success point | User id in scope? | Extra work for "first time"? |
|---|---|---|---|---|
| 1 | Signed up | `src/pages/api/auth/signup.ts:20` | **No** — discarded at `signup.ts:14` | n/a |
| 2 | Self-profile filled | `src/pages/api/profile.ts:42` | Yes — `user.id` (`profile.ts:17,36`) | Yes — existence pre-check |
| 3 | First person added | `src/pages/api/people.ts:29` | Yes — `user.id` (`people.ts:6,23`) | Yes — count pre-check |
| 4 | Hierarchy generated | `src/lib/ranking/run.ts:128` (inside `waitUntil`) | Yes — `ownerId` param (`run.ts:80`) | n/a |
| 5 | Contact confirmed done | `src/pages/api/contact-events.ts:80`, gated on `outcome === "happened"` | Yes — `ownerId` (`contact-events.ts:19`) | n/a |

**Step 1 is blocked on a decision, not on code.** `supabase.auth.signUp()` at `signup.ts:14` returns `data.user.id`; the handler keeps only `error`. Production has email confirmation on (`context/changes/deployment/deployment-plan.md:126`), so no session exists yet. And confirmation does not come back through this app: `src/pages/auth/confirm.ts:4` is `["recovery", "email_change"]`, and `supabase/templates/` holds only `recovery.html` and `email_change.html`. The first moment the app sees this user again is `src/middleware.ts:12-15` on their next page load, or the signin POST at `src/pages/api/auth/signin.ts:14`. Options — all viable, none free — are laid out in **Open Questions** below.

**Step 4 does not complete in its HTTP response.** `POST /api/rankings` returns `{ jobId }` with 202 at `rankings.ts:81`; that means *dispatched*, not *generated*. The truthful point is `run.ts:120-131`, after `persistRanking` and `writeJob(jobId, { status: "done" })`. The client poll (`GET /api/rankings` → `rankings.ts:112`, driven by `HierarchyView.tsx:104-153`) is a secondary signal that depends on a browser tab still being open — unusable as the authoritative anchor.

**Step 5 must be gated.** `POST /api/contact-events` succeeds for both outcomes; only `outcome === "happened"` (`src/lib/validation/contact-event.ts:3`, UI copy "Tak, rozmawialiśmy" at `ContactMarker.tsx:136`) is the funnel's terminal step. `"not_yet"` is a different, also-interesting event — but it is not step 5.

**Steps 2 and 3 need a pre-check to know "first".** `profiles.owner_id` is the primary key (`supabase/migrations/20260830101704_add_profiles_and_people_fields.sql:8`), so `profile.ts:34-36`'s `.upsert()` is genuinely insert-or-update — but it has no `.select()`, so nothing in scope distinguishes create from update. The existence query already exists at `src/middleware.ts:27-31`. For people, the count query already exists at `src/pages/dashboard.astro:25`. Both are one extra round trip, run *before* the write.

### 2. PII audit — what sits within arm's reach at each emission point

The point of this section is to name the tempting values, because every one of them is one careless property away from putting third-party personal data into a vendor's database and undoing what `F-01` bought.

- **`signup.ts:20`** — in scope: `email`, `password`, the `FormData` holding both. Safe values: none. There is literally nothing safe *and* useful here today.
- **`profile.ts:42`** — in scope: `user.email`; `parsed.data` with `name`, `birthDate` (full DOB), `lifeContext` (free text ≤300). Safe: `parsed.success`, presence booleans and array lengths for the rhythm fields. The rhythm *enum values* are small closed vocabularies but are still personal attributes — sensitive by default unless deliberately allow-listed.
- **`people.ts:29`** — in scope: `parsed.data`, an array of `PersonFormValues` (`src/lib/validation/person.ts:42-54`) with `name`, `description` (≤500 free text), `relationshipContext`, `contextTags`, `weight`, `lastContactBucket`. Safe: `parsed.data.length` only. Note this route is a **batch insert** — "first person added" may in truth be "first N added in one submit".
- **`run.ts:120-131`** — the worst case, and the mandatory emission point. In scope: `profile` (full row), `people` (full array), `facts` including `recentNotes` free text (`src/lib/contact-history/facts.ts:13,33-36`), `messages` (the literal prompt serializing all of it), `response` (raw OpenAI output), and `entries` with model-authored `reason` ≤400 chars, `contextNote`, `rhythmNote`. Safe: `ownerId`, `rankingId`, `jobId`, `RANKING_MODEL` (`run.ts:14`), `people.length` / `peopleIncluded.length`, and duration `Date.now() - startedAt`. Those six are exactly the payload a truthful, PII-free `hierarchy_generated` event should carry.
- **`contact-events.ts:80`** — in scope: `parsed.data.note` (≤200 free text), `inserted` (full row, including `note`), `facts` with `recentNotes`. Safe: `outcome`, `inserted.id`, `!!note` (a boolean "a note was written"), `rankingEntryId !== null` (a boolean "this came from a suggestion, not ad hoc" — analytically valuable and non-identifying), `inserted.occurred_at`. **`personId` is borderline**: not personal content itself, but a stable per-contact identifier that joins straight back to `name` and `description` in `people`. Recommend excluding it.

One client-side note: `ContactMarker.tsx:29` already receives a full `ContactFacts` object including `recentNotes` as a prop, so even a browser-side capture at step 5 would sit in a scope containing forbidden data.

### 3. How an event should physically leave this Worker

Everything here is settled by existing, measured prior art plus PostHog's own documentation, and the two agree.

- **`waitUntil` is the sanctioned mechanism, and it is already in use.** `rankings.ts:69-79` and `src/pages/api/internal/ai-ping.ts` both do `context.locals.cfContext.waitUntil(work)` with a `console.warn` fallback when `cfContext` is absent. Typed at `src/env.d.ts:8`. Confirmed in the installed adapter: `node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts:2` and the removal message at `handler.js:87` ("Astro.locals.runtime.ctx has been removed in Astro v6. Use 'Astro.locals.cfContext' instead."). PostHog's Cloudflare guide independently prescribes `Astro.locals.cfContext.waitUntil()` for Astro 6. Two sources, one line — this is as de-risked as an integration decision gets in this repo.
- **Cost is negligible and this was measured, not assumed.** Awaiting `fetch` is I/O, not CPU, so it does not count against the free tier's 10ms CPU limit (`context/changes/openai-ranking-call-path/plan.md:15`; restated at `context/archive/2026-09-01-ai-contact-hierarchy/plan.md:169`). A full ranking run measured **~7 subrequests of the 50 allowed** (`context/archive/2026-09-01-ai-contact-hierarchy/production-verification.md:25-43`). One capture call adds exactly 1.
- **Do not copy F-02's KV job machinery.** It exists to satisfy an NFR about a user leaving and returning for a result. Analytics needs no durable status, no poll route, no job id. Fire-and-forget is the whole design.
- **Do not batch.** No batching precedent exists in this repo (F-04 explicitly deferred chunking, `context/archive/2026-09-02-resend-email-delivery-path/plan.md:33`), and with one event per user action against 43+ spare subrequests, batching would be a premature optimization answering no measured need.
- **Two implementation options, both documented.**
  1. `posthog-node` with `{ flushAt: 1, flushInterval: 0 }` + `waitUntil(posthog.shutdown())`. PostHog's docs give this exact recipe and state the rationale plainly: *"Batched data is sent asynchronously and Cloudflare Workers can terminate before it's sent causing data loss."* Verified independently: `posthog-node@5.51.6` `exports` carries `workerd`, `edge` and `edge-light` conditions all resolving to `dist/entrypoints/index.edge.mjs`, a separate build from `index.node.mjs`. **Type-resolution gotcha**: the `"."` export's `types` points at `index.node.d.ts`; the `./edge` subpath has its own `index.edge.d.ts`. Importing from `"posthog-node"` gives Node types while the runtime resolves the workerd build — worth pinning down during implementation, since `astro check` is a required gate here.
  2. A bare `fetch()` POST to `<host>/i/v0/e/` with `{ api_key, event, distinct_id, properties, timestamp }`, wrapped the same way. This is the endpoint the SDKs themselves call. It adds no dependency, no bundle weight, no flush semantics to get wrong, and it makes the property allow-list trivially enforceable because *we* write the body.
- **Recommendation for `/10x-plan` to accept or reject:** option 2. The only things `posthog-node` buys here are batching (explicitly disabled by PostHog's own Workers recipe), retries, and typings — against which it adds a dependency whose bundle cost this repo has never measured for any vendor (a real gap: `production-verification.md:52-61` flags CPU-time as "architectural reasoning, not a measured number", and no bundle-size budget or gate exists anywhere in the repo). A ~30-line typed wrapper over `fetch` is smaller than the config needed to make the SDK behave.

### 4. Vendor + secret wiring — the template to copy

`src/lib/openai.ts` and `src/lib/resend.ts` are three-line factories: import the key from `astro:env/server`, `if (!KEY) return null;`, construct. Not memoized — constructed per call at every site (`worker.ts:11`, `run.ts:83`, `ai-ping.ts:23`). The convention originates at `src/lib/supabase.ts:6-9` and is documented at `context/changes/openai-ranking-call-path/plan.md:16`.

The complete checklist for a new secret (`POSTHOG_*`), in order:

| # | File | Precedent |
|---|---|---|
| 1 | `astro.config.mjs` `env.schema` — `envField.string({ context: "server", access: "secret", optional: true })` + a comment naming the factory that null-guards it | `astro.config.mjs:31-35` |
| 2 | `.env.example` — add `POSTHOG_...=###` | the 5-line file at repo root |
| 3 | `.dev.vars` — real local value (gitignored, `.gitignore:27`) | `README.md:47-49` |
| 4 | `src/lib/posthog.ts` — the factory | `src/lib/openai.ts:1-9` |
| 5 | `.github/workflows/ci.yml` — **both** `env:` blocks (`astro sync`, `npm run build`) | `ci.yml:20-25,28-33` |
| 6 | `.github/workflows/deploy.yml` — same two blocks, **not** the wrangler-action steps | `deploy.yml:24-29,32-37` |
| 7 | GitHub repo secret — human UI step | — |
| 8 | `wrangler secret put` — **human, never the agent** | `CLAUDE.md` §Sekrety |
| 9 | `package.json` dependency (only if option 1 in §3 is chosen) | `package.json:39,43` |
| 10 | `scripts/verify-*.ts` + a `verify:` npm script | `scripts/verify-openai-call.ts`, `package.json:17-21` |
| 11 | `src/lib/config-status.ts` — **a decision, not a copy** (see below) | `config-status.ts:11-19` |

Steps 5 and 6 are easy to miss and non-obvious: `astro:env` validates the schema at **build** time, so CI needs the value even though production gets it from Workers Secrets independently.

Two defects found in the precedent, worth fixing or at least not propagating:
- **`config-status.ts` registers only Supabase.** Neither OpenAI nor Resend was ever added, despite both following the null-returning contract the file exists to surface. Adding PostHog would be *more* consistent with the file's intent and *less* consistent with actual practice.
- **`README.md:117-119`'s "Wymagane GitHub Secrets" list is stale** — it omits `OPENAI_API_KEY` and `RESEND_API_KEY`. Do not use it as the checklist.

The verification-script shape is well established (`scripts/verify-openai-call.ts`, mirrored verbatim by `verify-ranking.ts`): `assert()` + `failures[]` + non-zero exit, refuses `localhost` on purpose, signs in through `/api/auth/signin` with an explicit `Origin` header because the request is form-encoded, and sends `Content-Type: application/json` to JSON routes — both per the origin-check lesson in `context/foundation/lessons.md`. A `verify:analytics` script would follow it exactly. Note the corollary from the same lessons file: `wrangler tail` streams **nothing** until some `versions deploy` syncs non-versioned settings, so verification must be self-evidencing (timing, return values) rather than log-reading.

### 5. Where a consent / opt-out toggle would land

`/settings` today has four sections (`src/pages/settings.astro:20-55`): "Twój profil" (link-out), "Konto" (email + password), "Przypomnienia" (still an S-04 placeholder), "Strefa zagrożenia" (delete-my-data). Adding a section is additive and collides with nothing.

But three things complicate it:

1. **`S-07` is mid-flight and partly uncommitted.** Phases 1 and 3 are committed (`2c54bf9`, `9df35c0`); **phase 2 (password) and phase 4 (delete-data) exist only in the working tree**, untracked — `PasswordChangeForm/`, `DeleteDataSection/`, `api/settings/password.ts`, `api/settings/delete-data.ts`, and migration `20260904221004_add_profiles_delete_policy.sql`. Phase 4's four manual verification items are unchecked. Anything built on `/settings` right now is building on sand until that lands.
2. **There is no toggle primitive.** `src/components/ui/` has no `Switch`, `Toggle` or `Checkbox`. The only boolean-ish precedent is `isCollective` in `PersonForm`, modeled as a segmented control over the strings `"true"`/`"false"`. A genuine opt-out switch means either adding a shadcn `Switch` to the design system or bending that pattern — a real cost, not a checkbox.
3. **Storage is straightforward.** One column: `alter table public.profiles add column analytics_opt_out boolean not null default false;` — `not null default` is required by the repo's forward-compatibility rule (`CLAUDE.md` §Rollback), and matches how `is_collective` was added at `20260830101704:46`. No RLS or GRANT change needed: policies are row-level and the table-level `update` grant from `20260830101704:39-40` already covers new columns — the same reasoning recorded in `20260831202209_add_profile_rhythm_fields.sql:6-14`. Then `npm run db:types`, a schema pair in `src/lib/validation/settings.ts`, and either a new `api/settings/` route or a field on the existing profile upsert.

Incidental finding, not this change's to fix: `context/changes/account-and-profile-settings/plan.md` attributes phase 2 to commit `cc0ed0e`, which is not on this branch — it was reset away and re-landed as `4cc470b` under a different change. The sha is misattributed.

### 6. PostHog specifics that constrain the plan

- **Regions.** Ingestion hosts are `eu.i.posthog.com` and `us.i.posthog.com` (confirmed in PostHog's own Cloudflare proxy worker code). Cloud EU is hosted in Frankfurt. **Cross-region migration is not self-service** — it requires PostHog support and a Team/Scale/Enterprise plan (medium confidence; from doc summaries rather than a captured verbatim quote). Treat the region as a one-way door, which is exactly how roadmap Open Question 11 frames it.
- **Self-hosting** is Docker Compose via an install script; Kubernetes is explicitly no longer supported for new deployments, and self-hosted operation is "officially unsupported" in the sense that you own the infra. For a solo after-hours MVP this reads as a poor trade against Cloud EU.
- **The key is meant to be public.** Capture uses the project API key — the same token embedded in browser SDKs, described by PostHog as a POST-only public endpoint returning no sensitive data. It should still live in Workers Secrets for rotation hygiene, but it is not a credential whose exposure is a breach.
- **Person profiles are avoidable.** `properties: { $process_person_profile: false }` suppresses profile creation per event. Worth considering: this product's "person" in PostHog is the *app user*, and creating profiles pulls user-level attributes into the vendor. A funnel does not need them.
- **A funnel needs only consistently named events sharing a `distinct_id`.** Person properties are needed only for breakdowns. So five stable event names plus the Supabase UUID as `distinct_id` (max 200 chars — a UUID is fine) is the whole requirement.
- **`before_send` and the property-filter app** exist for scrubbing, but **no allow-list feature was found documented**. That confirms the roadmap's instinct: the allow-list must be enforced in *our* wrapper, not configured in PostHog.
- **`posthog-js` bundle size is unresolved.** Community numbers range from ~52KB (2020, obsolete) to ~266KB uncompressed (2025, webpack-analyzer). No current authoritative gzip figure was obtainable. Autocapture and session replay are lazy-loaded separately and disabled with `autocapture: false, disable_session_recording: true`. If the browser SDK is ever adopted, its weight needs measuring, not assuming.
- **Reverse proxy on Workers is a documented, first-class pattern** (PostHog publishes the worker code) and reportedly recovers 10–30% of events lost to ad blockers. It is only relevant if browser-side capture is adopted; server-side capture is unaffected by ad blockers entirely.

## Code References

- `src/pages/api/auth/signup.ts:14,20` — `data.user.id` discarded; redirect success point
- `src/pages/auth/confirm.ts:4` — `ALLOWED_TYPES` excludes `"signup"`
- `src/pages/api/profile.ts:34-36,42` — profile upsert on PK, no `.select()`; success envelope
- `src/middleware.ts:12-15,27-31` — `getUser()`; the profile-existence query to reuse
- `src/pages/api/people.ts:6,23,29` — batch insert, redirect success point
- `src/pages/dashboard.astro:25` — the people count query to reuse
- `src/pages/api/rankings.ts:69-79,81` — the `cfContext.waitUntil` dispatch; 202 is *not* completion
- `src/lib/ranking/run.ts:14,80,120-131` — the true "hierarchy generated" point; densest PII scope
- `src/pages/api/contact-events.ts:19,80` — success point; gate on `outcome === "happened"`
- `src/lib/validation/contact-event.ts:3` — `CONTACT_EVENT_OUTCOMES`
- `src/env.d.ts:8` — `cfContext` typing
- `node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts:2` / `handler.js:87` — `cfContext: ExecutionContext`; the v6 removal message
- `src/lib/openai.ts:1-9`, `src/lib/resend.ts:1-9`, `src/lib/supabase.ts:6-9` — the factory pattern
- `src/lib/config-status.ts:11-19` — the banner contract OpenAI and Resend never joined
- `astro.config.mjs:31-35` — optional-secret `envField` shape
- `.github/workflows/ci.yml:20-25,28-33`, `deploy.yml:24-29,32-37` — where a build-time secret must be added
- `scripts/verify-openai-call.ts` — verification-script template
- `src/pages/settings.astro:20-55` — the four existing sections
- `supabase/migrations/20260831202209_add_profile_rhythm_fields.sql:6-14` — forward-compatible column-add reasoning
- `supabase/migrations/20260830101704_add_profiles_and_people_fields.sql:8,39-40,46` — PK, table grants, `not null default false` precedent

## Architecture Insights

- **This repo has exactly one non-blocking pattern, and it is small.** `cfContext.waitUntil(work)` with a `console.warn` fallback, repeated identically in two places. A third instance for analytics is idiomatic, not novel.
- **Observability today is seven `console.*` calls** (`run.ts:131,134`, `ai-ping.ts:36,39,60`, `rankings.ts:77`, `worker.ts:13,31,36,39`). There is no structured logging, no metrics client, no telemetry. PostHog would be the first — which is precisely why the roadmap parks error tracking separately: this change should not quietly become the observability layer.
- **API success envelopes are not standardized** (`{ jobId }`, `{ success: true }`, `{ event, facts }`, `{ events }`), though error envelopes consistently are `{ error: string }`. An analytics wrapper should not depend on response shape; it should be called from inside handlers, before the response is constructed.
- **Two transport styles coexist** — classic form POST + redirect (`signup`, `people`) and JSON `fetch` (`profile`, `rankings`, `contact-events`). This matters for browser-side capture: steps 1 and 3 have no client-side success callback at all, because the browser navigates away. Server-side capture sidesteps this entirely, which is an argument for it beyond ad blockers.
- **The repo's risk posture is documented and consistent**: a known TOCTOU race in the ranking in-flight guard was *accepted and documented* rather than engineered away (`context/archive/2026-09-01-ai-contact-hierarchy/reviews/impl-review.md` F1). Analytics should inherit that posture — a rarely double-fired event is not worth idempotency machinery.

## Historical Context (from prior changes)

- `context/changes/openai-ranking-call-path/plan.md:13,15,16` — `cfContext` confirmed against adapter source; I/O ≠ CPU time; the null-returning factory convention.
- `context/archive/2026-09-01-ai-contact-hierarchy/production-verification.md:19,22-23,25-43,52-61` — non-blocking proven by response timing (321–403ms) plus a still-`pending` poll; ~7 of 50 subrequests measured; CPU time explicitly flagged as reasoned, never measured.
- `context/archive/2026-09-02-resend-email-delivery-path/plan.md:33` and `reviews/impl-review.md` F2 — chunking deferred out of scope; log-only failure handling silently defeated Cloudflare's cron health signal until a rethrow was added. For request-path capture there is no cron health signal to protect, but failures should still be logged rather than swallowed.
- `context/foundation/lessons.md` — five entries bear directly on this change: `astro:env/server` only for config; bindings only via `cloudflare:workers` (not needed here — PostHog needs a config value, not a binding); `astro dev` proves nothing about production limits; verify exact config API in `node_modules` before trusting a plan's syntax; `wrangler tail` is silent until `versions deploy` syncs non-versioned settings.
- `context/changes/deployment/deployment-plan.md:126` — production requires email confirmation, which is what makes funnel step 1 structurally awkward.

## Related Research

None — this is the first `research.md` in the repository. Prior changes carried their findings inside `plan.md` and `production-verification.md` instead; those are cited above.

## Open Questions

**Blocking the plan:**

1. **Where does the funnel actually start?** Step 1 has no emission point today. Three options, each with a different meaning: (a) change `signup.ts:14` to capture `data.user.id` and emit at `signup.ts:20` — cheapest, but counts *unconfirmed* signups, so the funnel's first step overcounts by however many people never confirm; (b) add `"signup"` to `confirm.ts:4`'s `ALLOWED_TYPES` with a custom Supabase template, making "confirmed account" the real first step — truthful, but it is a slice of auth work inside an analytics foundation; (c) start the funnel at step 2 and treat signup as out of scope — honest and free, but the PRD's flow begins with "creates an account". Owner: user, during the plan.
2. **Region: Cloud EU, Cloud US, or self-host?** One-way door without a paid plan. Roadmap Open Question 11.
3. **`posthog-node` (workerd build) or a bare `fetch` wrapper?** §3 recommends the latter; the plan should ratify or overturn it.

**Non-blocking but decide deliberately:**

4. **Does `personId` ever appear in a step-5 event?** It is not personal content, but it joins straight back to a name. Excluding it costs per-contact analysis; including it weakens the guarantee.
5. **Opt-out: ship it, and where?** Requires a new UI primitive (§5) and a column. Also interacts with `S-07`'s uncommitted phases.
6. **Does PostHog get a `config-status.ts` entry**, given OpenAI and Resend never got one?
7. **Is bundle size measured this time?** No vendor's weight has ever been measured in this repo. If the `fetch` option is chosen the question mostly evaporates.

## Note on tooling observed during research

A PostHog connector is present but unauthenticated in this session's tooling. It was **not** used — authenticating to a third-party account is the user's call, not the agent's. If a PostHog project already exists, connecting it would let a later phase verify that events actually landed, rather than only that the request returned 200.
