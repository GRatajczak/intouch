# PostHog Product Analytics for the Primary Success Funnel — Implementation Plan

## Overview

Make the PRD's primary success funnel measurable end to end. Five named events —
`signup_started`, `profile_completed`, `first_person_added`, `hierarchy_generated`,
`contact_confirmed` — leave the Worker through one typed, consent-aware wrapper in
`src/lib/analytics/`, keyed by the Supabase user id and nothing else. The wrapper takes a
**typed per-event property allow-list**, never a free-form object, so no person's name,
`description`, `relationship_context`, `tags`, `last_contact_bucket` or the user's email
can reach a vendor even by accident.

Transport is a bare `fetch` POST to `https://eu.i.posthog.com/i/v0/e/`, fired inside
`cfContext.waitUntil()` (or, at step 4, simply awaited inside the task that is already
deferred). No SDK, no batching, no autocapture, no session replay, no feature flags, no
error tracking.

## Current State Analysis

- **No analytics of any kind exists.** Observability today is seven `console.*` calls.
  PostHog would be the first telemetry in the repo — which is exactly why the roadmap
  parks error tracking separately and this change must not quietly become the
  observability layer.
- **The non-blocking pattern is already in production.** `src/pages/api/rankings.ts:69-79`
  runs `context.locals.cfContext.waitUntil(work)` with a `console.warn` fallback; the same
  shape is in `src/pages/api/internal/ai-ping.ts`. `cfContext` is typed at
  `src/env.d.ts:8` and confirmed in the installed adapter
  (`node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts:2`). PostHog's own Cloudflare
  guide prescribes this exact line for Astro 6.
- **Vendor + secret wiring has a three-line template.** `src/lib/openai.ts:1-9` and
  `src/lib/resend.ts:1-9`: import from `astro:env/server`, return `null` when absent,
  construct. Never memoized. Originates at `src/lib/supabase.ts:6-9`.
- **Step 1 has no emission point.** `src/pages/api/auth/signup.ts:14` destructures only
  `{ error }`, discarding `data.user.id`. Production requires email confirmation, so there
  is no session at that moment, and confirmation never re-enters app code
  (`src/pages/auth/confirm.ts:4` allows only `"recovery"` and `"email_change"`).
- **Steps 2 and 3 cannot tell "first" from "again".** `src/pages/api/profile.ts:34-36`
  upserts on the `owner_id` primary key with no `.select()`; `src/pages/api/people.ts:23`
  is a **batch** insert. Both need a pre-check.
- **Step 4 does not complete in its HTTP response.** `POST /api/rankings` returns
  `{ jobId }` with 202 — dispatched, not generated. The truthful point is
  `src/lib/ranking/run.ts:128`, after `persistRanking` and `writeJob(..., "done")`.
- **`S-07` has landed since research was written.** `settings.astro` now renders four live
  sections including `PasswordChangeForm` and `DeleteDataSection`; `src/pages/api/settings/`
  holds `email.ts`, `password.ts`, `delete-data.ts`. The research doc's "building on sand"
  warning is resolved. Still true: `src/components/ui/` holds only `alert-dialog`,
  `button`, `sheet` — **no toggle, switch or checkbox primitive exists**.
- **There is no test runner.** `context/foundation/test-plan.md` Phase 1 (Vitest bootstrap)
  is `change opened`, not shipped. The automated gates available to this change are exactly
  `astro check`, `eslint`, `astro build`, plus a `scripts/verify-*.ts` script.
- **`config-status.ts` drives a user-facing banner.** `missingConfigs` renders in
  `src/layouts/Layout.astro:62` on every page. Only Supabase is registered; OpenAI and
  Resend never joined.

## Desired End State

A user completing the product flow leaves a five-step trail in a PostHog Cloud EU project.
The Success Criteria question — "did a user get from *added my people* to *confirmed a
contact*?" — is answered by opening a saved funnel insight, not by `wrangler tail`.

Verifiable by:

- Running `npm run verify:analytics -- <deployed-url>` end to end with a zero exit code.
- Opening the saved PostHog funnel and seeing all five steps with non-zero counts.
- Inspecting any event's properties in PostHog and finding no name, no free text, no email,
  and no `person_id`.
- Toggling the opt-out in `/settings` and confirming no further events arrive for that user.

### Key Discoveries

- `src/lib/ranking/run.ts:120-131` **already executes inside `waitUntil`** — `rankings.ts`
  defers the whole `runRanking` call. The step-4 capture is therefore a plain `await`
  inside an already-deferred task; it needs no second deferral and no `cfContext` access.
- `run.ts:120-131` is simultaneously the densest third-party-PII scope in the repo:
  `profile`, `people`, `facts.recentNotes`, `messages` (the literal prompt), `response`
  (raw model output) and `entries[].reason` are all in one lexical scope. This single call
  site is the reason the wrapper takes an allow-list rather than a property object.
