# Input boundary and prompt composition — Plan Brief

> Full plan: `context/changes/testing-input-boundary-and-prompt-composition/plan.md`
> Research: `context/changes/testing-input-boundary-and-prompt-composition/research.md`

## What & Why

Test-plan rollout Phase 4, covering Risk #6 (unbounded bulk insert; instruction-shaped free text steering the ranking) and Risk #8 (a rejected add-person submit discarding what the user typed). Research found these aren't just missing tests — they're real, confirmed bugs, including one worse than its own risk description: an unguarded `Promise.all` in `/api/people` that crashes with no error message at all.

## Starting Point

`POST /api/people` accepts an unlimited number of person-rows per request with no cap anywhere. Its pre-insert `Promise.all` (a people-count query + an analytics-consent check) has no try/catch, so a thrown rejection is an unhandled 500. `PersonForm.tsx` clears its localStorage draft the instant client-side validation passes — before the server confirms anything — so any server-only rejection (including the crash above) silently destroys a multi-person entry. `loadRankingPeople` loads every active person with no `.limit()`, amplifying the same "no ceiling" root cause into the ranking prompt and its DB writes. Three of four free-text fields reaching the ranking prompt (`description`, `relationship_context`, `context_tags`) have no "this is context, not an instruction" framing — only contact-history notes do.

## Desired End State

A submission over 20 people is rejected the same way any invalid form is; a thrown exception redirects with an error instead of crashing; the add-person draft survives any rejection and clears only after a real, server-confirmed success; the ranking query never loads more people than it will use, and picks the correct top-N by weight; the system prompt frames every free-text field as context, and a test proves the model can't escape the output contract (real people only, enum-locked urgency) no matter what that text says.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope framing | Fix and test together | Matches Phase 3's established precedent — close real bugs, not just pin them | Plan (user-confirmed) |
| Row cap | Hard `.max(20)` in `peopleFormSchema` | One schema, shared by client and server, same pattern as existing field bounds | Plan (user-confirmed) |
| Draft-race fix | Redirect-signal (`/people?added=1`) | Smaller diff than a fetch-based rewrite; draft clears only on confirmed success | Plan (user-confirmed) |
| Risk #6b scope | Add prompt framing + test the contract | Closes the soft gap instead of only testing around it | Plan (user-confirmed) |
| Cap test layer | Integration test on the route | Proves the real enforced boundary at the actual entry point | Plan (user-confirmed) |
| Amplification fix | Add `.limit()` to `loadRankingPeople` now | Same root cause, one line, cheap to close alongside | Plan (user-confirmed) |
| Component testing | Extract draft store to a plain module | No jsdom/RTL in this repo; sidesteps needing new test infra | Plan (research-grounded) |

## Scope

**In scope:** row-count cap + test; the `Promise.all` crash guard + test; the draft-clear race fix + test; `loadRankingPeople`'s `.limit()`/`.order()` + test; prompt framing generalization + adversarial-input contract test; test-plan.md documentation.

**Out of scope:** new component-rendering test infrastructure; rate-limiting/abuse prevention over time; the already-parked F5/F6 findings (indefinite localStorage retention); any E2E coverage of the redirect chain; changing `PEOPLE_CAP` (50) itself.

## Architecture / Approach

Phases 1–2 both touch `src/pages/api/people.ts` and `PersonForm.tsx` (the two `/people/new` risks); Phase 3 is an independent one-line query fix on the ranking side; Phase 4 reuses Phase 3's (`testing-ai-boundary-job-states`) fetch-stub/fake-Supabase harness rather than inventing a new one. Every phase fixes one bug and proves it in the same phase.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Row cap + crash guard | `/api/people` bounded and crash-safe, route-tested | Getting the crash-path test to force a real rejection deterministically |
| 2. Draft-clear race fix | Draft survives rejection, clears only on real success | Coordinating the redirect signal between the route and the page |
| 3. Ranking query cap | `loadRankingPeople` matches the ranking's own top-N | Missing the `.order()` pairing would silently change which people rank (see plan's Critical Implementation Details) |
| 4. Prompt framing + contract test | All free text framed as context; contract proven under adversarial input | Distinguishing "proves the contract" from "proves the model behaves" |
| 5. Documentation | test-plan.md reflects Phase 4 as shipped | None — pure docs |

**Prerequisites:** none beyond the local Supabase stack already used by `tests/routes/*`.
**Estimated effort:** ~1 session across 5 phases.

## Open Risks & Assumptions

- The crash-path test (Phase 1) needs a purpose-built throwing double rather than the real RLS fixture, since forcing a genuine network exception against a live local stack isn't reliably reproducible.
- The cap value (20) is a judgment call, not derived from a hard product requirement — easy to change later since it's one named constant.

## Success Criteria (Summary)

- A user cannot lose an in-progress add-person entry to any server-side rejection, including a crash.
- A user cannot insert more than 20 people in one submission, and the boundary is proven at the real route.
- The ranking never processes more people than it selects, and adversarial free text cannot make the model fabricate or drop a real person.
