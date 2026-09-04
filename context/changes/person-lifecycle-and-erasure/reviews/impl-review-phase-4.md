<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Person Lifecycle and Erasure

- **Plan**: context/changes/person-lifecycle-and-erasure/plan.md
- **Scope**: Phase 4 of 5
- **Date**: 2026-09-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Context

Phase 4 also carries substantial live design iteration beyond the plan's original Phase 4 text, all directed explicitly by the user mid-implementation via screenshots and direct instructions (not silent scope creep): an inline "Dopisz kontakt" add-contact-event feature, global `WeightIndicator` resizing/recoloring (touching `PersonCard` and `HierarchyCard` too), a back-to-list link, and a mobile-responsive pass. The one deliberate deviation from the plan's own "What We're NOT Doing" — history as an inline dropdown instead of reusing `ContactHistorySheet` — was explicitly directed by the user against the design mock and is already documented inline in `plan.md`'s Progress section (item 4.10) and in the commit message. This review does not re-flag that deviation itself, only its downstream code-quality consequences (F4 below).

Phase 4 landed as commit `9e55630`, after a git collision with a concurrent session (`intouch-2e`) briefly bundled it into an unrelated commit and then dropped it via `git reset --hard`; recovered and documented in `plan.md`.

## Findings

### F1 — PersonEditForm silently fails to clear optional fields

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/people/PersonEditForm/PersonEditForm.tsx:87-89 (validate()); src/lib/validation/person.ts (personUpdateSchema); src/pages/api/people/[id].ts:46-72
- **Detail**: `validate()` converts an emptied `relationshipContext`/`contextTags`/`lastContactBucket` to `undefined` (the create-form convention for "not set"). `JSON.stringify` drops `undefined`-valued keys entirely, so the PATCH body omits the key. The route's `if ("field" in parsed.data)` guard then skips the update — the old value silently survives. A user who clears all tags or "last contact" in edit mode sees no error, but nothing actually changes. The route already handles a `null` value correctly (`parsed.data.relationshipContext ?? null`, `?? []`) — it just never receives one.
- **Fix**: Send `null` (not `undefined`) for cleared optional fields in `PersonEditForm`, and add `.nullable()` to `relationshipContext`/`contextTags`/`lastContactBucket` on `personUpdateSchema` so `null` validates (the route's existing `?? null` / `?? []` fallbacks already do the right thing once `null` arrives).
- **Decision**: FIXED — verified end-to-end against the local dev server (seeded a person with all three fields set, PATCHed with `null` for all three, confirmed `relationship_context: null`, `context_tags: []`, `last_contact_bucket: null` in the response).

### F2 — Delete-confirmation dialog closes even when the DELETE request fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/people/PersonDetailView/PersonDetailView.tsx (AlertDialogAction onClick in the delete flow)
- **Detail**: `AlertDialogAction`'s `onClick` calls `e.preventDefault()` intending to keep the dialog open on failure, but Radix's `AlertDialogAction` closes the dialog on click regardless of `preventDefault` on the handler — it isn't wired to cancel the primitive's own close behavior. A failed delete closes the dialog anyway; the error toast still fires, but the user loses the retry-in-place affordance and has to reopen the confirmation from scratch.
- **Fix**: Switch to a controlled `<AlertDialog open={...} onOpenChange={...}>` and only set `open=false` on confirmed success; keep it open (with the toast) on failure.
- **Decision**: FIXED — applied differently than proposed: replaced `AlertDialogAction` with a plain `Button` (variant="destructive") inside `AlertDialogFooter` instead of introducing controlled `open` state. `AlertDialogCancel` stays as the Radix-native close path; the plain button just runs `handleDelete()` with no auto-close side effect, so a failed delete simply leaves the dialog open with no state to manage.

### F3 — Invalid nested interactive elements in PersonCard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: src/components/people/PersonCard/PersonCard.tsx:43-96; src/pages/people/index.astro:79
- **Detail**: The whole card is now `<a href="/people/{id}">` wrapping a `<button data-open-contact-history>` ("Historia"). `<button>` inside `<a>` is invalid HTML; correctness depends entirely on the delegated `event.preventDefault()` in `people/index.astro`'s click listener plus a `relative z-10` stacking hack on the button. This works in the common case but is fragile — it can still confuse screen readers and keyboard tab order (two nested interactive targets with unclear semantics), and any future change to the delegated listener silently reintroduces double-navigation.
- **Fix A ⭐ Recommended**: Restructure as an overlay-link pattern — keep the card's visual content in a plain `<div>`, add a separate `<a>` with `absolute inset-0` behind the content (lowest z-index) for card-level navigation, and let "Historia" remain a normal, non-nested `<button>` in front of it (`relative z-10` already used).
  - Strength: Removes the invalid nesting entirely; each interactive element has unambiguous semantics and correct tab order.
  - Tradeoff: Slightly more markup; the overlay-link pattern needs the card's own container to be `position: relative`.
  - Confidence: HIGH — this is the standard fix for "whole card is a link, but one inner element needs its own click".
  - Blind spot: Haven't verified how this interacts with the card's existing hover-shadow transition, though it should be unaffected since only stacking/positioning changes.
- **Fix B**: Keep the current nested structure; leave as documented, accepted debt.
  - Strength: Zero-risk, no code change.
  - Tradeoff: The fragility described above persists — a future edit to the delegated listener could reintroduce double-navigation with no compiler/lint signal.
  - Confidence: MEDIUM — works today, risk is about future changes, not current behavior.
  - Blind spot: No accessibility audit was run to quantify real-world screen-reader impact.
- **Decision**: FIXED via Fix A — overlay-link pattern applied. Also removed the now-unneeded delegated `preventDefault()` (and its stale comment) in `people/index.astro`, since "Historia" is no longer nested inside the anchor and the click no longer bubbles through it.

### F4 — Inline history/add-contact duplicates ContactHistorySheet instead of sharing logic

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: src/components/people/PersonDetailView/PersonDetailView.tsx (history fetch/render/date-format, "Dopisz kontakt" form) vs src/components/contact-history/ContactHistorySheet/ContactHistorySheet.tsx
- **Detail**: The user explicitly directed history to be an inline dropdown here instead of reusing `ContactHistorySheet` (already accepted, not re-litigated by this finding). But the inline version re-implements the events fetch, date formatting, and outcome rendering from scratch, and drops per-event edit/delete entirely (only add is supported here). Two now-parallel implementations of "render a person's contact history" risk drifting apart silently over time (e.g., a future change to event outcome labels or date formatting in one place and not the other).
- **Fix A ⭐ Recommended**: Extract the shared bits (event fetch + date formatting + outcome-row rendering) into a small shared hook/component both `ContactHistorySheet` and `PersonDetailView` consume, keeping each surface's own chrome (sheet vs. inline dropdown) and per-event actions (sheet keeps edit/delete; detail page stays read-only + add).
  - Strength: Removes the drift risk at its root; a future formatting or labeling change lands once.
  - Tradeoff: Real refactor — touches a component other phases/features may also depend on; needs its own test pass.
  - Confidence: MEDIUM — the shared surface is clear, but the sheet's edit/delete state machine is more complex than the detail page's read+add needs, so the extraction boundary takes some care.
  - Blind spot: Haven't checked whether any other caller of `ContactHistorySheet`'s internals exists beyond `people/index.astro`'s delegated open pattern.
- **Fix B**: Leave as two separate implementations; accept the duplication as the cost of the inline-dropdown design decision.
  - Strength: No further work; both surfaces work correctly today (verified by the safety/pattern review).
  - Tradeoff: Duplication compounds if a third history-rendering surface is ever added.
  - Confidence: HIGH — this is a known, common tradeoff and not urgent.
  - Blind spot: None significant.
- **Decision**: ACCEPTED via Fix B — duplication accepted as the cost of the inline-dropdown decision; not urgent.

### F5 — History fetch has no retry path after a failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/people/PersonDetailView/PersonDetailView.tsx (toggleHistory, submitContact — both gate re-fetch on `historyState === "idle"`)
- **Detail**: Once `loadHistory()` fails, `historyState` is stuck at `"error"` permanently — collapsing/reopening the section or opening "Dopisz kontakt" never re-fetches, since both only trigger a load when state is `"idle"`.
- **Fix**: Also trigger `loadHistory()` when `historyState === "error"` (not just `"idle"`), or add an explicit "Spróbuj ponownie" retry action in the error state.
- **Decision**: FIXED — both gates now check `historyState === "idle" || historyState === "error"`.

### F6 — Redundant duplicate history fetch on fast interaction

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/people/PersonDetailView/PersonDetailView.tsx (submitContact)
- **Detail**: If a user opens "Dopisz kontakt" (triggers `loadHistory()`) and submits before that fetch resolves, `historyState` is still `"loading"`, so `submitContact` fires a second, redundant `loadHistory()` call afterward. Harmless but wasteful.
- **Fix**: Guard the post-submit refresh with the in-flight state, or await the initial load before allowing submit.
- **Decision**: FIXED — `loadHistory()` now returns its promise, tracked in a `historyLoadRef`; `submitContact` awaits an in-flight load (if any) before reloading once more, turning a concurrent duplicate GET into at most one sequential follow-up (and none at all in the common case).

### F7 — No unmount guard on new async handlers

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/people/PersonDetailView/PersonDetailView.tsx (toggleStatus, handleDelete, loadHistory, submitContact)
- **Detail**: None of the new fetch handlers check mount status or use `AbortController`; navigating away mid-request can trigger a "set state on unmounted component" warning. Matches the existing codebase-wide pattern (e.g. `ContactMarker` has the same gap), so this is not a phase-4 regression — noted for completeness only.
- **Fix**: Not required to match existing conventions; would need a codebase-wide pass if ever addressed.
- **Decision**: SKIPPED — matches existing codebase-wide convention; not worth a one-off fix here.

### F8 — JSON-content-type fetches bypass Astro's origin/CSRF check (pre-existing, app-wide)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/people/PersonDetailView/PersonDetailView.tsx, src/components/people/PersonEditForm/PersonEditForm.tsx
- **Detail**: Astro's `security.checkOrigin` only inspects form-like content types; explicitly sending `Content-Type: application/json` (and the header-less DELETE) opts out of that check. This matches `ContactHistorySheet.tsx`'s existing convention app-wide, so it's not a phase-4 regression — these mutating endpoints rely solely on Supabase session cookies (SameSite) for CSRF resistance, not Astro's origin check. Worth a systemic look someday, not a phase-4 action item.
- **Fix**: None required for this phase; flag for a future security-focused pass if the app ever needs stronger CSRF guarantees.
- **Decision**: SKIPPED — pre-existing, app-wide convention; not a phase-4 action item.

## Verified Clean

- Data safety: "Usuń na zawsze" renders only when `status === "deactivated"` (`PersonDetailView.tsx`), matching the server-side `409` guard in `people/[id].ts` — correct defense in depth.
- Fetch headers/error handling: `PersonEditForm` and `PersonDetailView`'s PATCH/POST calls all send `Content-Type: application/json` and follow the established `res.ok` + `body.error` + toast pattern.
- Middleware: `/people/[id]` is covered by both `PROTECTED_ROUTES` and `PROFILE_GATED_ROUTES` via the `"/people"` prefix match.
- No injection/XSS: all user content renders via JSX text interpolation, no `dangerouslySetInnerHTML`.
- Component structure: `PersonDetailView/`, `PersonEditForm/`, `WeightIndicator/`, `PersonCard/` all carry `types.ts` + `index.ts`; `alert-dialog.tsx` correctly stays flat, matching `ui/`'s existing convention.
- No N+1 queries.
- Automated success criteria re-verified fresh (2026-09-04): `npx astro check` — 0 errors; `npm run lint` — 0 errors (81 pre-existing warnings, unrelated); `npm run build` — succeeds.
- All 8 manual verification items (4.4–4.11) checked with observable evidence from the live iteration in this session (screenshots + explicit user confirmation across multiple rounds).

## Post-Triage

5 of 5 warnings resolved (4 fixed, 1 accepted); 2 of 3 observations skipped as intentional (matching existing app-wide conventions), 1 fixed. Re-verified after triage: `npx astro check` — 0 errors; `npm run lint` — 0 errors in `src/` (81 pre-existing warnings unrelated; one transient parsing error on a gitignored local Supabase runtime artifact, not a source file); `npm run build` — succeeds.
