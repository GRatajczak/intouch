---
date: 2026-09-10T21:04:15+02:00
researcher: g.ratajczak97@gmail.com (Claude Code, Sonnet 5)
git_commit: aa0af08408a401f9a90f278b2bd33255c451a283
branch: main
repository: intouch
topic: "Test-plan Phase 3 — AI boundary contract and job terminal states (risks #3 and #4)"
tags: [research, codebase, testing, openai, ranking, zod, kv, polling, determinism]
status: complete
last_updated: 2026-09-10
last_updated_by: g.ratajczak97@gmail.com (Claude Code, Sonnet 5)
---

# Research: Test-plan Phase 3 — AI boundary contract and job terminal states

**Date**: 2026-09-10 21:04 CEST
**Researcher**: g.ratajczak97@gmail.com (Claude Code, Sonnet 5)
**Git Commit**: `aa0af08` (`aa0af08408a401f9a90f278b2bd33255c451a283`)
**Branch**: `main`
**Repository**: `intouch`

Working tree is dirty at research time (`.env.test`, `CLAUDE.md`, two `context/changes/*/plan.md`, `src/lib/openai.ts`, `context/foundation/test-plan.md` all modified — none of them touched by this research). References below are local paths, not GitHub permalinks, since the dirty tree makes commit-pinned line numbers unreliable for the files that are actually mid-edit; none of the files cited in this document are among the modified ones, so their line numbers are accurate against `HEAD`.

## Research Question

`context/foundation/test-plan.md` §3 Phase 3 ("AI boundary contract and job terminal states") wants: *bad provider output becomes a visible error instead of a rendered order, no job can strand the polling view, and a schema-valid response that contradicts a held fact — or drifts run-to-run on identical input — is caught rather than rendered as authoritative.* It covers:

- **Risk #3** — a malformed, partial or nonsense AI response renders as an authoritative hierarchy with no error, or a schema-valid response contradicts a fact the system already holds, or answers one unchanged input differently on each run.
- **Risk #4** — a deferred ranking job never reaches a terminal state and the view polls forever.

Before planning, this research grounds: where the AI response is actually validated and what happens on failure; the job's real state machine and where its terminal-state guarantees do and don't live; what test coverage already exists; and what prior implementation history (F-02, S-02, `ranking-recency-floor`, the `feedback-triage-2026-09-08` production bug) already decided or left open.

## Summary

**Risk #3 is confirmed and worse than the risk map implies.** The OpenAI call (`src/lib/ranking/run.ts:199-206`) is schema-validated via `zodTextFormat(rankingOutputSchema)` — shape only. A **total parse failure has a correct, tested-by-nobody-but-working error path** (throws → `writeJob(status:"failed")` → UI shows an error banner). But a **schema-valid response with an empty or fully-hallucinated `entries` array has no error path at all**: `reconcileEntries` (`run.ts:73-115`) silently fabricates a full-strength, code-authored entry for every person the model failed to address, persists it, and marks the job `"done"` — indistinguishable in the UI from a genuine model ranking. This is Risk #3's core scenario, verified as currently unmitigated. Separately, the exact production bug the risk map cites (`feedback-triage-2026-09-08`, "last contact today" vs "2–6 months ago" on one card) has a confirmed three-cause root: (a) a stale `last_contact_bucket` field fed to the prompt alongside fresh facts, (b) an unreconciled weight-vs-freshness prompt-instruction conflict, (c) no determinism controls on the model call. `ranking-recency-floor` (2026-09-08) closed (a) and (b) and added a **one-directional, narrow-band deterministic floor** (`src/lib/ranking/recency-floor.ts`) — but explicitly, deliberately left (c) open: no `temperature`/`top_p`/`seed` is pinned, so **outside the floor's band, run-to-run non-determinism is a live, undecided risk**, not a closed one.