- `astro:env` validates its schema at **build** time, so a new secret must be added to
  **both** `env:` blocks in `.github/workflows/ci.yml` (lines 20-25, 28-33) and **both** in
  `deploy.yml` (lines 24-29, 32-37) — not to the `wrangler-action` steps. Easy to miss and
  the failure is a red CI build, not a runtime error.
- PostHog's capture contract, re-verified against current docs this session:
  `POST <host>/i/v0/e/` with `{ api_key, event, distinct_id, properties?, timestamp? }` and
  `Content-Type: application/json`. `properties.$process_person_profile: false` suppresses
  person-profile creation per event.
- A full ranking run measured **~7 of 50 subrequests**
  (`context/archive/2026-09-01-ai-contact-hierarchy/production-verification.md:25-43`).
  Awaiting `fetch` is I/O, not CPU, so it does not count against the 10ms CPU limit. One
  capture adds exactly 1 subrequest; the opt-out pre-check adds at most 1 more.
- `supabase/migrations/20260831202209_add_profile_rhythm_fields.sql:6-14` records the
  reasoning that a new column on `profiles` needs no RLS or GRANT change — policies are
  row-level and the table-level grant from `20260830101704:39-40` already covers new
  columns. `20260830101704:46` is the `not null default false` precedent.
- `context/foundation/lessons.md`: a non-browser POST to a JSON route must send
  `Content-Type: application/json`, and a form-encoded POST to `/api/auth/signin` must send
  an explicit `Origin` header — both already handled by `scripts/verify-openai-call.ts`,
  which `verify-analytics.ts` copies.

## What We're NOT Doing

- **No autocapture, no session replay, no feature flags, no A/B tests, no error tracking.**
  Session replay in particular would record screens full of third-party personal data. The
  roadmap's parked "error tracking / logging library" entry stays parked.
- **No browser SDK and no reverse proxy.** Server-side capture is unaffected by ad blockers
  entirely, and steps 1 and 3 are form-POST-and-redirect flows with no client-side success
  callback to hook. The reverse proxy is only relevant to browser capture, so it does not
  apply. `posthog-js`'s unresolved bundle weight becomes a non-question.
- **No `posthog-node` dependency.** Ratified in favour of a bare `fetch` wrapper.
- **No events beyond the five Success-Criteria steps.** Not every mutating API route.
  F-06's own risk note names instrumentation sprawl as one of its two real risks. In
  particular `outcome: "not_yet"` is interesting but is *not* step 5 and gets no event.
- **No `person_id` in any payload**, and no hashed substitute.
- **No `config-status.ts` entry for PostHog** — see Critical Implementation Details.
- **No batching, no retries, no durable delivery, no idempotency.** No KV, no job records,
  no poll route. A rarely double-fired event is not worth machinery; this inherits the
  repo's documented risk posture (the ranking TOCTOU race was accepted and documented
  rather than engineered away).
- **No new `src/components/ui/` primitive.** No shadcn `Switch`.
- **No test-runner work.** `test-plan.md` Phase 1 owns that.
- **No changes to `signup`'s email-confirmation flow.** `confirm.ts`'s `ALLOWED_TYPES` and
  `supabase/templates/` are untouched.

## Implementation Approach

Consent first, then call sites, then the control, then proof.

Phase 1 builds a wrapper that is already consent-aware and already null-guarded, plus the
`analytics_opt_out` column — so from the moment the very first event can fire, both the
kill switch (absent key) and the user gate (opt-out column) are in place. Phases 2 and 3
wire the five call sites in two groups split by difficulty: three thin API routes first,
then the two that need care (the deferred, PII-dense ranking task and the outcome-gated
contact event). Phase 4 gives the user the control that the column has been honouring all
along. Phase 5 proves the whole thing from outside the app.

The wrapper never throws and never blocks. Every failure is a `console.error` with an
`[analytics]` prefix, mirroring the `[ranking]` convention in `run.ts:131,134`. A failed
capture must never turn a successful profile save into an error response.

## Critical Implementation Details

**Timing & lifecycle.** `runRanking` is invoked from `rankings.ts:69-79` *inside*
`cfContext.waitUntil()`. Do not reach for `cfContext` in `run.ts` — it is not in scope
there and does not need to be. `await` the capture directly, after `writeJob(..., "done")`
and before the completion `console.log`, so a capture failure cannot prevent the job from
reaching its terminal state. In the four API routes, capture must be dispatched through
`cfContext.waitUntil()` with the same `console.warn` fallback `rankings.ts` uses, and the
response must be constructed and returned without awaiting it.

**State sequencing.** Steps 2 and 3 need their "is this the first time?" query to run
**before** the write, not after — after the upsert the profile always exists, and after the
batch insert the count is never zero. Both pre-checks share a round trip with the opt-out
read where they hit the same table (step 2 reads `profiles` for both), and cost one extra
subrequest where they do not.

