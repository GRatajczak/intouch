# Analytics privacy boundary — Implementation Plan

## Overview

Test-plan rollout Phase 6 (`context/foundation/test-plan.md` §3, last phase for F-07 `automated-test-harness`), covering Risk #9: no analytics event payload may carry a person's name, description, context, tags or the user's email, and an opt-out must actually suppress sending. Unlike Phases 3 and 4, research (`research.md`, this change folder) found **no bugs** — every consent gate and the payload's closed union are already correctly implemented. This phase is pure test-addition: proving what already works, so a future refactor can't silently break it without a red test.

## Current State Analysis

- `src/lib/analytics/events.ts` — a closed discriminated union of five events (`signup_started`, `profile_completed`, `first_person_added`, `hierarchy_generated`, `contact_confirmed`). No free-form property object anywhere in the call path.
- `src/lib/analytics/capture.ts:25-61` — the one network-edge function: bare `fetch` POST to `${config.host}/i/v0/e/`, body `{api_key, event, distinct_id, properties, timestamp}`. Never throws (a non-2xx or a failed fetch both log and resolve normally).
- `src/lib/analytics/consent.ts` — `consentFromOptOut(optOut)` (`optOut !== true`) and `hasAnalyticsConsent(supabase, ownerId)`, which fails closed (returns `false`, never throws) on a query error.
- Four call sites gate on consent: `src/pages/api/people.ts` (`existingPeople === 0 && consented`), `src/pages/api/contact-events.ts` (`outcome === "happened" && consented`), `src/lib/ranking/run.ts` (`consentFromOptOut(profile.analytics_opt_out)`), and two more (`signup.ts`, `profile.ts`) that fire unconditionally by design since no profile row exists yet to carry an opt-out.
- `src/pages/api/settings/analytics.ts` — the opt-out toggle route, structurally identical to the already-tested `src/pages/api/settings/reminders.ts`, including the same `.select().maybeSingle()` guard against PostgREST's "matched zero rows, `error: null`" false-success case.
- **Zero test coverage** exists today for any of the above. The browser channel (`scrub-event.ts`, `sanitize-url.ts`) is already fully tested by a separate, later change and stays out of scope.
- `.env.test` has no `POSTHOG_API_KEY`, so `getAnalyticsConfig()` returns `null` under `tests/unit` today — `capture()`'s happy path (the actual POST) cannot be exercised until a placeholder key is added, mirroring the existing `OPENAI_API_KEY=sk-test-app-key-placeholder` precedent in the same file (real network calls stay stubbed regardless of the key's presence).

### Key Discoveries