**Risk #4 is confirmed but already half-mitigated by a layer this rollout phase does not own.** `AiJob.status` (`src/lib/ai-jobs.ts:10-16`) has exactly three states — `pending | done | failed` — no `expired`, no server-side sweep, no compare-and-swap. A stuck `pending` job has no server-side path to a terminal state; it sits until a 1-hour KV TTL silently deletes the key (storage hygiene, not a state transition). The **only** terminal-state guarantee is client-side: `HierarchyView.tsx`'s poller gives up after `MAX_POLL_ATTEMPTS(60) × POLL_INTERVAL_MS(2000)` = 120s and forces its own local `"failed"` state — a client illusion of termination, not proof the job itself terminated. Critically: **`tests/e2e/ranking-job-terminal-state.spec.ts` already covers exactly this** (both the `"failed"` case and the "never-settles, 120s bound" case, using Playwright's `page.clock`), landed via the already-shipped, already-archived `e2e-browser-layer` change. What that spec does **not** cover, and what has zero test coverage anywhere in the repo: the server side of the state machine — `runRanking`'s own per-branch `writeJob` calls, `/api/rankings`'s route logic (`400 Missing jobId`, `404 Unknown jobId` for an expired/unknown job, the KV in-flight-guard race explicitly accepted as "duplicate jobs, never corruption" at `rankings.ts:46-56`). This reframes Phase 3's actual remaining scope for Risk #4: not a duplicate of the client-side e2e test, but a **server-side integration test** of the job-state machine.

No network-edge OpenAI stub exists yet (only `tests/stubs/cloudflare-workers.ts`, which stubs the KV binding, not the model call) — Phase 3 must build one, matching the test plan's own stated intent (§4: "provider stubbing: none yet — see Phase 3").

## Detailed Findings

### A. The AI response validation boundary (Risk #3)

**Call site** — `src/lib/openai.ts:9-15` builds the client (`createOpenAIClient`, returns `null` with no key — a job-level `failed`, not a global 500). The actual call:

```
src/lib/ranking/run.ts:199-206
const response = await openai.responses.parse(
  { model: RANKING_MODEL, input: messages, text: { format: zodTextFormat(rankingOutputSchema, "ranking") } },
  { maxRetries: 0 },
);
```

`RANKING_MODEL = "gpt-5.4-mini"` (`run.ts:18`). Input is built by `buildRankingPrompt` (`src/lib/ranking/prompt.ts:179-202`) from `profile`, `people`, and per-person `ContactFacts`.

**Schema** — `src/lib/validation/ranking.ts:27-38`:

```ts
const entrySchema = z.object({
  personId: z.string(),
  timeWindow: z.enum(TIME_WINDOW_VALUES),
  reason: z.string(),
  contextNote: z.string().nullable(),
  rhythmNote: z.string().nullable(),
});
export const rankingOutputSchema = z.object({ entries: z.array(entrySchema) });
```

`.nullable()` (not `.optional()`) is required by OpenAI strict mode — every property must appear in `required`. Enforced via `zodTextFormat` (constrained decoding), not a manual post-hoc check. Nothing in this schema requires `entries` to be non-empty, and nothing checks that `reason`/`contextNote`/`rhythmNote` content is truthful.

**Two distinct failure classes, only one has an error path:**

1. **Total parse failure** — `response.output_parsed` is falsy → `run.ts:208-211` throws `"OpenAI response had no parsed output"`. The outer `catch` (`run.ts:264-269`) classifies it (`classifyRankingError`, `run.ts:127-137`) and writes `writeJob(jobId, {status:"failed", error: message})`. `HierarchyView.tsx:133-136` renders the `RefreshBanner` failed state. **Correct, matches the risk-map expectation.**