**Why `config-status.ts` gets no PostHog entry.** `missingConfigs` renders a Polish banner
to end users on every page (`src/layouts/Layout.astro:62`). An absent analytics key breaks
nothing a user can see, so surfacing it there advertises an internal ops gap to the wrong
audience. This matches what OpenAI and Resend actually did, and diverges from the file's
stated contract knowingly. Record the reasoning in a comment in
`src/lib/analytics/config.ts` so the omission reads as a decision, not an oversight.

**Debug & observability.** `wrangler tail` streams nothing until a `wrangler versions
deploy` syncs non-versioned settings (`lessons.md`). Phase 5's verification must therefore
be self-evidencing — asserting HTTP status and response timing from the script itself —
rather than log-reading, exactly as `scripts/verify-openai-call.ts` proves non-blocking
from its own timing.

---

## Phase 1: Consent-aware wrapper, event catalog and secret path

### Overview

Build `src/lib/analytics/` — the typed catalog, the capture wrapper, the config read and
the consent read — plus the `analytics_opt_out` column and the full secret wiring. Nothing
emits yet; this phase's whole job is that when Phase 2 adds the first call site, both
gates already exist.

### Changes Required:

#### 1. Opt-out column

**File**: `supabase/migrations/<timestamp>_add_profiles_analytics_opt_out.sql`

**Intent**: Give every profile a durable analytics consent flag, defaulting to opted-in, so
the wrapper has something to read from the first event onward.

**Contract**: Adds `analytics_opt_out boolean not null default false` to `public.profiles`.
`not null default` is required by the repo's forward-compatibility rule (`CLAUDE.md`
§Rollback) — `wrangler rollback` reverts code but not the database. No RLS policy and no
GRANT change: policies are row-level and the table-level `update` grant from
`20260830101704:39-40` already covers new columns. Carry a comment recording that
reasoning, mirroring `20260831202209_add_profile_rhythm_fields.sql:6-14`. Follow with
`npm run db:types` to regenerate `src/db/database.types.ts`.

#### 2. Event catalog — the allow-list

**File**: `src/lib/analytics/events.ts`

**Intent**: Define the five event names and, per event, exactly which properties may be
sent. This file *is* the privacy guarantee: because `capture` accepts only a member of this
union, the PII-dense scope in `run.ts` has no way to pass a name or a free-text field.

**Contract**: A discriminated union over an `event` literal, one member per funnel step,
each with a closed property object. No index signature, no `Record<string, unknown>`, no
optional escape hatch. The five members and their permitted properties:

| Event | Properties | Notes |
| --- | --- | --- |
| `signup_started` | *(none)* | Named `_started`, not `_completed`: production requires email confirmation, so this counts unconfirmed accounts and the name says so. |
| `profile_completed` | `has_life_context: boolean`, `has_birth_date: boolean`, `rhythm_channels_count: number`, `rhythm_slots_count: number` | Presence booleans and counts only — never the values. The rhythm *enum values* are personal attributes and stay out. |
| `first_person_added` | `people_added: number` | The route is a batch insert, so "first person" may in truth be "first N in one submit"; the count records which. |
| `hierarchy_generated` | `model: string`, `people_total: number`, `people_considered: number`, `duration_ms: number` | The six safe values named in the research PII audit, minus the ids that identify nothing analytically. |
| `contact_confirmed` | `has_note: boolean`, `from_suggestion: boolean` | `from_suggestion` is `rankingEntryId !== null` — analytically valuable, non-identifying. No `person_id`, no note text, no `outcome` (the event only exists for `"happened"`). |

Add a file-header comment stating the rule plainly: **a property may be added here only if
it cannot identify or describe a third party.** Anyone extending the catalog reads that
first.

#### 3. Config read

**File**: `src/lib/analytics/config.ts`

**Intent**: Read the project token through `astro:env/server` and expose the ingestion host,
following the null-returning factory convention so an absent key disables analytics without
failing anything else.

**Contract**: Exports the resolved config or `null` when `POSTHOG_API_KEY` is absent, plus
the ingestion host as a module constant pinned to Cloud EU. The host is a constant rather
than a second secret because the region is a settled one-way door — carry a comment saying
so, and a second comment recording why PostHog is deliberately absent from
`config-status.ts` (see Critical Implementation Details). Never memoized, matching
`src/lib/openai.ts`.

#### 4. Consent read

**File**: `src/lib/analytics/consent.ts`

**Intent**: Answer "may we send events for this owner?" from the `profiles` row, and fail
open-to-silence — a query error must suppress the event, never throw into the caller's
request path.

