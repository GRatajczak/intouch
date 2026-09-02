<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Contact Hierarchy Implementation Plan

- **Plan**: context/changes/ai-contact-hierarchy/plan.md
- **Scope**: Phase 4 of 4 (full plan)
- **Date**: 2026-09-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — TOCTOU race in the KV-based in-flight job guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/rankings.ts:39-55
- **Detail**: The in-flight guard is a read-then-write against Cloudflare KV, which has no compare-and-swap. Two concurrent `POST /api/rankings` requests (two open tabs, or the mount-triggered auto-refresh racing a fast manual click before the button disables) can both execute `readLatestRankingJobId` → `readJob` before either has written its own job, both see "no pending job," and both dispatch separate `runRanking` calls. Result: duplicate OpenAI spend and two `rankings` rows for the same trigger, with the earlier one silently outranked by `created_at desc` — not data corruption, but it defeats the guard's stated purpose ("a double page load ... must not fire two concurrent OpenAI calls").
- **Fix A ⭐ Recommended**: Document the residual race as a known, accepted MVP limitation (a comment on the guard explaining KV has no CAS and the actual damage is bounded — duplicate spend, one orphaned row, no data corruption, no cross-user leak).
  - Strength: Zero code risk; correctly scoped to what KV can actually guarantee. Matches this project's own stated posture (`main_goal: speed` in roadmap.md, and F-02's own scope note accepting the SDK's default retry/backoff rather than building more).
  - Tradeoff: The race remains theoretically exploitable — occasional duplicate OpenAI spend is possible under real concurrent use.
  - Confidence: HIGH — a real fix needs a different primitive entirely (a Durable Object or a DB-level advisory lock), which is out of scope for this slice and not something F-02's foundation provides.
  - Blind spot: Haven't measured how often two tabs or a fast double-click would actually collide in practice.
- **Fix B**: Narrow (not eliminate) the window by writing the job pointer to KV as the very first operation, before checking for an existing in-flight job.
  - Strength: Reduces the race window in the common case (page-load double-fire).
  - Tradeoff: Added complexity for a guarantee that's still not airtight — KV's eventual consistency means even this narrower window isn't a real fix.
  - Confidence: MEDIUM — helps but doesn't close the fundamental gap.
  - Blind spot: Not load-tested to confirm it measurably reduces collisions.
- **Decision**: FIXED via Fix A — documented as an accepted MVP limitation with a comment in src/pages/api/rankings.ts

### F2 — verify-ranking.ts asserts against the wrong count

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/verify-ranking.ts:171-173
- **Detail**: `assert(ranking.entries.length === ranking.peopleTotal, ...)` assumes every person on the account gets an entry, but `src/lib/ranking/prompt.ts`'s `PEOPLE_CAP = 50` and `run.ts`'s `reconcileEntries` only guarantee one entry per person **sent** to the model (`peopleConsidered`), not per person on the account (`peopleTotal`). For any verified account with more than 50 people this assertion would fail even though the ranking behaved correctly by design — the UI's own `RefreshBanner.tsx:39` already treats `peopleConsidered < peopleTotal` as a legitimate, expected state.
- **Fix**: Change the assertion to compare `entries.length === ranking.peopleConsidered` instead of `peopleTotal`.
- **Decision**: FIXED — scripts/verify-ranking.ts:171-174 now compares against `peopleConsidered`

### F3 — pollJob doesn't clear a pre-existing interval before starting a new one

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/hierarchy/HierarchyView/HierarchyView.tsx:69-108
- **Detail**: `pollJob` starts a new `setInterval` and overwrites `pollTimerRef.current` without clearing whatever was already stored there. Currently unreachable through the UI — `RefreshBanner`'s button is `disabled` while `status === "refreshing"`, and the mount effect only fires once — but `pollJob` itself has no defensive guard, so a future code path that calls it twice would leak the earlier interval (it keeps firing `fetch` every 2s for up to 120s with no way to stop it early).
- **Fix**: Add `if (pollTimerRef.current) clearInterval(pollTimerRef.current);` at the top of `pollJob`, before starting the new interval.
- **Decision**: FIXED — guard added to src/components/hierarchy/HierarchyView/HierarchyView.tsx:69-74

### F4 — GET /api/rankings has no per-job ownership check

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/rankings.ts:76-105
- **Detail**: `GET` looks up `jobId` from KV with no check that the job belongs to the caller — the same posture as `ai-ping.ts`, which it's explicitly modeled on (comment at lines 100-102 states this deliberately). Practical exposure is low: job ids are random UUIDs, and the ranking payload itself is always scoped to `context.locals.user.id` via RLS regardless of whose jobId was polled — an attacker who guesses another user's jobId can at most learn that job's status and, on failure, a generic error string with no PII (`"No profile found for this account"`, `"OPENAI_API_KEY is not configured"`).
- **Fix**: No code change needed — this is a deliberate, correctly-scoped carry-forward of an accepted existing pattern, not an oversight.
- **Decision**: SKIPPED — acknowledged as deliberate, matches ai-ping.ts precedent

### F5 — astro.config.mjs comment is now stale

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: astro.config.mjs:27
- **Detail**: The comment on `OPENAI_API_KEY` still reads "Optional until S-02 depends on it." S-02 (this slice) now depends on it, but the key is still correctly `optional: true` for the reason `plan.md`'s "Why the API key stays optional" section gives (a missing secret should fail one screen's job, not the whole Worker) — the comment just reads as if S-02 hasn't happened yet.
- **Fix**: Update the comment to state the key stays optional by design even though S-02 now depends on it, referencing the "fail one screen, not the Worker" reasoning.
- **Decision**: FIXED — astro.config.mjs:27-30 updated
