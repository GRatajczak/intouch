# AI boundary contract and job terminal states — Plan Brief

> Full plan: `context/changes/testing-ai-boundary-job-states/plan.md`
> Research: `context/changes/testing-ai-boundary-job-states/research.md`

## What & Why

Test-plan rollout Phase 3. Closes a live, confirmed defect where a schema-valid but empty or hallucinated AI ranking response is silently fabricated into a full ranking marked "done" — never surfacing as the error it should be (Risk #3). Proves the server-side half of the ranking job's terminal-state machine, complementing the already-shipped client-side e2e coverage (Risk #4).

## Starting Point

`reconcileEntries` (`src/lib/ranking/run.ts`) fabricates a complete, code-authored entry for every person the model's response fails to address, with no threshold at which this becomes a reported failure. Only a total parse failure has a working error path today. No test exists for the fallback path, for most of `runRanking`'s failure branches, or for the already-shipped stale-fact prompt fix. A network-edge stubbing precedent for testing `runRanking` (fake Supabase + stubbed `fetch`) already exists in `tests/unit/ranking-key-source.test.ts`, delivered under an unrelated change (S-17/BYOK) and missed by this change's own research pass — it makes the new tests in this plan cheaper (`tests/unit/`, no local Supabase stack) than originally assumed.

## Desired End State

A response that addresses none of the people it was sent fails the job with a clear error instead of rendering a fabricated hierarchy. Every `runRanking` exit path has a passing unit test. The stale-fact prompt fix is regression-pinned. An on-demand script lets a human ask an LLM to sanity-judge frozen ranking fixtures whenever the prompt changes — never in CI. `test-plan.md` reflects the shipped pattern and names the two things this phase deliberately leaves untestable.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| When does a bad response fail the job? | Only when **zero** entries matched a sent person | Closes the exact scenario Risk #3 names, without over-correcting a reasonable 1-2-person omission that today's fallback already handles fine | Plan (user-confirmed) |
| Fallback-entry visibility | Log-only (extend existing `flooredCount` line) | No migration risk; matches the existing logging precedent | Plan (user-confirmed) |
| Tie-break for equal weight | Document as an accepted, untestable gap | It's pure LLM-prompt behavior with no code enforcement — a fake test would prove nothing | Plan (user-confirmed) |
| Run-to-run determinism outside the recency floor's band | Document as an accepted limitation | Proving it needs a live call, which this suite's stack notes forbid; `ranking-recency-floor` already declined to pin `temperature` for the same reason | Plan (user-confirmed) |
| Contradiction-of-fact test scope | Only the already-shipped stale-bucket omission | Tests exactly what was built to fix the known production bug; avoids a brittle heuristic text parser | Plan (user-confirmed) |
| AI-native judge trigger | On-demand script, never CI | Matches `test-plan.md` §4's existing documented intent | Plan (user-confirmed) |
| Risk #4 server-side test scope | `runRanking`'s own terminal writes only, not `/api/rankings`'s route branches | Narrower, cheaper scope — the route's 400/404/in-flight-guard branches stay a known, separate gap | Plan (user-confirmed) |
| Test harness | Unit tests via the pre-existing fake-Supabase + fetch-stub precedent, not a new integration harness against the local Supabase stack | Discovered mid-planning: the precedent already exists (`tests/unit/ranking-key-source.test.ts`) and is cheaper | Plan (corrected during planning, user-confirmed) |

## Scope

**In scope:**
- Extracting the existing fetch/Supabase stub helpers into `tests/stubs/`
- The `reconcileEntries` zero-match guard and its log extension
- Unit tests for every `runRanking` exit path
- A contract test for the stale-bucket prompt fix
- An on-demand AI-native judge script and its fixtures
- `test-plan.md` cookbook and negative-space updates

**Out of scope:**
- Any schema/migration change
- `/api/rankings`'s route-handler branches (400/404/in-flight-guard)
- Code-level tie-break enforcement
- Pinning OpenAI call parameters for determinism
- CI wiring for the judge script

## Architecture / Approach

`runRanking` gains one guard clause and one log-line extension. Everything else is new test/script surface built on the already-existing network-edge stubbing pattern: a fake in-memory Supabase client plus a stubbed `globalThis.fetch` returning raw OpenAI Responses-API JSON, so the real SDK code runs unmodified in tests. Contrast: the plan originally assumed a new stub had to be built (aliasing the `openai` package, like `cloudflare:workers` is aliased) — reading the codebase during planning found the cheaper pattern already shipped.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract shared stub helpers | `tests/stubs/fake-ranking-supabase.ts`, `tests/stubs/openai-responses-fetch.ts` | Extraction accidentally changes existing test behavior |
| 2. Reconciliation fix + terminal-state tests | The Risk #3 fix, plus 6 test cases covering every `runRanking` exit | Guard placement relative to the recency-floor loop |
| 3. Contradiction contract test | Regression test for the stale-bucket omission | None significant — pure function, no external deps |
| 4. AI-native judge script | `scripts/judge-ranking-fixtures.ts` + fixtures + npm script | Judge fixtures not representative enough to catch real drift |
| 5. Documentation | `test-plan.md` §6.5/§7/§8/§6.6 updated | None |

**Prerequisites:** none beyond what's already in the repo (Vitest, the local `.env.test` OpenAI placeholder key already present).
**Estimated effort:** ~1 session across 5 phases — no new infrastructure, no schema, no live-service dependency for the automated parts.

## Open Risks & Assumptions

- The zero-tolerance-only guard (Q1's choice) means a response that hallucinates most people but gets one right still passes as "done" — accepted trade-off, not a gap this phase closes.
- The AI-native judge script's fixtures are hand-authored, not drawn from a corpus of real incidents beyond the one already known — its ability to catch a *novel* kind of contradiction is unproven until it's actually used.
- Tie-break and general determinism remain genuinely open product risks, not just test gaps — documenting them does not reduce their likelihood.

## Success Criteria (Summary)

- A total-fallback AI response now fails visibly instead of rendering as fact.
- Every `runRanking` branch has a test proving its terminal write.
- The known production contradiction bug has a regression test that would have caught it.
- `test-plan.md` no longer says "TBD" for the AI boundary, and its negative space matches what the team actually decided.
