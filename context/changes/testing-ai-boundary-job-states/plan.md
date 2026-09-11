# AI boundary contract and job terminal states — Implementation Plan

## Overview

Test-plan rollout Phase 3 (`context/foundation/test-plan.md` §3). Closes a live, confirmed defect (Risk #3: a schema-valid but empty/hallucinated AI ranking response is silently fabricated into a full "done" ranking with no error) and proves the server-side half of the ranking job's terminal-state machine (Risk #4: every `runRanking` exit path must write a real terminal job status). Both risks converge on the same function, `runRanking` (`src/lib/ranking/run.ts`), so their tests share one harness.

## Current State Analysis

`research.md` (this change folder) grounds the current behavior in detail. In summary:

- `reconcileEntries` (`src/lib/ranking/run.ts:73-115`) silently fabricates a full-strength, code-authored entry for every person the model's response failed to address, and the job is written `"done"` regardless — there is no threshold at which this becomes a reported error.
- Only a **total** parse failure (`response.output_parsed` falsy) has a working error path today (`run.ts:208-211`).
- A network-edge stubbing precedent for testing `runRanking` **already exists** and was missed by this change's own research pass: `tests/unit/ranking-key-source.test.ts` fakes the Supabase client in-memory and stubs `globalThis.fetch` to return raw OpenAI Responses-API-shaped JSON, so the real SDK (request building, `zodTextFormat`, `output_parsed` extraction) runs unmodified. `tests/routes/openai-key.test.ts` uses the same fetch-stubbing technique against the real local Supabase stack for a different route. Both predate this plan (delivered under S-17 / `byok-openai-key`) and explicitly note in their own comments that this is "the network-edge stubbing precedent the test plan's Phase 3 was going to set."
- Because of that precedent, `runRanking` is fully testable as a `tests/unit/` test — no local Supabase stack, no RLS fixture, no HTTP server — which is cheaper than this change's own research assumed.
- No test exists today for: the reconciliation fallback path, the `no profile` / `no people` / `no OpenAI client` throws, or a genuinely-null-parse response. `tests/unit/ranking-key-source.test.ts` only covers the two key-routing/failure-classification branches (401, 429, app-key success).
- `buildRankingPrompt` (`src/lib/ranking/prompt.ts`) already fixed the one confirmed production contradiction (stale `last_contact_bucket` fed alongside fresh facts, `feedback-triage-2026-09-08`) by omitting the bucket line whenever real `ContactFacts.lastHappenedAt` exists (`prompt.ts:156-159`) — untested today.
- Tie-breaking for equal weight and run-to-run determinism outside the recency floor's narrow band (0–6 days) are pure LLM/prompt behavior with no code enforcement — provably untestable without a live model call, which this project's stack notes forbid in the deterministic suite.

### Key Discoveries

- `tests/unit/ranking-key-source.test.ts:64-102` — `fakeSupabase`, the in-memory Supabase double this plan's new tests reuse.
- `tests/unit/ranking-key-source.test.ts:104-148` — `jsonResponse`/`stubFetch`/response builders, the network-edge stub this plan's new tests reuse.
- `src/lib/ranking/run.ts:73-115` — `reconcileEntries`, where the fix lands.
- `src/lib/ranking/run.ts:260-262` — the existing completion log line, extended rather than replaced.
- `src/lib/ranking/prompt.ts:147-159` — the stale-bucket omission this phase adds a contract test for.
- `scripts/verify-ranking.ts` — the live/deployed verification script pattern the new AI-native judge script follows structurally (`assert()`/`failures[]`/non-zero exit), though the judge script operates on frozen local fixtures instead of a live deployment.

## Desired End State

- A schema-valid OpenAI response that matches **zero** of the people actually sent produces a `"failed"` job with a descriptive error — never a rendered, fully-fabricated ranking.
- Every `runRanking` exit path (success, no profile, no people, no OpenAI client, total parse failure, total reconciliation failure) has a passing unit test asserting the job's terminal write.
- The already-shipped stale-bucket omission has a regression test, so a future edit to `prompt.ts` cannot silently reintroduce the contradiction.
- An on-demand script exists that asks an LLM to judge whether a small set of frozen ranking fixtures' `reason` text is plausible and non-contradictory — never wired into `npm test` or CI.
- `test-plan.md` §6.5 carries the worked pattern instead of "TBD," and §7 explicitly names the two risks this phase deliberately leaves untested (tie-break, general determinism) so a future reader does not mistake silence for an oversight.

### Verification

`npm test tests/unit` passes, including the three new/modified files below. `npm run lint` and `tsc --noEmit` (or `astro check`) are clean. The new script runs manually against its own fixtures and exits 0 or reports specific failures.

## What We're NOT Doing

- No database migration or schema change — fallback-entry visibility stays log-only (extends the existing `flooredCount` log line), never a persisted `source` column.
- No changes to `/api/rankings`'s route handler branches (`400` missing jobId, `404` unknown jobId, the in-flight-guard race) — those stay untested this phase, by explicit choice; they are a real, separate gap for a future phase.
- No code-level tie-break for equal-weight people — the existing prompt-only instruction (`prompt.ts:60`) is unchanged.
- No pinning of `temperature`/`top_p`/`seed` on the OpenAI call, and no live-call determinism verification script — `ranking-recency-floor` already declined this for the same unresolved-support reason, and this phase does not reopen it.
- No heuristic text-parser cross-checking `reason`/`contextNote` against `facts` beyond the one already-shipped stale-bucket omission.
- No CI wiring for the new AI-native judge script.
- No changes to the e2e layer (`tests/e2e/ranking-job-terminal-state.spec.ts`) — it already covers the client-side half of Risk #4 completely.

## Implementation Approach

Extract the existing fetch-stubbing precedent into shared `tests/stubs/` helpers first (proving the extraction is behavior-preserving by keeping the existing test green), then add the new tests on top of those helpers. This keeps the new tests as `tests/unit/` — the cheapest layer — and avoids duplicating ~100 lines of fixture code across files. The production code fix (Phase 2) and its tests ship together, since a test for behavior that doesn't exist yet would fail for the wrong reason if written first without the fix, and the fix is meaningless unclaimed by a test.

## Critical Implementation Details

**Guard placement inside `reconcileEntries`.** The "zero people matched" check must sit strictly between the first loop (which builds `seen` from real model entries, `run.ts:83-99`) and the second loop (which fabricates fallback entries for everyone still unmatched, `run.ts:101-112`) — placing it after the fallback loop would defeat it (`seen` would already be full), and placing it before the first loop would defeat the recency floor's per-entry application, which happens inside that first loop. The guard is `peopleSent.length > 0 && seen.size === 0`: the `peopleSent.length > 0` half is defensive (production code never calls this with an empty list — `runRanking` already throws earlier on "No people found for this account" — but the unit tests call through `runRanking`, not `reconcileEntries` directly, so the guard's own correctness under a hypothetical empty list is still worth being explicit about rather than assumed).

