<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Self-Profile and First People Implementation Plan

- **Plan**: context/changes/profile-and-first-people/plan.md
- **Scope**: Full plan (Phases 1–4)
- **Date**: 2026-08-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

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

### F1 — Migration adds NOT NULL columns without a hard emptiness guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260830101704_add_profiles_and_people_fields.sql:44-49
- **Detail**: The migration adds five `NOT NULL` columns to `people` without a `DEFAULT`, which the migration's own comment says is safe only because the table currently holds no real rows. That reasoning is correct and already documented (plan.md's "Migration Notes" section states this explicitly), but nothing in the migration itself enforces the assumption — if it were ever replayed against a non-empty environment, Postgres would fail loudly on the `NOT NULL` violation, which is an acceptable failure mode but relies entirely on ordering/discipline rather than an explicit check.
- **Fix**: Optional — add a guard at the top of the migration (e.g. `do $$ begin if exists (select 1 from public.people limit 1) then raise exception 'people is not empty; add columns with a DEFAULT instead'; end if; end $$;`) so a misordered replay fails with a clear message instead of a generic constraint violation. Not required to ship — this is already a one-time, already-applied migration.
- **Decision**: PENDING

### F2 — Supabase query errors are silently swallowed, faking "empty" state

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/people/index.astro:16-22, src/pages/profile.astro:13-21
- **Detail**: Both pages destructure only `{ data }` from their Supabase query and default to `[]` / `undefined` on any failure, including transient DB errors. A real outage or query failure renders identically to "you have no people yet" / "you haven't filled your profile yet" — the user sees a misleading state rather than an error.
- **Fix**: Also destructure `error` from each query; on a truthy `error`, render a visible error message (or redirect with `?error=`) instead of falling through to the empty-state path.
- **Decision**: PENDING

### F3 — Unbounded row-parsing loop in the multi-person form parser

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/lib/validation/person.ts:34 (`for (let i = 0; form.has(\`name-${i}\`); i++)`)
- **Detail**: The loop that reads indexed `name-0`, `name-1`, ... fields from the submitted `FormData` has no upper bound. An authenticated user (this route requires auth) could submit a crafted multipart body with thousands of `name-N` fields, driving a long synchronous loop and a large Zod array validation before any size limit is hit.
- **Fix**: Cap the loop (e.g. `for (let i = 0; i < 50 && form.has(...); i++)`), independent of whatever body-size/CPU limits Cloudflare Workers enforce upstream.
- **Decision**: PENDING

### F4 — Profile-gate query in middleware also swallows its error

- **Severity**: ⚪ OBSERVATION
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/middleware.ts:26-35
- **Detail**: Same pattern as F2 — the `profiles` lookup in the gate discards `error` and treats any failure as "no profile row", redirecting an already-complete-profile user back to `/profile` on a transient DB hiccup. Low impact (no redirect loop; `/profile` itself isn't gated), but the same class of issue as F2.
- **Decision**: PENDING

### F5 — Original `people` migration (F-01) shipped without table-level GRANTs; worth a lesson

- **Severity**: ⚪ OBSERVATION
- **Dimension**: Plan Adherence / Process
- **Location**: supabase/migrations/20260824192356_create_people_table.sql (historical, already fixed forward in this diff's migration)
- **Detail**: This isn't a defect in the reviewed diff — Phase 1 correctly discovered and retrofitted the missing `GRANT`s onto both `people` and `profiles`. But the underlying rule ("RLS policies alone don't grant table access — every new owner-scoped table needs explicit `GRANT`s from the start") isn't yet captured in `context/foundation/lessons.md`, so a future new table could reintroduce the same gap.
- **Decision**: PENDING

### F6 — Unchecked type cast when looking up a person's relationship-type label

- **Severity**: ⚪ OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: src/components/people/PersonCard/PersonCard.tsx:13
- **Detail**: `person.relationship_type as keyof typeof RELATIONSHIP_TYPE_LABELS` casts a DB-sourced string without checking membership. Today it's safe (the DB `CHECK` constraint enforces the enum), but if that constraint were ever loosened, an unexpected value would silently render as `undefined` instead of a fallback.
- **Decision**: PENDING