**Contract**: Takes an RLS-scoped Supabase client and an owner id; returns a boolean. A
missing profile row counts as consented (the column defaults to `false`, and at
`signup_started` no profile exists yet). A query error suppresses the event and logs
`[analytics]`. Callers that already hold the profile row — `run.ts` loads it at
`run.ts:88` — must be able to pass the flag directly rather than paying a second round
trip, so expose that variant too.

#### 5. Capture wrapper

**File**: `src/lib/analytics/capture.ts`

**Intent**: The one place that talks to PostHog. Serialize a catalog event and POST it,
fire-and-forget, never throwing.

**Contract**: Accepts a `distinct_id` (the Supabase user id) and a catalog event; resolves
to `void`. Returns immediately when config is `null`. Builds
`{ api_key, event, distinct_id, properties, timestamp }` and POSTs it to
`${host}/i/v0/e/` with `Content-Type: application/json`. `properties` merges the event's
own allow-listed properties with `$process_person_profile: false` — this product's PostHog
"person" is the app user, and a funnel needs only consistently named events sharing a
`distinct_id`, so pulling user-level attributes into the vendor buys nothing. A non-2xx
response or a thrown fetch logs `console.error("[analytics] …")` and resolves normally.
Nothing in this file may accept or forward an unknown-shaped object.

#### 6. Dispatch helper

**File**: `src/lib/analytics/index.ts`

**Intent**: A barrel plus the one call the four API routes actually make, so no route
repeats the `waitUntil`-or-warn dance.

**Contract**: Re-exports the catalog types, and exposes a dispatch function taking the
`cfContext` (possibly `undefined`), the distinct id and the event. It defers the capture
through `cfContext.waitUntil()` when present and otherwise leaves the promise unawaited
after a `console.warn`, mirroring `rankings.ts:69-79` verbatim. Synchronous — callers never
await it.

#### 7. Env schema

**File**: `astro.config.mjs`

**Intent**: Declare the token so `astro:env/server` can serve it, as an optional secret like
the other two vendors.

**Contract**: `POSTHOG_API_KEY: envField.string({ context: "server", access: "secret",
optional: true })`, with a comment naming `src/lib/analytics/config.ts` as the factory that
null-guards it — the same shape and commenting convention as `OPENAI_API_KEY` at
`astro.config.mjs:31-35`.

#### 8. Build-time secret plumbing

**File**: `.env.example`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Intent**: Let the schema validate at build time in every environment that builds.

**Contract**: Add `POSTHOG_API_KEY=###` to `.env.example`. Add
`POSTHOG_API_KEY: ${{ secrets.POSTHOG_API_KEY }}` to **both** `env:` blocks in `ci.yml`
(the `astro sync` step and the `npm run build` step) and **both** in `deploy.yml` — not to
the `wrangler-action` steps, which get their value from Workers Secrets independently.
Do **not** use `README.md:117-119`'s "Wymagane GitHub Secrets" list as a checklist; it is
stale and omits `OPENAI_API_KEY` and `RESEND_API_KEY`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against the local stack: `supabase db reset`
- Regenerated types include the new column: `npm run db:types` leaves a clean diff on rerun
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes with the new env schema entry: `npm run build`

#### Manual Verification:

- A PostHog Cloud **EU** project exists and its project API key is in hand
- `POSTHOG_API_KEY` set in `.dev.vars` (local), Workers Secrets (`wrangler secret put`,
  human-only per `CLAUDE.md` §Sekrety) and GitHub repo secrets
- Reading `src/lib/analytics/events.ts` alone makes it obvious which properties are
  permitted and why no free-text field appears

**Implementation Note**: Pause here for manual confirmation before Phase 2 — no events can
fire until the secret exists in all three locations.

---

## Phase 2: Funnel steps 1–3

### Overview

Wire the three thin API routes: signup, profile, people. Each is a form POST that ends in a
redirect or a JSON envelope, so each dispatches through `waitUntil` and returns without
waiting.

### Changes Required:

#### 1. Step 1 — `signup_started`

**File**: `src/pages/api/auth/signup.ts`

**Intent**: Stop discarding the new user's id and emit the funnel's first event. The account
is unconfirmed at this moment and no session exists, which is why the event is named
`signup_started` rather than `signed_up`.

**Contract**: Destructure `{ data, error }` at line 14 instead of `{ error }`, and dispatch
`signup_started` keyed by `data.user.id` after the error branch and before the redirect at
line 20. Guard for a null `data.user` — Supabase can return a user-less success in some
configurations. No consent pre-check here: no profile row exists yet, so the column cannot
be read and the default is consented.

#### 2. Step 2 — `profile_completed`

**File**: `src/pages/api/profile.ts`

**Intent**: Emit once, on the first fill only. The route upserts on the `owner_id` primary
key with no `.select()`, so nothing currently distinguishes create from update.

