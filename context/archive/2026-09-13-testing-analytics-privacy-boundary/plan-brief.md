# Analytics privacy boundary — Plan Brief

> Full plan: `context/changes/testing-analytics-privacy-boundary/plan.md`
> Research: `context/changes/testing-analytics-privacy-boundary/research.md`

## What & Why

Test-plan rollout Phase 6 — the last phase for F-07 (`automated-test-harness`) — covering Risk #9: no analytics event may carry a person's name/description/context/tags/email, and an opt-out must actually suppress sending. Unlike Phases 3 and 4, research found no bugs: everything is already correctly implemented. This phase closes a pure test-coverage gap so a future refactor can't silently break the privacy guarantee without a red test.

## Starting Point

The server channel's five-event closed union, `capture()`, and the four consent gates it feeds are all correctly built but have zero test coverage. The browser channel (`scrub-event.ts`, `sanitize-url.ts`) already has 68 tests from a separate, later change and is out of scope. `POST /api/settings/analytics` (the opt-out toggle) is untested despite being structurally identical to the already-tested `/api/settings/reminders`.

## Desired End State

`capture()`'s payload shape, the consent predicate's truth table (including its fail-closed-on-error behavior), the toggle route, and one real consent-gated emission point (`POST /api/people`) all have test coverage proving the privacy guarantee holds at runtime, not just at compile time.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Browser-channel scope | Stays out | Already fully tested by a separate change; testing `applyConsent` would mock `posthog-js` for a 4-line branch outside Risk #9's named scope | Plan (user-confirmed) |
| Consent-gate route to prove | `POST /api/people` | Reuses Phase 4's established fixture/harness; its `existingPeople === 0` condition is trivial to set up fresh | Plan (user-confirmed) |
| `hasAnalyticsConsent` fail-closed test | Included | A real, deliberate privacy decision (favors under-counting over leaking) with no regression test today | Plan (user-confirmed) |
| Toggle-route "blast radius" test | Not included | The `.update()` call structurally cannot touch another column; the tested sibling route doesn't test this either | Plan (user-confirmed) |

## Scope

**In scope:** unit tests for `capture()` and the consent predicate; a placeholder `POSTHOG_API_KEY` in `.env.test` so those tests can run; route tests for the toggle and one consent-gated emission point; test-plan.md and roadmap.md documentation, closing out F-07 entirely.

**Out of scope:** any browser-channel test; the "no API key configured" branch (can't be toggled per-test under this repo's env-inlining constraint); a toggle-route blast-radius assertion; any production code change.

## Architecture / Approach

Phase 1 proves the two near-pure pieces in isolation (payload shape, consent truth table). Phase 2 proves the two integration points end-to-end, reusing the RLS fixture and the OpenAI-stub pass-through pattern already established in Phases 1 and 4 of this same rollout, applied to PostHog's host instead.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Unit tests | `capture()` payload contract + consent predicate, incl. fail-closed | Needs a placeholder `POSTHOG_API_KEY` in `.env.test` first (mirrors existing `OPENAI_API_KEY` precedent) |
| 2. Route tests | Toggle route + one real consent gate, network-edge stubbed | Distinguishing PostHog-host fetch calls from the RLS fixture's own real Supabase HTTP calls in the same test |
| 3. Documentation | test-plan.md Phase 6 complete; roadmap.md closes F-07 entirely | None — pure docs, but a meaningful milestone (F-07 done) |

**Prerequisites:** local Supabase stack (already used by `tests/routes/*`).
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- None of significance — this is a low-risk, test-only phase with no production code changes.

## Success Criteria (Summary)

- A future code change that lets a person's name/description leak into an event payload, or that breaks the opt-out gate, now has a test that goes red.
- F-07 (`automated-test-harness`) is fully closed — all 6 rollout phases complete.