- `tests/routes/reminders-toggle.test.ts` — the exact structural template for the new `/api/settings/analytics` route test (anonymous-401, bad-body-400, both-directions toggle, 404-on-no-row, cross-owner isolation).
- `tests/routes/free-tier-limit.test.ts:49-61` (`stubOpenAiFetch`) — the pass-through fetch-stub pattern: intercept calls whose URL matches the vendor host, pass everything else (including the RLS fixture's own real Supabase HTTP calls) to the real `fetch`. This is the pattern to mirror for stubbing PostHog's host (`eu.i.posthog.com`) inside a route test that also needs a real Supabase connection.
- `.env.test`'s own header comment documents exactly why a placeholder secret is safe there: it exists only so app code has something non-empty to build with, and every real network call goes through a stubbed `fetch` regardless.

## Desired End State

- `capture()`'s payload construction (property allow-list, `distinct_id`, the never-throws guarantee) has unit test coverage against a stubbed PostHog endpoint.
- `consentFromOptOut` and `hasAnalyticsConsent` (including its fail-closed-on-error behavior) have unit test coverage.
- `POST /api/settings/analytics` has the same test coverage shape as its sibling `/api/settings/reminders`.
- At least one consent-gated emission point (`POST /api/people`) has a route-level test proving an opted-out owner's action produces zero outgoing PostHog calls, and a consented owner's produces exactly one call with the allow-listed payload.
- `test-plan.md` records Phase 6 as complete, and `roadmap.md` closes out F-07 (`automated-test-harness`) entirely — this is its last rollout phase.

### Verification

`npm test tests/unit tests/routes` passes, including every new file below. `npm run lint` and `astro check` are clean.

## What We're NOT Doing

- No test for `src/lib/analytics/browser.ts`'s `applyConsent` — the browser channel's own privacy guarantee (`scrubEvent`, `sanitizeUrl`) already has dedicated, shipped tests from a separate change; mocking `posthog-js` to test a 4-line branch is out of this phase's named scope (Risk #9 / F-06's server channel).
- No test for the "no `POSTHOG_API_KEY` configured" branch of `getAnalyticsConfig()` — `astro:env/server` values are inlined at Vite config-resolution time, so this repo's test stack cannot toggle an env var's presence per test case (the same constraint documented in `vitest.config.ts`). The branch is a one-line early return already covered by ordinary code reading, not by a live toggle.
- No "narrow blast radius" assertion on the analytics toggle (e.g. proving it doesn't also touch `reminders_enabled`) — the route's `.update({analytics_opt_out: ...})` call structurally cannot touch another column; `reminders-toggle.test.ts` sets the precedent of not testing this either.
- No change to `event-catalog.md` — already accurate, no drift found.
- No production code changes of any kind — this phase adds tests only.

## Implementation Approach

Phase 1 proves the two pure/near-pure pieces (`capture()`'s payload shape, the consent predicate) in isolation. Phase 2 proves the two integration points that matter end-to-end: the toggle route itself, and one real consent gate exercised through a real route with the vendor stubbed at the network edge — reusing the RLS fixture already established across Phases 1 and 4 of this rollout.

## Phase 1: Payload and consent-predicate unit tests

### Overview

Adds a placeholder `POSTHOG_API_KEY` to `.env.test` (mirroring the existing `OPENAI_API_KEY` precedent), then proves `capture()`'s payload construction and the consent predicate's truth table, including its fail-closed behavior on a query error.

### Changes Required

#### 1. Test-only PostHog key

**File**: `.env.test`

**Intent**: `getAnalyticsConfig()` must return non-null under `tests/unit` so `capture()`'s actual POST branch is reachable at all.

**Contract**: Add `POSTHOG_API_KEY=phc_test-placeholder` with a comment mirroring the existing `OPENAI_API_KEY` entry's rationale — every real network call still goes through a stubbed `fetch`, so the value is never a real credential and is never asserted on.

#### 2. `capture()` payload test

**File**: `tests/unit/analytics-capture.test.ts` (new)

**Intent**: Prove the exact POST contract: the URL, the body shape, the property allow-list plus `$process_person_profile: false`, and that a non-2xx response or a rejected fetch both resolve without throwing.

**Contract**: Stub `globalThis.fetch` (mirroring `tests/routes/free-tier-limit.test.ts`'s `stubOpenAiFetch`, matching on the PostHog host). Cases: (a) a `hierarchy_generated` event — assert the captured request body's `properties` contains exactly `{model, people_total, people_considered, duration_ms, $process_person_profile: false}`, `distinct_id` equals the passed owner id, `event` equals `"hierarchy_generated"`; (b) the stub responds `500` — `capture()` resolves without throwing; (c) the stub's fetch mock rejects — `capture()` resolves without throwing.

#### 3. Consent predicate tests

**File**: `tests/unit/analytics-consent.test.ts` (new)

**Intent**: Prove `consentFromOptOut`'s truth table and `hasAnalyticsConsent`'s three real-row cases plus its fail-closed-on-error behavior.

**Contract**: `consentFromOptOut`: `undefined`/`null`/`false` → `true`; `true` → `false` (pure function, no stub needed). `hasAnalyticsConsent`: a small purpose-built fake `profiles`-only client (not the shared `fakeSupabase` from the ranking tests, which models a different table set) for three cases — no row (`data: null, error: null`) → `true`; a row with `analytics_opt_out: false` → `true`; a row with `analytics_opt_out: true` → `false`; a client whose query resolves `{data: null, error: {message: "..."}}` → `false` (the fail-closed regression case).

### Success Criteria

#### Automated Verification

- `npm test tests/unit/analytics-capture.test.ts tests/unit/analytics-consent.test.ts` passes
- `npm run lint` passes
- `astro check` passes

#### Manual Verification

- Temporarily change `hasAnalyticsConsent`'s error branch to `return true` instead of `false`, confirm the fail-closed test case goes red, then restore it

---

## Phase 2: Route-level toggle and consent-gate tests

### Overview

Proves `POST /api/settings/analytics`'s toggle-inversion contract, and proves one real consent gate (`POST /api/people`'s `first_person_added`) with PostHog stubbed at the network edge — an opted-out owner's submission produces zero outgoing calls, a consented owner's produces exactly one with the allow-listed payload.

### Changes Required

#### 1. Analytics toggle route test

**File**: `tests/routes/analytics-toggle.test.ts` (new)

**Intent**: Mirror `tests/routes/reminders-toggle.test.ts` exactly, adapted to `analytics_opt_out`'s inverted wire contract (`enabled: true` writes `analytics_opt_out: false`).

**Contract**: Same five cases as the reminders sibling — anonymous caller refused (401); a non-boolean body rejected (400), flag untouched; toggling `enabled: false` then `enabled: true` flips `analytics_opt_out` to `true` then back to `false`; a caller with no profile row gets 404, not a false 200; a route invoked with A's session but B's id never touches A's row.

#### 2. Consent-gated emission route test

**File**: `tests/routes/people-analytics-consent.test.ts` (new)

**Intent**: Prove `POST /api/people`'s `first_person_added` emission actually respects `analytics_opt_out` at the real route, with the vendor call visible or absent at the network edge — not merely inferred from reading the code.

**Contract**: Using the RLS fixture (as `tests/routes/people.test.ts` already does for the same route), set `analytics_opt_out: true` on the seeded owner and submit one person via the route — assert the PostHog-host fetch stub was never invoked. Reset to `analytics_opt_out: false` (or leave unset) on a second fresh case and submit one person — assert the stub was invoked exactly once, with `event: "first_person_added"`, `distinct_id` equal to the owner id (never an email), and `properties` containing exactly `{people_added: 1, $process_person_profile: false}` — no other key.

### Success Criteria

#### Automated Verification

- `npm test tests/routes/analytics-toggle.test.ts tests/routes/people-analytics-consent.test.ts` passes
- `npm test tests/routes/reminders-toggle.test.ts` still passes unchanged (confirms the pattern reuse didn't touch the sibling)
- `npm run lint` passes
- `astro check` passes

#### Manual Verification

- Temporarily invert the gate in `src/pages/api/people.ts` (`consented` → `!consented`) and confirm both new route-test cases go red in the expected direction, then restore it

---

## Phase 3: Documentation

### Overview

Records Phase 6 as shipped in `test-plan.md`, and — since this is the rollout's last phase — closes out F-07 (`automated-test-harness`) entirely in `roadmap.md`.

### Changes Required

#### 1. Cookbook pattern

**File**: `context/foundation/test-plan.md`, new §6.9 "Adding a test around the analytics privacy boundary"

**Intent**: Document the PostHog network-edge stub pattern (parallel to §6.5's OpenAI one), the consent-predicate fail-closed pattern, and a pointer to `reminders-toggle.test.ts` as the toggle-route template these tests reused rather than reinvented.

#### 2. Freshness ledger, per-phase note, and Phase 6 status

**File**: `context/foundation/test-plan.md`, §8, §6.6, and §3

**Intent**: §8 gains a line noting §6.9 was added. §6.6 gains a short "Phase 6" note that, unlike Phases 3–4, this phase found no bugs — purely closing a test-coverage gap. §3's Phase 6 row flips from `not started` to `complete`, and the "what genuinely remains" sentence is removed or updated to reflect the rollout's completion.

#### 3. Close out F-07 in the roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: F-07's rollout is now fully complete (all 6 phases). Flip its `## At a glance` row and its own `### F-07:` body `- **Status:**` line to `done`, update the Backlog Handoff table's F-07 row, and add F-07 to the `## Done` section at the bottom, following the exact format the other closed foundations (F-01–F-06) already use there.

### Success Criteria

#### Automated Verification

- `npm run lint` passes

#### Manual Verification

- A read-through of the updated §6.9/§6.6/§8/§3 in `test-plan.md`, and the F-07 closure in `roadmap.md`, confirms they read as intended

---

## Testing Strategy

### Unit Tests

- `tests/unit/analytics-capture.test.ts` — `capture()`'s payload contract (Phase 1)
- `tests/unit/analytics-consent.test.ts` — `consentFromOptOut` and `hasAnalyticsConsent`, including fail-closed (Phase 1)

### Integration Tests

- `tests/routes/analytics-toggle.test.ts` — the opt-out toggle route (Phase 2)
- `tests/routes/people-analytics-consent.test.ts` — one real consent gate, network-edge stubbed (Phase 2)

### Manual Testing Steps

1. Run `npm test tests/unit tests/routes` and confirm all new and existing tests pass.
2. Temporarily invert `hasAnalyticsConsent`'s error branch and the `POST /api/people` consent gate in turn, confirming each corresponding test goes red, then restore both.

## Performance Considerations

None — all new tests run against fakes/stubs or the existing local RLS fixture; no new network or database round-trips beyond what `tests/routes/people.test.ts` already pays.

## Migration Notes

None — no schema or data changes. `.env.test`'s new placeholder key is test-only configuration, not a migration.

## References

- Research: `context/changes/testing-analytics-privacy-boundary/research.md`
- Toggle-route template: `tests/routes/reminders-toggle.test.ts`
- Network-edge stub precedent: `tests/routes/free-tier-limit.test.ts` (`stubOpenAiFetch`), `tests/stubs/openai-responses-fetch.ts`
- Row-cap/crash-guard sibling on the same route: `tests/routes/people.test.ts` (`testing-input-boundary-and-prompt-composition`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Payload and consent-predicate unit tests

#### Automated

- [x] 1.1 npm test tests/unit/analytics-capture.test.ts tests/unit/analytics-consent.test.ts passes — 5437fe6
- [x] 1.2 npm run lint passes — 5437fe6
- [x] 1.3 astro check passes — 5437fe6

#### Manual

- [x] 1.4 Inverting hasAnalyticsConsent's error branch makes the fail-closed test go red, then restored — 5437fe6

### Phase 2: Route-level toggle and consent-gate tests

#### Automated

- [x] 2.1 npm test tests/routes/analytics-toggle.test.ts tests/routes/people-analytics-consent.test.ts passes — 03b04c6
- [x] 2.2 npm test tests/routes/reminders-toggle.test.ts still passes unchanged — 03b04c6
- [x] 2.3 npm run lint passes — 03b04c6
- [x] 2.4 astro check passes — 03b04c6

#### Manual

- [x] 2.5 Inverting the POST /api/people consent gate makes both new route-test cases go red, then restored — 03b04c6

### Phase 3: Documentation

#### Automated

- [x] 3.1 npm run lint passes — efd6256

#### Manual

- [x] 3.2 User read-through of updated test-plan.md §6.9/§6.6/§8/§3 and roadmap.md's F-07 closure confirms they read as intended — efd6256
