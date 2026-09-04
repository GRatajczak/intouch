<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Self-Profile Rhythm Fields

- **Plan**: context/changes/self-profile-rhythm-fields/plan.md
- **Scope**: Full plan (Phases 0–4)
- **Date**: 2026-09-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Native-POST fallback now serves raw JSON instead of a working page

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/profile/ProfileForm/ProfileForm.tsx:90 (`<form method="POST" action="/api/profile" ...>`)
- **Detail**: `api/profile.ts` was changed (at your explicit direction) from redirect-on-every-outcome to JSON-only responses, and `ProfileForm` now always calls `e.preventDefault()` and submits via `fetch`. The `method`/`action` attributes are vestigial — if a native submission ever actually fires (JS blocked, or the `client:load` island hasn't finished hydrating yet when the user hits Enter), the browser navigates to `/api/profile` and renders the raw JSON body instead of the old graceful redirect. Narrow window, but a real regression versus the prior fallback behavior.
- **Fix A ⭐ Recommended**: Drop the now-misleading `method`/`action` attributes from the `<form>` tag, since they no longer do anything real and their presence implies a fallback that doesn't work.
  - Strength: Removes a false signal from the code; nothing today relies on the native-submit path since the fields are already React-controlled (uncontrolled without JS regardless).
  - Tradeoff: If anyone later wants a genuine no-JS fallback, that intent is no longer visible from the markup.
  - Confidence: HIGH — the fields are controlled inputs with no `defaultValue`, so the form is already non-functional without JS; this just stops implying otherwise.
  - Blind spot: Haven't checked whether any test/tooling introspects the `action` attribute.
- **Fix B**: Leave it and accept the tradeoff explicitly with a one-line comment.
  - Strength: No code change; documents the known gap for a future reader.
  - Tradeoff: The narrow race (slow hydration + fast Enter-key submit) still serves a raw JSON blob to a real user, just a documented one.
  - Confidence: MEDIUM — depends how much this project cares about the sub-hydration race window.
  - Blind spot: No data on how often users hit Enter before `client:load` finishes on this app's typical connection speeds.
- **Decision**: PENDING

### F2 — Toast auto-dismiss timer resets for all toasts on any list mutation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/layout/Toaster/Toaster.tsx:66-73
- **Detail**: The auto-dismiss `useEffect` depends on `[toasts]` and clears+recreates a timer for every currently-visible toast whenever the array changes (a new toast arriving, or one being manually closed). A toast that's been showing for 4.9s gets its countdown restarted to a full 5s if a second toast appears or an existing one is dismissed in the meantime, so it can outlive its intended window.
- **Fix**: Key each toast's dismiss timer to its own creation rather than re-arming the whole set on every array mutation — e.g. start a `setTimeout` for a toast at the point it's added (in `showToast`'s event handler and the URL-param handler), not in an effect keyed to the full `toasts` array.
- **Decision**: PENDING

## Observations

- **Raw Supabase error message forwarded on 500** (src/pages/api/profile.ts:38) — `api/profile.ts` returns `error.message` straight from Supabase to the client on a DB failure. This mirrors the identical existing pattern in `src/pages/api/people.ts`, so it's a pre-existing repo-wide shape, not something new to this slice — fixing it only here would create inconsistency with `people.ts`. Worth a `context/foundation/lessons.md` entry and a follow-up across both routes rather than a one-off patch.
- **`showToast` imported via the Toaster barrel** (src/components/profile/ProfileForm/ProfileForm.tsx:6) — imports from `@/components/layout/Toaster` (the barrel) rather than `@/components/layout/Toaster/toast` directly, pulling the `Toaster` React component and its icon imports into ProfileForm's module graph. Almost certainly tree-shaken by Vite/Rollup; importing straight from `./toast` would remove any doubt.
- **`api/profile.ts` is now the only JSON-returning route in the app** — every sibling route (`api/people.ts`, `api/auth/*`) redirects on every outcome. This is the known, deliberate divergence from this session (recorded in the plan's Progress notes and the Linear close-out comment) — noted here for anyone auditing route conventions later, not a new problem.
- **`Toaster/` carries a fourth file** (`toast.ts`) beyond the `lessons.md` three-file component convention (`Component.tsx` + `types.ts` + `index.ts`). Reasonable extension — it separates the cross-island event contract from the rendering component — not a violation worth blocking on.

## Automated Success Criteria (re-verified on final tree)

- `npm run lint` — 0 errors, 33 pre-existing warnings (unrelated `no-console` in scripts/internal routes)
- `npx astro check` — 0 errors, 0 warnings, 4 hints
- `npm run build` — Complete
- `npm run verify:rls` — all 17 assertions pass
- `supabase migration list` — three rows, Local and Remote matched
- `git status --short` — clean except the pre-existing, unrelated `.claude/fiszki/`