2. **Schema-valid but empty or fully-mismatched `entries`** — `reconcileEntries` (`run.ts:73-115`) first-pass matches real model entries by `personId` (dropping hallucinated ids, per the doc-comment at `run.ts:61-64`: *"`responses.parse()` only validates shape, never referential integrity"*), then its **fallback loop unconditionally fabricates** a full entry for every person left unmatched:
   ```
   run.ts:101-112
   const fallbackTimeWindow: TimeWindow = "no_rush";
   for (const person of peopleSent) {
     if (!seen.has(person.id)) {
       reconciled.push({ personId: person.id, timeWindow: fallbackTimeWindow,
         reason: "Nie udało się wygenerować uzasadnienia dla tej osoby w tym przebiegu.",
         contextNote: null, rhythmNote: null });
     }
   }
   ```
   This persists via `persistRanking` (`store.ts:105-141`) exactly like genuine output, `writeJob(jobId, {status:"done", rankingId})` fires (`run.ts:223`), and **nothing in `RankingViewModel`/`RankingEntryViewModel` (`store.ts:9-26`) flags a fallback-authored entry** — `HierarchyCard.tsx` cannot render it any differently even in principle. **This is Risk #3's exact scenario, confirmed live and unmitigated.** No log even counts how many entries were fallback-authored (`run.ts:260-262` logs only `flooredCount`).

**Time window per entry (Risk Response Guidance cell "every rendered entry carries a suggested time window")** — structurally always true (`TimeWindow` is required at every layer: schema, fallback, `RankingEntryViewModel`, `HierarchyCard.tsx:24-25`), but as shown above, that guarantee can be a **code-fabricated placeholder** (`"no_rush"`) with no visual distinction from a model-authored window.

**Tie-breaking for equal weight** — **no code-level mechanism.** Purely a prompt instruction: `prompt.ts:60` — *"Gdy dwie osoby mają tę samą wagę, rozstrzygnij kolejność na podstawie kontekstu z ich opisów — nigdy losowo ani dowolnie…"* — unenforced and unverified by any code. `sortByUrgency` (`recency-floor.ts:127-129`) explicitly preserves "the model's order within one window," it does not re-derive from weight.

**Contradiction-of-fact check** — **no code-level check exists today.** This is precisely the class of bug in `feedback-triage-2026-09-08` (see Historical Context, §D below): a frozen `reason` string quoting a stale fact next to a live, correct `ContactChips` render on the same card. Partially closed (the specific stale-input cause), not generally solved (no runtime check that `reason`/`contextNote`/`rhythmNote` content agrees with `ContactFacts` — the constraint remains prompt-only, `prompt.ts:62`: *"opieraj się WYŁĄCZNIE na faktach"*).

**Determinism** — **no controls set.** `run.ts:199-206`'s call passes only `model`, `input`, `text.format`; `maxRetries: 0` only suppresses SDK retry-on-429, unrelated to output stability. Grep for `temperature`/`top_p`/`seed`/`reasoning` across `src/lib/ranking/` and `src/lib/openai.ts`: nothing. The only stabilizing mechanism is `applyRecencyFloor` (`recency-floor.ts`), which narrows `timeWindow`'s *range* within a specific low-days-since-contact band — it does not touch `reason` prose or `rank_position` ordering outside that band. Confirmed by `ranking-recency-floor`'s own archived research: *"Pinning is the only guarantee of repeatability… \[rejected]"* and *"seed doesn't exist in the Responses API."*

**Rendering** — `src/pages/dashboard.astro` loads via `loadLatestRanking`/`isStale` (`store.ts:51-97`) and branches to `HierarchyEmptyState` or `HierarchyView`. `HierarchyView.tsx` owns `status: "fresh"|"refreshing"|"failed"` and always renders the full `HierarchyCard` list once a ranking exists (`:242-270`), with no distinction between genuine and fallback-authored content. `HierarchyCard.tsx:100-101` prints `entry.reason` verbatim with no cross-check against `facts` (which only feeds the separately-rendered, live `ContactChips` — the exact juxtaposition that produced the reported bug).

### B. The job terminal-state machine (Risk #4)

**States** — `src/lib/ai-jobs.ts:10-16`:

```ts
export interface AiJob {
  status: "pending" | "done" | "failed";
  result?: string;
  error?: string;
  rankingId?: string;
}
```

Only three states. No `"expired"`, no `"running"`. A job the Worker never updates (e.g. `waitUntil` unavailable — explicitly warned at `src/pages/api/rankings.ts:74-78`: `console.warn("[ranking] job ${jobId}: no cfContext, background completion is not guaranteed")`) stays `pending` in KV until TTL deletion.