## Phase 1: Extract shared OpenAI test-stubbing helpers

### Overview

Moves the fetch-stubbing and fake-Supabase helpers already proven in `tests/unit/ranking-key-source.test.ts` into `tests/stubs/`, so Phase 2 and Phase 3's new test files reuse them instead of re-implementing. Pure refactor — no behavior change, proven by the existing test staying green.

### Changes Required

#### 1. Fake Supabase double

**File**: `tests/stubs/fake-ranking-supabase.ts` (new)

**Intent**: House the in-memory Supabase table double and row builders currently private to `ranking-key-source.test.ts`, so any test exercising `runRanking` can construct a fake client without a local Supabase stack.

**Contract**: Export `profileRow(over?: Partial<Tables<"profiles">>): Tables<"profiles">`, `personRow(over?: Partial<Tables<"people">>): Tables<"people">`, and `fakeSupabase(profile: Tables<"profiles">, people: Tables<"people">[]): SupabaseClient<Database>` with the exact same table-double behavior as today's private version (`profiles`/`people`/`contact_events`/`rankings`/`ranking_entries`, throwing on any other table name). No signature or behavior change from the version being extracted.

#### 2. OpenAI network-edge fetch stub

**File**: `tests/stubs/openai-responses-fetch.ts` (new)

**Intent**: House the `globalThis.fetch` stubbing helpers and OpenAI Responses-API-shaped response builders, generalized so a caller can supply an arbitrary `entries` array (today's version hardcodes one entry) — Phase 2's fallback tests need to construct empty and partially-matching arrays.

**Contract**: Export `jsonResponse(status: number, body: unknown): Response`, `stubFetch(response: Response): ReturnType<typeof vi.fn>`, `authorizationHeader(fetchMock): string | null`, `authenticationErrorResponse(): Response`, `rateLimitErrorResponse(): Response`, and `rankingSuccessResponse(entries: RankingOutputEntry[]): Response` (the generalized form of today's `successResponse()` — same `{status:"completed", output:[{type:"message", content:[{type:"output_text", text: JSON.stringify({entries})}]}]}` shape, entries now a parameter). Add `noOutputResponse(): Response` — a `status:"completed"` response whose `output` array is empty or carries no `output_text` message, for the "total parse failure" test case (`output_parsed` ends up falsy).

#### 3. Refactor the existing test to the shared helpers

**File**: `tests/unit/ranking-key-source.test.ts`

**Intent**: Replace the private `profileRow`/`personRow`/`fakeSupabase`/`jsonResponse`/`stubFetch`/`authenticationErrorResponse`/`rateLimitErrorResponse`/`authorizationHeader`/`successResponse` definitions with imports from the two new stub files. `successResponse()`'s one call site passes its original single-entry array explicitly to `rankingSuccessResponse`.

**Contract**: Zero change to any assertion or test name — this file's three existing tests must pass unmodified, proving the extraction preserved behavior exactly.

### Success Criteria

#### Automated Verification

- `npm test tests/unit/ranking-key-source.test.ts` passes with all three original tests unchanged
- `npm run lint` passes
- `tsc --noEmit` passes

#### Manual Verification

- Diff of `ranking-key-source.test.ts` shows only import changes and the one `successResponse()` call-site update — no assertion or test-name changes

---

## Phase 2: Reconciliation fix and terminal-state test coverage (Risks #3 and #4)

### Overview

Fixes the silent-fallback defect and proves every `runRanking` exit path reaches the correct terminal job write, using Phase 1's shared helpers.

### Changes Required

#### 1. Fail the job when the model addressed nobody it was sent

**File**: `src/lib/ranking/run.ts`

**Intent**: A schema-valid response whose `entries` are empty, or whose `personId`s match none of the people sent, must produce the same `"failed"` job status as a total parse failure — not a fully-fabricated ranking marked `"done"`. See "Critical Implementation Details" above for the exact placement.

**Contract**:
```ts
// inside reconcileEntries, after the first loop populates `seen`, before the fallback loop:
if (peopleSent.length > 0 && seen.size === 0) {
  throw new Error("OpenAI response matched no person sent");
}
```
This throw propagates out of the synchronous `reconcileEntries` call at `run.ts:213` into `runRanking`'s existing `try`/`catch`, reusing `classifyRankingError` and `writeJob(jobId, {status:"failed", error: message})` unchanged. A response that matches *some* but not all sent people is unaffected — it keeps today's fallback behavior for the unmatched few.

#### 2. Log the fallback count

**File**: `src/lib/ranking/run.ts`

**Intent**: Make a *partial* fallback (the case Phase 2.1 deliberately leaves unchanged) visible in `wrangler tail`, mirroring the existing `flooredCount` log — per this phase's decision, log-only, no persisted flag.

**Contract**: Add `fallbackCount` to `ReconcileResult`, incremented once per entry pushed by the tail fallback loop (`run.ts:101-112`). Extend the existing completion log line (`run.ts:260-262`) to also report it, e.g. `` `, ${String(fallbackCount)} entries fell back to a placeholder` `` appended to the existing message.

#### 3. Terminal-state test coverage for both risks

**File**: `tests/unit/ranking-terminal-states.test.ts` (new)

**Intent**: Prove every `runRanking` exit path writes the correct terminal job state, using Phase 1's `fakeSupabase`/fetch-stub helpers — no local Supabase stack.

**Contract**: One `describe` block per exit path, each asserting on `readJob(jobId)` after `await runRanking(...)`:
- Zero people matched (empty `entries: []`, 2+ people sent) → `status: "failed"`, error mentions the reconciliation failure; no `rankingId` set.
- Partial match (2 people sent, model addresses 1) → `status: "done"`; the persisted ranking includes a `no_rush` fallback entry for the omitted person (regression control proving 2.1 didn't overreach — matches today's shipped behavior).
- Full success (every sent person addressed) → `status: "done"`, `rankingId` set (happy-path control).
- No profile row → `status: "failed"`, error is `"No profile found for this account"`.
- No people rows (empty array) → `status: "failed"`, error is `"No people found for this account"`.
- Total parse failure (`noOutputResponse()`) → `status: "failed"`, error is `"OpenAI response had no parsed output"`.

### Success Criteria

#### Automated Verification

- `npm test tests/unit/ranking-terminal-states.test.ts` passes, all six cases green
- `npm test tests/unit/ranking-key-source.test.ts` still passes unchanged
- `npm run lint` passes
- `tsc --noEmit` passes

#### Manual Verification

- Temporarily revert the Phase 2.1 guard and confirm the new "zero people matched" test goes red (proves the test actually exercises the fix, not a tautology) — revert the revert afterward
- `wrangler tail` (or a local log inspection) shows the new fallback-count segment on a real partial-fallback run, e.g. via `npm run dev` and a manual dashboard visit with a deliberately sparse test account

---

## Phase 3: Contradiction-of-fact contract test (Risk #3, narrow scope)

### Overview

Regression-pins the one confirmed, already-shipped fix for the `feedback-triage-2026-09-08` contradiction bug: the stale `last_contact_bucket` line is omitted from the prompt whenever real `ContactFacts` exist.

### Changes Required

#### 1. Prompt-facts contract test

**File**: `tests/unit/ranking-prompt-facts.test.ts` (new)

**Intent**: Prove `buildRankingPrompt` omits the stale user-estimate line exactly when a real successful contact is on record, and includes it otherwise — a pure-function test, no fetch or Supabase stub needed.

**Contract**: Three cases against `buildRankingPrompt(profile, people, facts)`'s returned user-message content:
- A person with `last_contact_bucket` set and a `facts` entry whose `lastHappenedAt` is non-null → the built prompt does NOT contain "Szacunek użytkownika sprzed rejestrowania kontaktów" for that person.
- The same person with `last_contact_bucket` set and no `facts` entry at all → the prompt DOES contain that line (control).
- The same person with a `facts` entry present but `lastHappenedAt: null` (only failed attempts recorded, no success yet) → the prompt still contains that line, per `prompt.ts:150-155`'s stated rule that "no successful contact recorded" and "roughly half a year ago" are complementary, not contradictory (a real edge case the code comment names but nothing currently pins).

### Success Criteria

#### Automated Verification

- `npm test tests/unit/ranking-prompt-facts.test.ts` passes, all three cases green
- `npm run lint` passes
- `tsc --noEmit` passes

#### Manual Verification

- Temporarily revert the `prompt.ts:156` condition to unconditional inclusion and confirm the first test case goes red

---

## Phase 4: On-demand AI-native sanity judge script

### Overview

Builds the optional AI-native layer `test-plan.md` §3/§4 names for this phase: a script, run by a human when the prompt changes, that asks a judge model whether a small set of frozen fixtures' `reason` text is plausible and non-contradictory. Never gates CI or `npm test`.

### Changes Required

#### 1. Fixture set

**File**: `scripts/fixtures/ranking-judge/*.json` (new, 3 files)

**Intent**: Hand-authored, frozen `{profile, people, facts, modelOutput}` cases representative of what a judge should catch: (a) a fully-fabricated fallback entry that should read as generic/non-specific, (b) a floor-overridden entry whose `reason` was replaced by the code-authored recency-floor sentence, (c) a normal, plausible model-authored entry with no issues — the negative control.

#### 2. Judge script

**File**: `scripts/judge-ranking-fixtures.ts` (new)

**Intent**: Load each fixture, ask a judge model two yes/no-with-rationale questions — "does this `reason` contradict a fact in `facts`?" and "does this `reason` read as a genuine judgment rather than generic filler?" — and print a report. Follows `scripts/verify-ranking.ts`'s `assert()`/`failures[]`/non-zero-exit shape, but reads local fixture files instead of hitting a deployed URL, and its assertions are the judge's own yes/no answers rather than a hard runtime invariant.

**Contract**: Refuses to run without `OPENAI_API_KEY` set (mirrors `verify-*` scripts' precondition checks). Never invoked by `npm test`, `vitest.config.ts`, or any CI workflow — invoked only via the new `npm run judge:ranking` script (`tsx scripts/judge-ranking-fixtures.ts`, matching the existing `verify:*` naming and invocation pattern in `package.json`).

#### 3. Wire the npm script

**File**: `package.json`

**Intent**: Add `"judge:ranking": "tsx scripts/judge-ranking-fixtures.ts"` alongside the existing `verify:*` entries.

### Success Criteria

#### Automated Verification

- `npm run lint` passes (script and fixtures are valid TS/JSON)
- `tsc --noEmit` passes

#### Manual Verification

- `npm run judge:ranking` run once by hand against a real `OPENAI_API_KEY`, confirming it correctly flags fixture (a) as generic/non-specific and passes fixture (c) as plausible
- Confirm `npm test` and every CI workflow file remain untouched by this phase (`git diff --stat` shows no changes under `.github/workflows/`)

---

## Phase 5: Documentation

### Overview

Updates `test-plan.md` so a future reader finds the shipped pattern instead of "TBD," and sees the two risks this phase deliberately leaves untested named as accepted, not overlooked.

### Changes Required

#### 1. Cookbook pattern

**File**: `context/foundation/test-plan.md`, §6.5 "Adding a test around the AI boundary"

**Intent**: Replace the "TBD" placeholder with the actual shipped pattern: the fake-Supabase-plus-network-edge-fetch-stub technique (`tests/stubs/fake-ranking-supabase.ts`, `tests/stubs/openai-responses-fetch.ts`, worked example `tests/unit/ranking-terminal-states.test.ts`), the prompt-facts contract-test pattern (`tests/unit/ranking-prompt-facts.test.ts`), and a pointer to the on-demand judge script (`npm run judge:ranking`) with an explicit note that it never runs in CI.

#### 2. Negative-space additions

**File**: `context/foundation/test-plan.md`, §7 "What We Deliberately Don't Test"

**Intent**: Add two entries: tie-breaking for equal-weight people (LLM-prompt-only, `prompt.ts:60`, no deterministic test possible without a live call) and general run-to-run determinism outside the recency floor's 0–6-day band (`ranking-recency-floor` already declined to pin `temperature`/`seed` for the same unresolved-model-support reason; this phase reaffirms rather than reopens that decision). Each entry cites this phase as the source, per §7's existing citation convention.

#### 3. Freshness ledger and per-phase note

**File**: `context/foundation/test-plan.md`, §8 and §6.6

**Intent**: §8 gains a line noting §6.5 was filled in and §7 gained two entries, dated today. §6.6 gains a "Phase 3" entry naming the one genuinely surprising discovery this phase made: an OpenAI network-edge stubbing precedent (`tests/unit/ranking-key-source.test.ts`, delivered under S-17/`byok-openai-key`) already existed and superseded this phase's own research, which had concluded no such stub existed yet.

### Success Criteria

#### Automated Verification

- `npm run lint` passes (markdown/prose files are not linted, but this confirms no stray code fences break anything else)

#### Manual Verification

- A read-through of the updated §6.5/§7/§8 by the user confirms they read as intended

---

## Testing Strategy

### Unit Tests

- `tests/unit/ranking-terminal-states.test.ts` — every `runRanking` exit path (Phase 2)
- `tests/unit/ranking-prompt-facts.test.ts` — stale-bucket omission (Phase 3)
- `tests/unit/ranking-key-source.test.ts` — unchanged, refactored onto shared helpers (Phase 1)

### Integration Tests

None added this phase — the existing e2e layer (`tests/e2e/ranking-job-terminal-state.spec.ts`) already covers the client-side half of Risk #4, and the server-side half is proven at the unit layer via Phase 1's stubbing precedent, which is cheaper and sufficient per this phase's own scope decision.

### Manual Testing Steps

1. Run `npm test tests/unit` and confirm all new and existing tests pass.
2. Temporarily revert the Phase 2.1 guard, confirm the "zero people matched" test goes red, then restore it.
3. Temporarily revert the Phase 3 omission condition, confirm its test goes red, then restore it.
4. Run `npm run judge:ranking` once by hand against a real key and read its output.

## Performance Considerations

None — every new test runs in-process against fakes, with no network or database round-trip. The judge script makes real OpenAI calls but is never on any hot path or CI gate.

## Migration Notes

None — no schema or data changes.

## References

- Research: `context/changes/testing-ai-boundary-job-states/research.md`
- Existing stubbing precedent: `tests/unit/ranking-key-source.test.ts`, `tests/routes/openai-key.test.ts`
- Existing verification-script pattern: `scripts/verify-ranking.ts`
- Prior root-cause investigation: `context/archive/2026-09-08-ranking-recency-floor/research.md`
- Production bug report: `context/changes/feedback-triage-2026-09-08/triage.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract shared OpenAI test-stubbing helpers

#### Automated

- [x] 1.1 npm test tests/unit/ranking-key-source.test.ts passes with all three original tests unchanged — 8278213
- [x] 1.2 npm run lint passes — 8278213
- [x] 1.3 tsc --noEmit passes — 8278213

#### Manual

- [x] 1.4 Diff of ranking-key-source.test.ts shows only import changes and the one successResponse() call-site update — 8278213

> Note on 8278213: this phase's files (`tests/stubs/fake-ranking-supabase.ts`, `tests/stubs/openai-responses-fetch.ts`, the `ranking-key-source.test.ts` refactor) landed via a concurrent session's unrelated commit (`feat(byok-openai-key): marking a key that stopped working (p5)`), which independently needed the same extraction and found these files already on disk, uncommitted, from this phase's work. Its own commit message credits the concurrent origin. Content was verified byte-identical between what this phase wrote and what that commit captured — no work was lost or altered. No separate commit was made for this phase since the working tree held nothing left to stage.

### Phase 2: Reconciliation fix and terminal-state test coverage (Risks #3 and #4)

#### Automated

- [ ] 2.1 npm test tests/unit/ranking-terminal-states.test.ts passes, all six cases green
- [ ] 2.2 npm test tests/unit/ranking-key-source.test.ts still passes unchanged
- [ ] 2.3 npm run lint passes
- [ ] 2.4 tsc --noEmit passes

#### Manual

- [ ] 2.5 Reverting the Phase 2.1 guard makes the "zero people matched" test go red
- [ ] 2.6 wrangler tail (or local log) shows the new fallback-count segment on a real partial-fallback run

### Phase 3: Contradiction-of-fact contract test (Risk #3, narrow scope)

#### Automated

- [ ] 3.1 npm test tests/unit/ranking-prompt-facts.test.ts passes, all three cases green
- [ ] 3.2 npm run lint passes
- [ ] 3.3 tsc --noEmit passes

#### Manual

- [ ] 3.4 Reverting the prompt.ts:156 condition makes the first test case go red

### Phase 4: On-demand AI-native sanity judge script

#### Automated

- [ ] 4.1 npm run lint passes
- [ ] 4.2 tsc --noEmit passes

#### Manual

- [ ] 4.3 npm run judge:ranking run once by hand, correctly flags the generic fixture and passes the plausible one
- [ ] 4.4 npm test and every CI workflow file remain untouched by this phase

### Phase 5: Documentation

#### Automated

- [ ] 5.1 npm run lint passes

#### Manual

- [ ] 5.2 User read-through of updated §6.5/§7/§8 confirms they read as intended
