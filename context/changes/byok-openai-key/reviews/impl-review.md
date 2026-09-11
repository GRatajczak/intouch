<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Bring-your-own OpenAI key + a daily cap on manual recomputes

- **Plan**: context/changes/byok-openai-key/plan.md
- **Scope**: Full plan (Phases 1–6)
- **Date**: 2026-09-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — DELETE /api/settings/openai-key leaves a stale key-health mark

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/settings/openai-key.ts:117-120 (DELETE handler)
- **Detail**: POST's save path clears `openai_api_key_failed_at`/`openai_api_key_failure_reason` alongside the ciphertext (lines 84-91), but DELETE only nulls `openai_api_key_ciphertext`/`openai_api_key_hint`. Currently harmless — `ApiKeySection` only renders `failure` inside the "key stored" branch, so a key-less row's stale mark is invisible today — but it is a real data-integrity gap: removing a key does not fully reset its row, and any future read of those columns (an admin view, a different UI branch) could misreport a removed key as still failing.
- **Fix**: Add `openai_api_key_failed_at: null, openai_api_key_failure_reason: null` to DELETE's update payload, mirroring POST's save path.
- **Decision**: FIXED

### F2 — No cross-owner test for the DELETE handler

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/routes/openai-key.test.ts:183-204
- **Detail**: The established convention in this test layer (`reminders-toggle.test.ts`, `delete-data.test.ts`, and this same file's own POST tests at lines 113-128) verifies an owner filter via the A-session/B-identity mismatch instrument. DELETE's `.eq("owner_id", user.id)` guard — the same shape of filter the POST test explicitly instruments — has no such test; DELETE is only covered for "anonymous caller" and "clears the caller's own key".
- **Fix**: Add a DELETE cross-owner test mirroring the existing POST one (A's session, B's identity in `locals.user`), asserting neither owner's row is touched.
- **Decision**: FIXED (verified it goes red when the owner filter is removed, then restored)

### F3 — OpenAI validation runs before the Supabase-configured check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/settings/openai-key.ts:52-76
- **Detail**: `reminders.ts` (the established sibling route) checks `createClient(...)` right after body validation, before any further work. `openai-key.ts`'s POST instead spends the billable, rate-limited `probe.models.list()` call first and only builds the Supabase client afterward — so a misconfigured-Supabase environment burns an OpenAI call for a request that could never have been saved anyway.
- **Fix**: Move the `createClient` / null-check ahead of the `probe.models.list()` call, matching `reminders.ts`'s ordering.
- **Decision**: FIXED

### F4 — No CHECK constraint on `openai_api_key_failure_reason`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260911151726_add_profiles_openai_key_health.sql:15-17
- **Detail**: The column is documented (comment) and only ever written as `"auth" | "quota" | null` by application code, but the database column is unconstrained `text`. A future bug or manual edit could write an arbitrary string that `settings.astro`'s ternary would then silently treat as "no failure" (neither `"auth"` nor `"quota"` matches, so `apiKeyFailure` resolves to `null`) — a silent-data-drift risk, not a security hole.
- **Fix**: A new additive migration adding `check (openai_api_key_failure_reason is null or openai_api_key_failure_reason in ('auth', 'quota'))` — a fresh migration, not an edit to the shipped one, since it is already applied locally and pushed to stage.
- **Decision**: FIXED — `supabase/migrations/20260911155533_add_profiles_openai_key_failure_reason_check.sql`, applied locally and pushed to stage

### F5 — tests/stubs/ files outside the plan's file list

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: tests/stubs/fake-ranking-supabase.ts, tests/stubs/openai-responses-fetch.ts
- **Detail**: Neither file appears in the plan's file lists, yet both were committed in Phase 5 (`8278213`). Provenance, independently verified: Phase 2's commit (`e3f2d42`) shipped `tests/unit/ranking-key-source.test.ts` with inline fixtures. A concurrent, unrelated session later refactored that same file in the working tree to import from these two new shared stub files — without committing either the refactor or the new files. Phase 5's own tests needed `.update()` support and the two new profile columns added to `fake-ranking-supabase.ts`'s default row, so leaving the stubs uncommitted would have left the repo inconsistent for any other checkout. The deviation was disclosed in the Phase 5 commit message rather than absorbed silently.
- **Fix**: No code change — this is a documented, already-accepted judgment call (confirmed with the user mid-implementation) rather than a defect. Recorded here so the plan's own file list is known to be incomplete against what actually shipped.
- **Decision**: SKIPPED — already accepted mid-implementation, no action needed

### F6 — `.env.test` commits the repo's first cryptographic key material

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .env.test:35
- **Detail**: A throwaway AES-256 key (`openssl rand -base64 32`) is committed for the test suite, consistent with this file's pre-existing, well-documented pattern of committing local/test-only constants (the Supabase demo anon/service-role JWTs) with an explicit "never point this file at a hosted project" rule. Not a genuine risk — flagged only because it is the first committed cryptographic key material in this repo, worth a second pair of eyes.
- **Fix**: None needed.
- **Decision**: SKIPPED — matches existing convention, no risk

## Automated success criteria (re-run at review time)

- `npm test` — 267 passed, 14 skipped, 0 failed
- `npx astro check` — 0 errors, 0 warnings, 4 hints
- `npm run lint` — 0 errors, 115 warnings (all pre-existing `no-console`, none new)
- `npm run build` — succeeds

## Manual success criteria

All 24 manual verification items across Phases 1–6 are marked `[x]` in `plan.md`'s Progress section, each confirmed by the user in this session via explicit AskUserQuestion confirmation before being checked off — no rubber-stamping.
