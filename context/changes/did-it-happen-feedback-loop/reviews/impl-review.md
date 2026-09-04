<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Did-It-Happen Feedback Loop Implementation Plan

- **Plan**: context/changes/did-it-happen-feedback-loop/plan.md
- **Scope**: Full plan (Phases 1-5)
- **Date**: 2026-09-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Method

Two parallel sub-agents: one compared every file the plan's five "Changes Required"
sections name against what actually exists (drift detection), the other read every
changed file for security/performance/reliability/data-safety issues and pattern
compliance against `lessons.md` and existing precedents (`rankings.ts`, `store.ts`,
`Toaster/`). Automated success criteria (`astro check`, `lint`, `build`,
`verify:rls`) were re-run directly in this session, not delegated. All five phases'
manual verification items were confirmed with real evidence during this same
implementation session (curl transcripts, DB queries, browser checks reported back
by the user) — not rubber-stamped.

## Findings

### F1 — `rankingEntryId` accepted without an ownership check

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/contact-events.ts:55 (context: comment at :39-42, check at :43)
- **Detail**: The POST handler verifies `personId` belongs to the caller via a
  scoped `select` before insert, with a comment explicitly explaining why:
  Postgres does not apply RLS when validating a foreign key, so an unverified id
  could reference another owner's row. The identical reasoning applies to
  `rankingEntryId` (a nullable FK into `ranking_entries`), but no equivalent check
  exists — `rankingEntryId ?? null` is written straight into the insert at line 55.
  A caller can link their own `contact_events` row to another account's
  `ranking_entries` row. Blast radius is limited (this FK is documented as
  "provenance only," and RLS still blocks reading the other account's row's
  content), but it is a real inconsistency with the invariant the file's own
  comment states two lines above, and it creates a cheap existence-oracle
  (insert fails vs. succeeds depending on whether the id exists at all).
- **Fix**: When `rankingEntryId` is present, verify it belongs to `ownerId` via a
  scoped `ranking_entries` select before the insert, mirroring the `person_id`
  check immediately above it (404 on mismatch, same as the existing pattern).
  - Strength: Same file already has the exact pattern to copy; small, local, low-risk change.
  - Tradeoff: One more query on the write path (negligible — this endpoint already does two).
  - Confidence: HIGH — the fix is a direct copy of adjacent, already-reviewed code.
  - Blind spot: None significant.
- **Decision**: FIXED — scoped `ranking_entries` select added before insert; verified live against local dev (bogus id → 404, omitted id still → 201).

### F2 — `updateContactEventSchema` allows an empty body

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/validation/contact-event.ts:23-26 (consumed at src/pages/api/contact-events/[id].ts:53)
- **Detail**: Both `outcome` and `note` are optional on `updateContactEventSchema`,
  so a body with neither passes validation, producing an empty `updates` object
  passed to `.update({})`. This likely reaches PostgREST as a no-op or an error
  rather than a meaningful `400`.
- **Fix**: Add a `.refine()` requiring at least one of `outcome`/`note` to be
  present, returning the existing 400 path with a clear message otherwise.
- **Decision**: FIXED — `.refine()` added; verified live against local dev
  (empty `{}` body now returns 400 "Brak danych do zapisania").

### F3 — `loadContactFacts` has no row cap

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/contact-history/facts.ts:58-62; called from src/lib/ranking/run.ts:88-96, dashboard.astro, people/index.astro
- **Detail**: Fetches every `contact_events` row for the owner, unbounded, on
  every ranking run and every dashboard/people-page load. Mitigated today by the
  200-char note cap and low expected event volume at MVP scale, but has no
  built-in ceiling if an account accumulates years of history.
- **Fix**: Not urgent — worth a time-window or per-person row cap if event volume
  becomes real, no action needed for this slice.
- **Decision**: SKIPPED — accepted as a future scale concern, not an MVP blocker.

## Clean areas (no findings)

- **Authn/authz**: every `/api/contact-events*` handler checks `context.locals.user`
  and scopes every query by `owner_id`; PATCH/DELETE return 404 (never 403) for
  rows the caller doesn't own, per plan.
- **Migration**: both `ON DELETE CASCADE` choices and the one `SET NULL` are
  explicitly justified in a header comment per the per-table-decision lesson; RLS
  mirrors the established four-policy shape exactly; `verify-rls.ts` extended
  with a matching isolation block, re-run clean this session.
- **Delete confirmation**: `ContactHistorySheet.tsx` uses an inline
  `confirmingDelete` row state, never `window.confirm` (repo-wide grep: zero
  matches).
- **Reliability**: every fetch in `ContactMarker`, `ContactHistorySheet`, and
  `HierarchyView` is wrapped in try/catch with a toast or status fallback;
  `useEffect` listeners and the poll `setInterval` are cleaned up on unmount;
  the cross-island facts broadcast uses functional `setState`, avoiding
  stale-closure races between the marker's optimistic update and the sheet's
  broadcasts.
- **Pattern compliance**: every new API route mirrors `rankings.ts`'s
  `json()`/401/503 shape; every new component folder has
  `Component.tsx` + `types.ts` + `index.ts`; `sheet.tsx` imports `cn` from
  `@/lib/utils` (corrected from the shadcn registry's stray `cn` package
  during Phase 4); route/file names stay English, Polish stays in copy only.
- **`PersonCard.tsx`**: ships with zero hydration — no `client:` directive
  anywhere in `people/index.astro`, no `onClick`, only
  `data-open-contact-history`/`data-person-name` consumed by one delegated
  listener in the page's own `<script>`.
- **Scope guardrails**: none of "What We're NOT Doing" (reminders, snooze,
  recompute-on-mark, `/people/[id]`, backdating UI, ranking-schema changes,
  person editing/deactivation/deletion, categories/tabs) were built.
  `PersonCard`'s visual redesign (swatch square, compact weight meter) was an
  explicit user-directed addition during Phase 4 manual review, confined to
  layout/markup — the plan's actual functional requirements (facts prop,
  Historia data-attributes, no hydration) remain intact.

## Success Criteria

**Automated** (re-run this session): `npx astro check` (0 errors), `npm run lint`
(0 errors, only pre-existing `no-console` warnings), `npm run build` (clean),
`npm run verify:rls` (all isolation assertions pass, including the `contact_events`
block).

**Manual**: all 34 manual verification checkboxes across Phases 1-5 are `[x]`
with real evidence gathered during this implementation session (curl transcripts
against local and deployed environments, direct DB queries via `docker exec`,
and user-confirmed browser checks). One item, 5.7 (roadmap `S-03` + Linear issue
→ shipped state), is intentionally left `[ ]` — deferred to a future
`/10x-archive` run per the user's explicit choice, not a gap in verification.
