# Design System Foundation — Plan Brief

> Full plan: `context/changes/design-system-foundation/plan.md`

## What & Why

The repo has two disconnected visual systems today: an unused shadcn token
layer and the starter's hardcoded "cosmic" dark theme, which every real screen
actually uses. This plan replaces both with one token layer — palette,
typography, radii, semantic status colors — sourced from a completed Claude
Design handoff (`.ai/intouch-design-preparation/`), and applies it to every
screen that exists in the app today. It closes roadmap foundation `F-03`,
which every screen-rendering slice (`S-01`, `S-02`, `S-03`, `S-05`) depends on.

## Starting Point

`src/styles/global.css` defines shadcn's default token set (reaches only
`button.tsx`) plus a `.dark` block nothing toggles. Ten files hardcode the
starter's purple/blue "cosmic" gradient theme instead: `Welcome.astro`,
`Topbar.astro`, `LibBadge.astro` (dead code, no callers), `SubmitButton.tsx`,
`FormField.tsx`, `SignUpForm.tsx`, `dashboard.astro`, and all three
`auth/*.astro` pages. `Layout.astro`'s title is still `"10x Astro Starter"`.

## Desired End State

Every existing screen — landing hero, dashboard, sign-in, sign-up,
confirm-email, and shared chrome (`Banner`, `Topbar`) — renders on one
light-only, warm-pastel token layer with InTouch's own logo and title. No
`bg-cosmic`, no `purple-*`/`blue-*` utility, no raw hex anywhere in `src/`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Palette & typography | Warm pastel palette, Instrument Serif + Plus Jakarta Sans, from the design bundle | A completed Claude Design handoff already exists and answers the roadmap's open palette question directly | User (bundle) |
| Dark mode | Light-only; `.dark` block deleted | Matches `main_goal: speed`, and the design bundle itself has no dark variant | Plan (confirmed) |
| Plan scope vs. design bundle | Tokens + logo + restyle today's real screens only; hierarchy/catalog/form screens deferred to S-01–S-04 | Those screens need a data model that doesn't exist yet (`FR-002`/`FR-003` fields unpinned) — building them now risks throwaway rework | Plan (confirmed) |
| Logo | Build now as a small SVG component + favicon | Near-zero cost, closes the Outcome's "product identity" bar that `Layout.astro`'s starter title currently fails | Plan (confirmed) |
| Landing page depth | Short restyled hero only, not the bundle's full 6-section marketing page | `index.astro` has no traffic yet to convert; full landing is meaningfully bigger than "foundation" scope | Plan (confirmed) |
| Destructive color | New brick-red token, distinct from the rose "urgency" color | Reusing rose for both "urgent suggestion" and "delete this person" risks the same color carrying two different meanings on a binary, GDPR-adjacent action | Plan (confirmed) |

## Scope

**In scope:**
- New token layer in `global.css` (palette, radii, type scale, status colors)
- Logo component + favicon + `Layout.astro` product identity
- Restyle: `Banner`, `Topbar`, `dashboard.astro`, `index.astro`/`Welcome.astro` (short hero), all 3 auth pages, all 4 auth form components
- Delete `LibBadge.astro` (dead code) and the `.dark`/`bg-cosmic` artifacts

**Out of scope:**
- Contact hierarchy, people catalog, add-person form, reminder settings, "did it happen?" confirmation, reminder email template (belong to `S-01`–`S-04`)
- Full marketing landing page (bundle section 8)
- Dark mode
- Storybook / component gallery
- Regenerating `favicon.png` (new `favicon.svg` added alongside it)

## Architecture / Approach

Three sequential phases: (1) rewrite `global.css`'s tokens — the hard
prerequisite everything else reads from; (2) add the `Logo` component and
product identity in `Layout.astro`/favicon; (3) migrate every existing screen
and component off the starter theme onto the new tokens, deleting dead code
along the way. Phases 2 and 3 don't depend on each other but run in that order
since Phase 3's screens use the Phase 2 logo.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tokens & typography | Full palette/radius/type token layer in `global.css`, `.dark`/`bg-cosmic` removed | Token naming departs from stock shadcn in 3 places (`--input` as background, new `--color-text-tertiary`, explicit radius steps) — documented in the plan's Critical Implementation Details |
| 2. Logo & product identity | `Logo.astro` component, `favicon.svg`, `Layout.astro` title | None significant — static SVG, no data dependency |
| 3. Migrate existing screens | All 6 routes + shared chrome + auth forms restyled, `LibBadge.astro` deleted | Largest file count (11 files) — regression risk in the auth flow's actual behavior, not just its look |

**Prerequisites:** None — no backend, no data model dependency.
**Estimated effort:** ~1 session across 3 phases (CSS/markup-only, no new runtime code).

## Open Risks & Assumptions

- The design bundle's border colors (`#E4DCD1` vs `#EAE3D9`) are close enough to be visually indistinguishable; the plan canonicalizes to one `--border` value rather than modeling a two-tier border system the bundle itself may not have intended deliberately.
- Google Fonts loading mechanism (CSS `@import` in Phase 1 vs. `<link>` tags in Phase 2's `Layout.astro`) should be chosen once and used consistently — the plan flags this but leaves the final call to the implementer to avoid double-loading.

## Success Criteria (Summary)

- All 6 existing routes render on the new token layer with zero `bg-cosmic`/`purple-*`/`blue-*`/raw-hex remaining in `src/`
- `npm run build` and `npm run lint` pass
- The full auth flow (sign up → confirm email → sign in → dashboard → sign out) still works, unchanged in behavior