**Storage** — `src/lib/ai-jobs.ts` (binding `AI_JOBS: KVNamespace`, read via `cloudflare:workers` per the repo's documented convention). `JOB_TTL_SECONDS = 3600` (`:8`), applied to every `put` (`:23`). This is **storage hygiene, not a terminal-state mechanism**: after 1h the key vanishes and a poll gets `404 "Unknown jobId"` rather than any explicit expired/terminal status — and the client's poller already gives up at 120s, long before the hour elapses, so the TTL branch is effectively unreachable from the current polling flow. An additional in-flight-guard key (`ranking-latest:${ownerId}`, `:32-42`) dedupes concurrent dispatches; the route comment (`rankings.ts:46-56`) explicitly accepts a residual no-compare-and-swap race here as "duplicate jobs, never corruption."

**Polling endpoint** — `src/pages/api/rankings.ts:84-113` (`GET`): `pending`/`failed` → 200 with the job body as-is (failed is never a non-2xx); unknown/expired jobId → `404 {"error":"Unknown jobId"}`; `done` → 200 with `{...job, ranking}`.

**Frontend poller** — `HierarchyView.tsx:16-17`: `POLL_INTERVAL_MS = 2000`, `MAX_POLL_ATTEMPTS = 60` (120s total, sized to KV's documented eventual-consistency window). `pollJob` (`:104-153`): `done`/`failed` clear the interval and set the matching UI status; anything else (`pending`, or a 404/error body that matches neither) falls through to an attempt-count check — at 60 attempts, or on a fetch exception, it force-sets `status:"failed"` locally. **This is the entire terminal-state guarantee that exists today, and it is a client-side illusion**: the KV record may still say `pending` (or have since completed) after the UI has already declared failure and stopped polling.

**Clock** — no injected/mockable clock anywhere server-side. `runRanking` and `isStale()` both call `Date.now()` directly (`run.ts:160,225`; `store.ts:96`). The frontend poller uses a native `setInterval`. The existing e2e spec controls **only the browser's clock** (`page.clock.install()`/`runFor()`), not KV TTL or any server-side timer.

**Existing coverage** — `tests/e2e/ranking-job-terminal-state.spec.ts` (two tests): a mocked `failed` response renders the error state; a permanently-`pending` mock, fast-forwarded past 120s via `page.clock`, reaches the same error state and (crucially) proves polling actually halts. This is a real, working test of the **client-side** half of Risk #4. It does not, and structurally cannot (it mocks `/api/rankings` at the browser boundary), touch: the `404 Unknown jobId` branch, `runRanking`'s own per-branch `writeJob` calls, the `POST` handler's `400`/in-flight-guard logic, or any assertion that a truly-stuck server-side job is ever itself marked non-`pending`. **No `tests/routes/rankings.test.ts` exists at all** — confirmed by directory listing.

### C. Existing test coverage — full picture

Confirmed via full `tests/` sweep (24 files checked, only these touch this surface even tangentially):

| File | Covers | Does NOT cover (re: Risk #3/#4) |
|---|---|---|
| `tests/unit/recency-floor.test.ts` | `applyRecencyFloor` threshold table, `buildRecencyFloorReason`, `sortByUrgency` (window-based sort, stable, non-mutating) | The AI call, `rankingOutputSchema`, `reconcileEntries`, tie-break for equal weight, contradiction check, cross-run determinism — assumes a valid ranking already exists |
| `tests/unit/reminder-select.test.ts` | Hero/queue selection over an already-built `RankingViewModel` | Same — consumes a valid ranking, never produces one |
| `tests/routes/erasure.test.ts` | Risk #2 (erasure); imports `loadRankingPeople` only as an oracle for "deactivated person excluded from ranking input" | Explicitly avoids `runRanking`/the AI boundary — its own comment says `runRanking` "cannot be the oracle here because it needs a live OpenAI client" |
| `tests/e2e/ranking-job-terminal-state.spec.ts` | Risk #4's client-side polling bound (`failed`, never-settles) | Server-side state machine (see §B); the `404`/expired-jobId case |
| `tests/e2e/auth-gate.spec.ts`, `auth.setup.ts` | Abort `/api/rankings` as a cost guard only | Nothing about ranking content or job state — the call is aborted, not asserted on |
| `tests/stubs/cloudflare-workers.ts` | In-memory KV stub for `AI_JOBS` (ignores `expirationTtl` on purpose — vendor behavior, not ours to test) | Not an OpenAI/provider stub — no equivalent exists for the model call |

**Zero component tests exist anywhere in the repo** (no `.test.tsx` files, no `@testing-library` dependency) — `HierarchyCard`/`HierarchyView` have no test at any layer below e2e.

**Confirmed: no network-edge OpenAI stub exists.** `vitest.config.ts` has no alias/mock for the `openai` package or `src/lib/openai.ts`. Building one (aliasing/mocking the SDK client the way `cloudflare:workers` is aliased) is unstarted work for this phase, matching test-plan.md §4's own "none yet — see Phase 3" entry.

## Code References

- `src/lib/openai.ts:9-15` — client construction, null on missing key
- `src/lib/ranking/run.ts:155-270` — `runRanking` orchestrator
- `src/lib/ranking/run.ts:199-206` — the `responses.parse()` call site
- `src/lib/ranking/run.ts:208-211` — total-parse-failure throw (has an error path)
- `src/lib/ranking/run.ts:61-115` — `reconcileEntries`, including the silent fallback loop (`101-112`) with no error path
- `src/lib/ranking/run.ts:127-137` — `classifyRankingError`
- `src/lib/ranking/run.ts:223`, `:267` — the two `writeJob` terminal writes (`done`, `failed`)
- `src/lib/ranking/prompt.ts:59-64` — weight-vs-freshness instruction hierarchy
- `src/lib/ranking/prompt.ts:60` — unenforced tie-break-by-context instruction
- `src/lib/ranking/prompt.ts:156-159` — conditional omission of stale `last_contact_bucket`
- `src/lib/validation/ranking.ts:10-11,27-38` — `TimeWindow` enum, `rankingOutputSchema`
- `src/lib/ranking/recency-floor.ts` — `applyRecencyFloor`, `sortByUrgency`, `buildRecencyFloorReason`
- `src/lib/ranking/store.ts:7` — `STALE_AFTER_MS` (24h)
- `src/lib/ranking/store.ts:9-26` — `RankingViewModel`/`RankingEntryViewModel` (no fallback-flag field)
- `src/lib/ranking/store.ts:51-97` — `loadLatestRanking`, `isStale`
- `src/lib/ai-jobs.ts:1-42` — `AiJob` type, `JOB_TTL_SECONDS`, `readJob`/`writeJob`, in-flight-guard pointer
- `src/pages/api/rankings.ts:46-56` — accepted KV race comment
- `src/pages/api/rankings.ts:65-67` — job creation (`POST`)
- `src/pages/api/rankings.ts:74-78` — `waitUntil`-unavailable warning
- `src/pages/api/rankings.ts:84-113` — polling `GET` handler
- `src/components/hierarchy/HierarchyView/HierarchyView.tsx:16-17` — poll constants
- `src/components/hierarchy/HierarchyView/HierarchyView.tsx:104-153` — `pollJob`
- `src/components/hierarchy/HierarchyView/HierarchyView.tsx:213-270` — render branches by status
- `src/components/hierarchy/HierarchyCard/HierarchyCard.tsx:24-25,100-131` — time-window styling, `reason` render, `ContactChips` juxtaposition
- `src/components/hierarchy/RefreshBanner.tsx:27-76` — failed/fresh banner states
- `tests/e2e/ranking-job-terminal-state.spec.ts` — the one existing Risk #4 test
- `tests/stubs/cloudflare-workers.ts` — the only existing "stub at the network edge" precedent (KV, not OpenAI)
- `vitest.config.ts` — confirms `tests/unit/**/*.test.ts` is included, no OpenAI mock wired

## Architecture Insights

- **This repo already has a working precedent for "schema validation is not the same as correctness."** `reconcileEntries`'s own doc-comment states the boundary explicitly: shape-valid ≠ referentially valid. Risk #3's job is to extend that same discipline one layer further — shape-valid ≠ content-valid (non-empty, non-fabricated, non-contradictory) — which the current code does not yet do.
- **The recency floor is the first and only place code overrides model content**, a deliberate, documented departure from an earlier stated principle ("nothing about the order is computed in code," `context/archive/2026-09-02-did-it-happen-feedback-loop/plan.md:130-133`). It sets precedent for how a Phase 3 test's oracle should be framed: not "does the floor exist" (already tested in `recency-floor.test.ts`) but "is the floor's output what a fixture-driven contract test expects, independent of the model."
- **Risk #4's client-side half is already shipped and tested** via the archived `e2e-browser-layer` change — Phase 3 inherits that work rather than duplicating it. The real remaining gap is server-side and layer-appropriate for Vitest integration (reusing `tests/stubs/cloudflare-workers.ts`), not a second browser spec.
- **No fixture/fact factory exists yet** for `Tables<"people">`/`ContactFacts` (per the ranking-recency-floor research notes) — a Phase 3 fixture-based contract test for Risk #3 will need to build this, not just the OpenAI stub.

## Historical Context (from prior changes)

- `context/archive/2026-08-26-openai-ranking-call-path/` (F-02) — established the async job shape (`202` + `jobId`, `pending|done|failed`, `waitUntil`), the 1h KV TTL ("a job status is worthless an hour later"), and left response validation entirely out of scope (fixed trivial prompt, no structured output yet).
- `context/archive/2026-09-01-ai-contact-hierarchy/` (S-02) — introduced `zodTextFormat`/`rankingOutputSchema` and `reconcileEntries`, **explicitly scoped to id-existence only**: *"`responses.parse()` validates shape, never referential integrity."* Also decided: a failed run never overwrites a previously stored ranking — failure is job-level, not content-level. `OPENAI_API_KEY` stays optional by design (missing key degrades to one job's `failed`, not a global 500).
- `context/changes/feedback-triage-2026-09-08/triage.md` — the production bug the risk map cites. **Confirmed three-cause root, not one**: (a) stale `last_contact_bucket` fed to the prompt unconditionally alongside fresh facts (the literal, screenshot-confirmed cause — the model quoted the stale field verbatim); (b) an unreconciled weight-primacy vs. freshness prompt-instruction conflict (an artifact of S-03 adding a competing clause without touching S-02's original wording); (c) no determinism controls, independently confirmed by the tester's own three-recompute, three-different-answers report. The test-plan's Risk #3 wording ("schema-valid response contradicts a fact… or drifts run-to-run") **correctly and precisely** maps to (a)+(b) and (c) respectively — this is not a caching or race-condition bug.
- `context/archive/2026-09-08-ranking-recency-floor/` — closed (a) and (b): stale bucket now conditionally omitted (`prompt.ts:156-159`), prompt hierarchy rewritten. Added the deterministic floor, narrow-banded (0–2 days → `no_rush`, 3–6 → `this_month`, ≥7 unconstrained). **Explicitly declined to pin `temperature`/`top_p`/`seed`** — left as open, unresolved risk ("Nierozstrzygnięte przez typy i dokumentację. Wymaga jednego żywego wywołania" — never resolved because pinning was rejected as the strategy). Also explicitly a non-goal: the floor only ever *quiets* urgency, never raises it — no reverse-floor exists for a person who's gone quiet and has a low weight.
- `context/foundation/roadmap.md` — three items relevant to Risk #3 are **explicitly parked**, not implemented: `F-3 stale-reason-marking` (no code marks a ranking's frozen `reason` as stale relative to a newer `contact_event` — `HierarchyView.tsx:66-75`'s `applyFactsUpdate` only sets a banner flag, never touches `entry.reason`), `F-4 ranking-observability` (no snapshot of the facts the model actually saw is persisted per entry — nothing in `supabase/migrations/` carries this), `F-5 ranking-invalidation-on-mark` (marking a contact does not invalidate a stored ranking; only the flat 24h `STALE_AFTER_MS` or an explicit recompute does).
- `context/foundation/prd.md:79-89` — US-01's exact acceptance criteria: equal-weight people "are not treated identically" (context-based tie-break required); every entry "shows a suggested time window"; a user with no people gets an empty state, not an error; the hierarchy "takes into account time since the last (un)successful contact" (this fourth criterion was explicitly out of scope for S-02, only closed by S-03 + `ranking-recency-floor`).
- `context/foundation/test-plan.md:331-332` (§7) — already documents *why* Risk #3 is excluded from the e2e layer: the OpenAI call runs server-side inside `runRanking()` behind `waitUntil`, unreachable from a browser route mock. Confirms Phase 3's contract-layer test is the *only* place Risk #3 can be tested at all.

## Related Research

- `context/archive/2026-09-08-ranking-recency-floor/research.md` — the root-cause investigation this research's Historical Context section draws on directly; its own "open questions" section is the source for the still-unresolved determinism gap.
- `context/changes/feedback-triage-2026-09-08/triage.md` — production bug report and three-cause diagnosis.
- `context/archive/2026-09-10-e2e-browser-layer/` — delivered the existing `ranking-job-terminal-state.spec.ts`; establishes the "browser mock cannot reach `runRanking`" boundary this research reconfirms.

## Test Plan Corrections (for `/10x-test-plan` backport check)

No hot-spot anchor corrections — `src/components/hierarchy/` and `src/lib/ranking/` (cited in §2 as likelihood evidence) are exactly where the relevant code lives. No risk is speculative — both #3 and #4 are confirmed, live, and #3's headline scenario (empty/hallucinated response → silent fallback rendered as authoritative) is worse than a hypothetical: it is the current, unmitigated behavior of shipped code. Two **response-guidance corrections** worth backporting into §2's Risk Response Guidance table:

1. **Risk #3 "Must challenge" cell** currently reads "an empty array means there is nobody to contact." The actual code does not even reach that assumption — it never treats an empty/mismatched array as "nobody to contact" at all; it silently fabricates a full-strength entry per person and calls the job `"done"`. Recommend rewording to: *"a schema-valid response with a short, empty, or ID-mismatched `entries` array cannot happen, so post-parse validation only needs to check top-level shape"* — this is the assumption the current code actually makes, and the one a fixture test must refute.
2. **Risk #4 "Likely cheapest layer" cell** currently reads "integration with an injected clock." That work already shipped and is archived (`tests/e2e/ranking-job-terminal-state.spec.ts`, via `e2e-browser-layer`) — it covers the client-side half of Risk #4 completely. What remains unbuilt and belongs to *this* phase is a **Vitest integration test of the server-side job-state machine** (`runRanking`'s per-branch `writeJob` calls, `/api/rankings`'s `400`/`404`/in-flight-guard branches), reusing the existing `tests/stubs/cloudflare-workers.ts` KV stub — not a second browser-clock test. Recommend rewording the cell to name this split explicitly so `/10x-plan` doesn't propose duplicating the e2e spec.

## Open Questions

- **Determinism outside the recency floor's band is a genuine, unresolved product gap, not just a test gap.** A fixture-based contract test can prove the floor's narrow band is deterministic, but it cannot prove (or disprove) general run-to-run stability without a live OpenAI call — which the test plan's own stack notes forbid ("no live provider call"). `/10x-plan` should decide explicitly whether Phase 3 documents this as a **known, accepted limitation** (the floor is the only guarantee that exists; anything the floor doesn't cover is out of this phase's reach) rather than silently under-covering it.
- **Should a fallback-authored entry be flagged at all** (a `source: "model" | "fallback"` field, even if not surfaced in the UI yet)? Not required by any of the two risks' "what would prove protection" cells as written, but it's the cheapest structural fix that would make Risk #3's silent-fallback scenario observable in logs/tests without waiting for a UI change — worth raising to the user/`/10x-plan` as a scope question, not assumed.
- **Whether `gpt-5.4-mini` accepts a `temperature` parameter at all was never verified with a live call** (per `ranking-recency-floor`'s own open questions) — if `/10x-plan` considers proposing determinism controls as part of this phase (out of scope per the risk response guidance's fixture-only layer, but worth naming so it isn't silently assumed impossible), that verification is still outstanding.