**Contract**: Before the upsert at line 34, read the caller's `profiles` row selecting both
`owner_id` (existence) and `analytics_opt_out` (consent) in **one** query — the same
existence-query shape as `src/middleware.ts:27-31`. Dispatch `profile_completed` only when
that row was absent and the upsert succeeded, deriving the four allow-listed properties
from `parsed.data`: presence booleans for `lifeContext` and `birthDate`, and lengths for
the two rhythm arrays. Dispatch after the error branch at line 38, before the success
envelope at line 42. Never send the values themselves.

#### 3. Step 3 — `first_person_added`

**File**: `src/pages/api/people.ts`

**Intent**: Emit once, when the user goes from zero people to some. The route is a batch
insert, so the count records how many arrived together.

**Contract**: Before the insert at line 23, run a head-count of `people` for this owner —
the query already exists at `src/pages/dashboard.astro:25` — and read `analytics_opt_out`.
Dispatch `first_person_added` with `people_added: parsed.data.length` only when the prior
count was zero and the insert succeeded, after the error branch at line 25 and before the
redirect at line 29.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Signing up with a fresh email produces one `signup_started` in PostHog's live event feed
- Filling the self-profile for the first time produces exactly one `profile_completed`;
  saving the profile a second time produces none
- Adding the first person (or first batch) produces exactly one `first_person_added` with a
  correct `people_added`; adding a second person produces none
- Every one of those events, inspected in PostHog, carries no name, no free text and no
  email
- Signup, profile save and person add each still respond as fast as before — the capture is
  not in the response path

**Implementation Note**: Pause here for manual confirmation before Phase 3.

---

## Phase 3: Funnel steps 4–5

### Overview

The two call sites that need care: the deferred ranking task, which is the densest
third-party-PII scope in the repo, and the contact event, which must be gated on outcome.

### Changes Required:

#### 1. Step 4 — `hierarchy_generated`

**File**: `src/lib/ranking/run.ts`

**Intent**: Emit at the point the hierarchy is truthfully generated — after `persistRanking`
and after the job reaches `done` — not when `POST /api/rankings` returns 202, which means
only *dispatched*.

**Contract**: `await` the capture inside the existing `try` block, after
`writeJob(jobId, { status: "done", rankingId })` at line 128 and before the completion
`console.log` at line 131. **Do not** reach for `cfContext` — this whole function already
runs inside `rankings.ts`'s `waitUntil`, so a plain `await` is correct and a second
deferral is not available. Ordering matters: the capture must not be able to stop the job
reaching its terminal state, which is why it comes after `writeJob`.

Properties are the four allow-listed values, all already in scope: `RANKING_MODEL`
(`run.ts:14`), `people.length`, `peopleIncluded.length`, and
`Date.now() - startedAt` reusing the existing `startedAt`. `ownerId` is the `distinct_id`.
Consent comes from the already-loaded `profile` row — pass the flag directly rather than
paying a second query. Nothing else in this scope may be referenced: not `profile`, not
`people`, not `facts`, not `messages`, not `response`, not `entries`. The catalog makes
that a type error, but the reviewer should still read this call site specifically.

#### 2. Step 5 — `contact_confirmed`

**File**: `src/pages/api/contact-events.ts`

**Intent**: Emit the funnel's terminal step, and only that. The route succeeds for both
outcomes, but only `"happened"` is the Success Criteria's final step.

