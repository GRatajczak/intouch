---
date: 2026-09-13T13:18:23Z
researcher: Claude Sonnet 5
git_commit: e666ad5cb935c092a34633756bdc5606dbdbad90
branch: main
repository: intouch
topic: "test-plan.md rollout Phase 6 — analytics privacy boundary (Risk #9)"
tags: [research, codebase, test-plan, analytics, privacy, consent]
status: complete
last_updated: 2026-09-13
last_updated_by: Claude Sonnet 5
---

# Research: Analytics privacy boundary (test-plan Phase 6)

**Date**: 2026-09-13T13:18:23Z
**Researcher**: Claude Sonnet 5
**Git Commit**: e666ad5cb935c092a34633756bdc5606dbdbad90
**Branch**: main
**Repository**: intouch

## Research Question

Ground test-plan.md rollout Phase 6 ("Analytics privacy boundary", Risk #9) before planning: what does the codebase actually do to keep a person's name/description/context/tags/email out of an analytics event payload, and to make an opt-out actually suppress sending? What is tested today, and what genuinely isn't?

## Summary

Unlike Phases 3 and 4, this phase found **no bugs** — the analytics module is carefully built (F-06's own risk note already names privacy leakage as its central concern) and every emission point already gates correctly. What's missing is entirely **test coverage**, exactly matching Risk #9's own "must challenge" framing: "the payload type is a closed union, so nothing personal can get in — true at compile time, silent about the consent gate and the opt-out inversion."

Two channels send to PostHog, with two different guarantees and two different test states:

- **Browser channel** (`sanitize-url.ts`, `scrub-event.ts`) — already fully tested by a later, separate change (`web-analytics-pageviews`): 68 tests across `tests/unit/sanitize-url.test.ts` and `tests/unit/scrub-event.test.ts`. Out of this phase's scope.
- **Server channel** (the five-event closed union in `events.ts`, `capture()`, `hasAnalyticsConsent`/`consentFromOptOut`, and the four call sites that gate on consent) — **zero test coverage**. No test exists for `capture()`'s payload construction, the consent predicate's fail-closed behavior, any of the four consent-gated emission points, or `POST /api/settings/analytics` (the opt-out toggle route itself).

## Detailed Findings

### The server channel's structural guarantee

- `src/lib/analytics/events.ts:1-129` — `AnalyticsEvent` is a closed discriminated union of exactly five interfaces (`SignupStarted`, `ProfileCompleted`, `FirstPersonAdded`, `HierarchyGenerated`, `ContactConfirmed`). The file's own header comment states the rule under test: a property may be added only if it cannot identify or describe a third party. Every current event's `properties` is counts/booleans/durations/model-id only.
- `src/lib/analytics/capture.ts:25-61` — the one function that talks to PostHog. Bare `fetch` POST to `${config.host}/i/v0/e/`, body `{api_key, event, distinct_id, properties: {...event.properties, $process_person_profile: false}, timestamp}`. `distinctId` is documented as "the Supabase user id and nothing else -- never an email" (`:14`). **Never throws** (`:16-19,54-59`): a non-2xx response or a failed fetch both log and resolve normally. Returns immediately with no call at all when `getAnalyticsConfig()` is `null` (no API key configured) (`:26-29`).
- `src/lib/analytics/config.ts:37-42` — `getAnalyticsConfig()` returns `null` when `POSTHOG_API_KEY` is absent; otherwise `{apiKey, host: "https://eu.i.posthog.com"}`.

### The consent predicate

- `src/lib/analytics/consent.ts:16-18` — `consentFromOptOut(optOut)`: `optOut !== true`. A missing/null/undefined value counts as consented (documented rationale: the column defaults to false, and at `signup_started` no profile row exists yet).
- `src/lib/analytics/consent.ts:30-43` — `hasAnalyticsConsent(supabase, ownerId)`: reads `profiles.analytics_opt_out` via `.maybeSingle()`. **Fails closed on a query error** — logs and returns `false` (never throws, never defaults to consented on a read failure). This fail-closed behavior is asserted nowhere today.

### The four consent-gated emission points (plus one deliberately unconditional one)

- `src/pages/api/auth/signup.ts:32` — `signup_started` fires unconditionally. Correct by design: no profile row exists yet at this point, so there is nothing to opt out of (matches `consentFromOptOut`'s own documented rationale).
- `src/pages/api/profile.ts:36-46,58-68` — `profile_completed` fires unconditionally on the submit that creates the first profile row. Also correct by design, with an explicit code comment: a consent read here would be dead code, since the only branch that emits is the one where no row exists yet to carry an opt-out flag.
- `src/pages/api/people.ts:34-38,58-67` — `first_person_added` fires only when `existingPeople === 0 && consented`. `consented` comes from `hasAnalyticsConsent` read alongside the same `Promise.all` Phase 4 (`testing-input-boundary-and-prompt-composition`) already hardened with a try/catch.
- `src/pages/api/contact-events.ts:94-107` — `contact_confirmed` fires only when `outcome === "happened" && consented`; the consent read itself is skipped entirely (`Promise.resolve(false)`) for any other outcome, so a `"not_yet"` never even queries `profiles`.
- `src/lib/ranking/run.ts:311-320` — `hierarchy_generated` fires only when `consentFromOptOut(profile.analytics_opt_out)` is true, reading the already-loaded `profile` row directly rather than a second query (documented reasoning at `:310`).

**None of these four gates has a test proving the opted-out branch produces zero outgoing calls, or that the consented branch's payload is exactly the allow-listed shape.**

### The opt-out toggle route

- `src/pages/api/settings/analytics.ts` — flips `profiles.analytics_opt_out`. Structurally identical to `src/pages/api/settings/reminders.ts` (same file explicitly says so in its own header comment), including the same three hardening details: ordinary cookie-bound client (not service-role), an explicit `.eq("owner_id", …)` alongside RLS, and `.select().maybeSingle()` specifically to catch PostgREST's "UPDATE matched zero rows" `error: null` false-success case documented inline at `:20-24`.
- The route inverts the wire contract (`enabled: true` = send events) against the column's negative (`analytics_opt_out`), in both directions, at `:57`. This is exactly the inversion Risk #9's Response Guidance table names as something research must ground ("where the UI's positive maps to the column's negative").
- **No test exists for this route at all.** `tests/routes/reminders-toggle.test.ts` is its structural sibling and already tests the exact same shape of route (anonymous-refused, bad-body-400, toggle-both-directions, 404-on-no-profile-row, cross-owner-isolation) — a direct, provable template to mirror.

### What's already tested (out of this phase's scope)

- `tests/unit/sanitize-url.test.ts` (113 lines) and `tests/unit/scrub-event.test.ts` (183 lines) — 68 tests total, delivered by the later `web-analytics-pageviews` change, covering the **browser** channel's privacy guarantee (URL rewriting, dropped/URL-shaped property scrubbing). `src/lib/analytics/browser.ts` (`startAnalytics`/`applyConsent`) itself has no direct test — it imports `posthog-js`, which per that module's own comment "cannot be loaded in the node test environment" — but its two testable halves (`scrubEvent`, `sanitizeUrl`) were deliberately extracted into pure, dependency-free modules specifically so they could be. This is a proven pattern already in the codebase, not a gap this phase needs to close.
- `context/foundation/event-catalog.md` — up to date, matches `events.ts` exactly; no documentation drift found (unlike Phase 5's stale CI-gate status).

## Code References

- `src/lib/analytics/events.ts:1-129` — the closed union, five events
- `src/lib/analytics/capture.ts:25-61` — the one network-edge function
- `src/lib/analytics/consent.ts:16-18,30-43` — `consentFromOptOut`, `hasAnalyticsConsent`
- `src/lib/analytics/config.ts:37-42` — `getAnalyticsConfig`
- `src/pages/api/auth/signup.ts:32` — unconditional `signup_started`
- `src/pages/api/profile.ts:36-46,58-68` — unconditional `profile_completed`
- `src/pages/api/people.ts:34-38,58-67` — consent-gated `first_person_added`
- `src/pages/api/contact-events.ts:94-107` — consent-gated `contact_confirmed`
- `src/lib/ranking/run.ts:311-320` — consent-gated `hierarchy_generated`
- `src/pages/api/settings/analytics.ts` — the untested opt-out toggle route
- `tests/routes/reminders-toggle.test.ts` — the structural template to mirror

## Architecture Insights

- This module already follows the same "prove the contract, not the vendor" philosophy the ranking-boundary phases (3, 4) established: `capture()` is the one network-edge seam, exactly where a fetch stub belongs, mirroring `tests/stubs/openai-responses-fetch.ts`'s technique applied to a different vendor.
- The four consent gates are NOT one shared helper — each route re-derives its own condition (`existingPeople === 0 && consented`, `outcome === "happened" && consented`, a direct `consentFromOptOut(profile.analytics_opt_out)`). A test suite here has to prove each gate individually; there is no single choke point whose test would cover all four.
- `hasAnalyticsConsent`'s fail-closed-on-error behavior is a real, deliberate privacy design decision (favors under-counting over leaking) that has no regression test today — a future refactor could silently invert it to fail open without any check failing.

## Historical Context (from prior changes)

- `context/archive/2026-09-04-product-analytics-posthog/` (F-06) — built the server channel and its closed union deliberately narrow, per its own roadmap risk note: "the moment an event carries a person's name or description 'just for context', the product's binary privacy guardrail is broken in a vendor's database."
- `context/changes/web-analytics-pageviews/` (or wherever it lives — commits `4b75491`, `3a0da0b`) — built the browser channel and its own tests, including a real implementation-review-caught leak (`document.title` on `/people/[id]` carrying a contact's name) fixed in `3a0da0b`. Confirms this module has already been through one privacy-leak-found-by-review cycle — the server channel has not yet had an equivalent adversarial pass, which is exactly what this phase's tests provide.

## Related Research

- `context/changes/testing-ai-boundary-job-states/research.md` and `context/changes/testing-input-boundary-and-prompt-composition/research.md` — the two prior rollout phases; this phase's "stub the vendor at the network edge" approach is the same technique both already established, applied to PostHog instead of OpenAI.

## Open Questions

- Whether to also add a test for `src/lib/analytics/browser.ts`'s `applyConsent` (mocking `posthog-js` at the module level) — technically feasible (a 4-line function, a small SDK surface to mock), but arguably outside Phase 6's named scope, since the browser channel already has its own dedicated, shipped privacy tests from a separate change. The plan step should decide whether this phase's boundary is "the server channel Risk #9 actually names" or "every consent-adjacent code path in the analytics module."
- Which single consent-gated route best demonstrates the "transport stubbed at the network edge" route test the Risk Response Guidance explicitly asks for — `POST /api/people` (reuses Phase 4's fixture/harness in `tests/routes/people.test.ts`'s style) is the most natural candidate since its `existingPeople === 0` condition is trivial to set up fresh via the RLS fixture.
