<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Migrations, default-deny RLS, and a proof of per-user data isolation

- **Plan**: context/changes/per-user-data-isolation/plan.md
- **Scope**: Phase 3 of 3 (full plan)
- **Date**: 2026-08-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Isolation-negative assertions in verify-rls.ts don't check for query errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/verify-rls.ts:95-96, 115-116 (also 92-93, 112-113 for consistency)
- **Detail**: `crossSelectA` (line 95) and `anonSelect` (line 115) destructure only `data`, not `error`. Both assertions check `(data?.length ?? 0) === 0`. If the underlying query fails for a reason unrelated to RLS (network blip, malformed query, wrong table), `data` comes back `null`, `?.length ?? 0` reads as `0`, and the assertion **passes** — even though nothing about RLS was actually exercised. This is specifically dangerous for the two "expect zero rows" proofs (cross-user select, unauthenticated select) — the core isolation guarantees this script exists to prove. (The "expect one row" assertions at 92-93 and 112-113 are not actually vulnerable to this — a query error there would correctly fail the `=== 1` check — but destructuring `error` there too keeps the pattern consistent and the failure message accurate.)
- **Fix**: Destructure `error` alongside `data` on all four selects and fold `!error` into each assertion condition, matching the pattern already used for the insert/update/delete assertions in the same file (lines 80, 84, 103, 110).
- **Decision**: FIXED — error destructured and checked on all four selects (ownSelectA, crossSelectA, stillThereB, anonSelect). Re-verified: `npm run verify:rls` passes, `eslint` reports 0 errors.

### F2 — Unplanned eslint.config.js lint-ignore for the generated types file

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:73
- **Detail**: Phase 2's plan didn't mention touching `eslint.config.js`. It was added mid-implementation because `src/db/database.types.ts` (Supabase's own codegen output, not hand-edited per the plan) trips `@typescript-eslint/no-redundant-type-constituents` on its empty-schema `Enums`/`CompositeTypes` boilerplate — an artifact of this project having no enums yet, not a real defect. The added `{ ignores: ["src/db/database.types.ts"] }` is scoped to exactly that one generated file.
- **Fix**: No action needed — flagged for the record only. This is the standard, low-risk way to keep a generated file out of a hand-authored lint surface, and it directly follows the plan's own stated intent that the file is "not hand-edited."
- **Decision**: SKIPPED — acknowledged as justified, no code change needed.

### F3 — ON DELETE CASCADE is a standing decision worth reconfirming per future table

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260824192356_create_people_table.sql (owner_id FK)
- **Detail**: `owner_id uuid ... references auth.users(id) on delete cascade` is correct and intentional here — it keeps `people` consistent on account deletion and is what `scripts/verify-rls.ts`'s cleanup relies on. Because this migration is explicitly the *pattern* every future user-owned table (S-01, S-02, S-03, S-05) will copy, it's worth flagging as a standing product decision: cascade-delete-on-account-removal vs. soft-delete/anonymize should be reconfirmed deliberately for each new table, not inherited silently just because `people` did it this way.
- **Fix**: No action needed now — this is scope for S-05 (deactivate/delete semantics), already noted as out of scope for this change in the plan's "What We're NOT Doing." Carried forward here so it isn't lost.
- **Decision**: ACCEPTED-AS-RULE: "ON DELETE CASCADE on owner_id is a per-table decision, not an inherited default" (context/foundation/lessons.md). `people`'s cascade stays as-is — it was a deliberate, already-shipped decision (plan-brief.md Key Decisions), not an oversight; the lesson governs future tables (S-01+), not a redo of this one.