**Contract**: Dispatch `contact_confirmed` after the insert's error branch at line 74 and
before the success envelope at line 80, **gated on `outcome === "happened"`**. `"not_yet"`
emits nothing. Properties: `has_note: Boolean(note)` and
`from_suggestion: rankingEntryId !== null`. Deliberately excluded: `person_id` (a stable
identifier joining straight back to `name` and `description` in `people`), the note text,
and `outcome` itself (the event's existence already carries it). Consent needs its own
`profiles` read here — this route touches `people`, `ranking_entries` and `contact_events`
but never `profiles` — costing one extra subrequest against the ~43 spare measured for a
full ranking run.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Generating a hierarchy produces exactly one `hierarchy_generated` whose `people_total`,
  `people_considered` and `model` match the ranking actually persisted, and whose
  `duration_ms` is plausible against the `[ranking] job … done in Xms` log line
- Confirming a contact with "Tak, rozmawialiśmy" produces one `contact_confirmed`;
  answering "not yet" produces none
- `hierarchy_generated`'s payload, inspected in PostHog, contains no person name, no
  `reason` text and no prompt fragment
- `contact_confirmed`'s payload contains no `person_id` and no note text
- The ranking still completes and the view still leaves `pending` — the capture did not
  break the deferred task

**Implementation Note**: Pause here for manual confirmation before Phase 4.

---

## Phase 4: Opt-out control in `/settings`

### Overview

Give the user the switch that the `analytics_opt_out` column has been honouring since
Phase 1. No new design-system primitive: the control is a submit button in the shape
`DeleteDataSection` already established.

### Changes Required:

#### 1. Validation schema

**File**: `src/lib/validation/settings.ts`

**Intent**: Parse the toggle submission alongside the existing email and password schemas.

**Contract**: Adds a parse function for the analytics form yielding a single boolean —
the desired `analytics_opt_out` value — following the `parseEmailChangeForm` shape already
in the file.

#### 2. Settings API route

**File**: `src/pages/api/settings/analytics.ts`

**Intent**: Persist the user's choice.

**Contract**: A `POST` route in the shape of `src/pages/api/settings/email.ts` — 401 when
`context.locals.user` is absent, parse, 400 on failure, `createClient` with
`authCookieHeaders`, 500 when Supabase is unconfigured, then update `analytics_opt_out` on
the caller's own `profiles` row and return `{ success: true }` with the auth cookie
headers attached. Row scoping comes from RLS, not from a client-supplied id.

#### 3. Settings section component

**File**: `src/components/settings/AnalyticsSection/` (`AnalyticsSection.tsx`, `types.ts`,
`index.ts`)

**Intent**: Render the current state and let the user flip it, in plain language about what
is and is not collected.

**Contract**: Folder-with-barrel layout per `lessons.md`. Takes the current opt-out value as
a prop; posts to `/api/settings/analytics` and reflects the new state without a full
reload. The control is a `Button` whose label is the action — "Wyłącz analitykę" when
currently opted in, "Włącz analitykę" when opted out — not a switch; no primitive is added
to `src/components/ui/`. Copy states honestly what is collected: which product steps were
reached, never who the user's people are.

#### 4. Settings page wiring

**File**: `src/pages/settings.astro`

**Intent**: Show the section, and load the current value to seed it.

**Contract**: Load `analytics_opt_out` for the signed-in user alongside the existing
`loadProfileName` call, and render a new `<section>` titled "Prywatność" carrying
`<AnalyticsSection client:load />`, placed between "Przypomnienia" and "Strefa zagrożenia"
so the destructive zone stays last. Match the existing section markup exactly — same
`rounded-2xl border p-8` card, same heading classes. Per `lessons.md`, any link styled as a
button inside an `.astro` file uses `buttonVariants()` on a native `<a>`; the control here
is a React `Button` inside a `.tsx` island, so that trap does not apply — but the section
does produce visible UI, so it needs a human look.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes (including `jsx-a11y`): `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `/settings` renders the new "Prywatność" section correctly, and the button is visibly a
  button (the `lessons.md` rendering trap)
- Opting out, then completing a funnel step, produces **no** new event in PostHog
- Opting back in restores event flow
- The choice survives a page reload and a fresh sign-in
- The other four `/settings` sections are unaffected

**Implementation Note**: Pause here for manual confirmation before Phase 5.

---

## Phase 5: Verification script, funnel insight and event catalog

### Overview

Prove the whole path from outside the app, save the insight that answers the Success
Criteria question, and document the catalog so a future contributor extends it safely.

### Changes Required:

#### 1. Verification script

**File**: `scripts/verify-analytics.ts`, `package.json`

**Intent**: Drive the real funnel against a **deployed** Worker and assert that every
capture path returns cleanly and none of them blocks the response — the same self-evidencing
bar `verify-openai-call.ts` set, since `wrangler tail` proves nothing until a
`versions deploy` has run.

**Contract**: Copies `scripts/verify-openai-call.ts` exactly: `assert()` + `failures[]` +
non-zero exit, refusal to run against `localhost`, credentials from `VERIFY_EMAIL` /
`VERIFY_PASSWORD` env vars, sign-in through `/api/auth/signin` with an explicit `Origin`
header because that request is form-encoded, and `Content-Type: application/json` on JSON
routes — both per `lessons.md`. Registered as `"verify:analytics": "tsx
scripts/verify-analytics.ts"` alongside the four existing `verify:` scripts.

Assertions: each instrumented route still returns its expected status; each response returns
within a budget that proves the capture is not awaited in the request path; a second profile
save and a second person add do **not** re-fire their once-only events (asserted through
the pre-check's observable behaviour, since the script cannot see PostHog); and with the
opt-out set, the routes still succeed. The script proves the app's side of the contract —
PostHog's side is the manual check below, because a 2xx from `/i/v0/e/` is returned well
before ingestion decides anything.

#### 2. Event catalog documentation

**File**: `context/changes/product-analytics-posthog/event-catalog.md`

**Intent**: The in-repo answer to "what do we track, and what may an event carry?" — named
by F-06's outcome as a deliverable.

**Contract**: One table of the five events with their properties, the emission point for
each (file and the condition that gates it), and the privacy rule stated as a rule:
properties are allow-listed in `src/lib/analytics/events.ts`, and a property may be added
only if it cannot identify or describe a third party. Records the decisions this change
made and their reasons — Cloud EU as a one-way door, bare `fetch` over `posthog-node`,
`person_id` excluded, `$process_person_profile: false`, no `config-status.ts` entry — so a
future reader does not relitigate them.

#### 3. Roadmap and Linear sync

**File**: `context/foundation/roadmap.md`, plus the `[F-06]` Linear issue

**Intent**: Keep the two trackers honest, per the standing `lessons.md` rule.

**Contract**: Flip `F-06`'s status in both the `## At a glance` table and the item body, and
update the matching `[F-06] …` issue in team `GRatajczak`, project `InTouch MVP v1` —
**In Progress** while manual verification is outstanding, **Done** on close, with a comment
carrying per-phase commit SHAs, every divergence from this plan with its reason, and any
manual items still open.

### Success Criteria:

#### Automated Verification:

- `npm run verify:analytics -- <deployed-url>` exits zero against a `versions upload`
  preview or production
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- A saved PostHog funnel insight shows all five steps in order with non-zero counts, and
  answers "did a user get from *added my people* to *confirmed a contact*?" without reading
  Workers logs
- Spot-checking one event of each of the five types in PostHog finds no name, no
  `description`, no `relationship_context`, no tags, no `last_contact_bucket`, no email and
  no `person_id`
- No PostHog *person profile* was created (confirming `$process_person_profile: false` took
  effect)
- `event-catalog.md` matches what the code actually sends
- The `[F-06]` Linear issue reflects reality

---

## Testing Strategy

No test runner exists yet — `context/foundation/test-plan.md` Phase 1 (Vitest bootstrap) is
`change opened`, not shipped, and wiring it is that change's job, not this one's. The
evidence available to this change is therefore the repo's existing three-part bar:

### Automated (per phase)

`npx astro check`, `npm run lint`, `npm run build` — plus `supabase db reset` in Phase 1
and `npm run verify:analytics` in Phase 5.

### Verification script (Phase 5)

`scripts/verify-analytics.ts` against a deployed Worker, in the established
`verify-openai-call.ts` shape. It proves the app's half of the contract: correct statuses,
non-blocking timing, once-only semantics, and that an opted-out user's requests still
succeed.

### Manual testing steps

1. Sign up with a fresh email → expect one `signup_started`.
2. Fill the self-profile → expect one `profile_completed`. Save it again → expect none.
3. Add the first person → expect one `first_person_added` with the right `people_added`.
   Add another → expect none.
4. Generate the hierarchy → expect one `hierarchy_generated` matching the persisted ranking.
5. Confirm a contact as "Tak, rozmawialiśmy" → expect one `contact_confirmed`. Answer
   "not yet" on another → expect none.
6. Open each event's properties in PostHog and confirm the forbidden fields are absent.
7. Opt out in `/settings`, repeat steps 4–5 → expect no new events. Opt back in → flow
   resumes.
8. Build the funnel insight over the five events and confirm the counts.

### When the suite lands

`test-plan.md` §3 Phase 4 covers input boundaries and prompt composition and will touch
`src/pages/api/profile.ts`, `people.ts` and `contact-events.ts` — the same routes this
change instruments. The once-only pre-checks are the natural regression target then. This
change adds no test file and claims no coverage.

## Performance Considerations

- **Subrequests.** A full ranking run measured ~7 of 50. One capture adds 1; the consent
  read adds at most 1 more, and is folded into an existing query at step 2 and into the
  already-loaded profile row at step 4. Worst case (step 5) is 2 extra subrequests on a
  route that today makes 4. Comfortable.
- **CPU.** Awaiting `fetch` is I/O, not CPU, and does not count against the free tier's
  10ms limit. JSON-serializing a five-field object is negligible.
- **Response latency.** Nothing is awaited in a request path. The four API routes dispatch
  through `waitUntil` and return immediately; step 4 awaits inside a task that is already
  deferred and whose latency the user never sees. Phase 5's script asserts this from its
  own timing.
- **Bundle.** Choosing `fetch` over `posthog-node` means this change adds no dependency and
  no measurable bundle weight — which matters because no vendor's weight has ever been
  measured in this repo and no bundle-size gate exists.
- **No batching.** Deliberate: one event per user action against 43+ spare subrequests
  answers no measured need, and no batching precedent exists here (F-04 explicitly deferred
  chunking).

## Migration Notes

One migration, forward-compatible by construction: `analytics_opt_out boolean not null
default false` on `public.profiles`. Because `wrangler rollback` reverts code but not the
database (`CLAUDE.md` §Rollback), a rollback to a pre-Phase-1 Worker leaves the column in
place, unread and harmless. No backfill: the default is the intended value for every
existing row. No RLS or GRANT change. No column is removed.

Existing profiles are treated as consented. Anyone who signed up before this change is
opted in by default and can opt out from `/settings` once Phase 4 lands.

## References

- Research: `context/changes/product-analytics-posthog/research.md`
- Change identity: `context/changes/product-analytics-posthog/change.md`
- Roadmap item: `context/foundation/roadmap.md` → `F-06`
- Quality bar in force: `context/foundation/test-plan.md` §5
- Standing rules: `context/foundation/lessons.md`
- Non-blocking dispatch pattern: `src/pages/api/rankings.ts:69-79`
- Vendor factory pattern: `src/lib/openai.ts:1-9`
- Verification-script template: `scripts/verify-openai-call.ts`
- Settings route + section shape: `src/pages/api/settings/email.ts`,
  `src/components/settings/DeleteDataSection/`
- Column-add precedent: `supabase/migrations/20260831202209_add_profile_rhythm_fields.sql:6-14`
- Subrequest/CPU measurements: `context/archive/2026-09-01-ai-contact-hierarchy/production-verification.md:25-43`
- PostHog capture contract: `POST <host>/i/v0/e/`, verified via Context7 against
  `/posthog/posthog.com` on 2026-09-06

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Consent-aware wrapper, event catalog and secret path

#### Automated

- [x] 1.1 Migration applies cleanly against the local stack: `supabase db reset` — 5e55410
- [x] 1.2 Regenerated types include the new column: `npm run db:types` leaves a clean diff on rerun — 5e55410
- [x] 1.3 Type checking passes: `npx astro check` — 5e55410
- [x] 1.4 Linting passes: `npm run lint` — 5e55410
- [x] 1.5 Build passes with the new env schema entry: `npm run build` — 5e55410

#### Manual

- [x] 1.6 A PostHog Cloud EU project exists and its project API key is in hand — 5e55410
- [x] 1.7 `POSTHOG_API_KEY` set in `.dev.vars`, Workers Secrets and GitHub repo secrets — 5e55410
- [x] 1.8 `src/lib/analytics/events.ts` alone makes the permitted properties obvious — 5e55410

### Phase 2: Funnel steps 1–3

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — 3b83bb6
- [x] 2.2 Linting passes: `npm run lint` — 3b83bb6
- [x] 2.3 Build passes: `npm run build` — 3b83bb6

#### Manual

- [x] 2.4 A fresh signup produces one `signup_started` — 3b83bb6
- [x] 2.5 First profile fill produces exactly one `profile_completed`; a second save produces none — 3b83bb6
- [x] 2.6 First person/batch produces exactly one `first_person_added` with a correct `people_added`; a second add produces none — 3b83bb6
- [x] 2.7 Those events carry no name, no free text and no email — 3b83bb6
- [x] 2.8 Signup, profile save and person add still respond as fast as before — 3b83bb6

### Phase 3: Funnel steps 4–5

#### Automated

- [x] 3.1 Type checking passes: `npx astro check` — c21e1fd
- [x] 3.2 Linting passes: `npm run lint` — c21e1fd
- [x] 3.3 Build passes: `npm run build` — c21e1fd

#### Manual

- [x] 3.4 One `hierarchy_generated` matching the persisted ranking, with a plausible `duration_ms` — c21e1fd
- [x] 3.5 "Tak, rozmawialiśmy" produces one `contact_confirmed`; "not yet" produces none — c21e1fd
- [x] 3.6 `hierarchy_generated` carries no person name, no `reason` text and no prompt fragment — c21e1fd
- [x] 3.7 `contact_confirmed` carries no `person_id` and no note text — c21e1fd
- [x] 3.8 The ranking still completes and the view still leaves `pending` — c21e1fd

### Phase 4: Opt-out control in `/settings`

#### Automated

- [x] 4.1 Type checking passes: `npx astro check` — 6f671bc
- [x] 4.2 Linting passes (including `jsx-a11y`): `npm run lint` — 6f671bc
- [x] 4.3 Build passes: `npm run build` — 6f671bc

#### Manual

- [x] 4.4 `/settings` renders the "Prywatność" section correctly and the button looks like a button — 6f671bc
- [x] 4.5 Opting out then completing a funnel step produces no new event — 6f671bc
- [x] 4.6 Opting back in restores event flow — 6f671bc
- [x] 4.7 The choice survives a reload and a fresh sign-in — 6f671bc
- [x] 4.8 The other four `/settings` sections are unaffected — 6f671bc

### Phase 5: Verification script, funnel insight and event catalog

#### Automated

- [x] 5.1 `npm run verify:analytics -- <deployed-url>` exits zero
- [x] 5.2 Type checking passes: `npx astro check`
- [x] 5.3 Linting passes: `npm run lint`
- [x] 5.4 Build passes: `npm run build`

#### Manual

- [x] 5.5 A saved PostHog funnel shows all five steps in order with non-zero counts
- [x] 5.6 Spot-checking one event of each type finds none of the forbidden fields
- [x] 5.7 No PostHog person profile was created
- [x] 5.8 `event-catalog.md` matches what the code actually sends
- [x] 5.9 The `[F-06]` Linear issue reflects reality
