# App Shell Navigation and Catalog Visual Alignment — Plan Brief

> Full plan: `context/changes/design-alignment-pass/plan.md`

## What & Why

Closes the remaining visual gap between the shipped app and the finished
Claude Design handoff in `.ai/intouch-design-preparation/`. A prior change
(`design-system-foundation`, `F-03`, done) already brought the mock's palette,
radii, and typography into `src/styles/global.css` and restyled every screen
that existed at the time. What's still missing: no persistent navigation
exists anywhere, `/people` is a flat list instead of the mock's grid, and no
card anywhere has a shadow.

## Starting Point

Every page (`dashboard.astro`, `people/index.astro`, `profile.astro`,
`people/new.astro`, the three `auth/*.astro` pages) is an isolated centered
card with an identical shadowless recipe. `Topbar.astro` is a thin status bar
used only on `/`, not global chrome. `/people` sorts by weight then creation
date and renders a flat vertical list. The weight scale is 1–10 (a settled
`FR-004` amendment) even though the mock's dot indicator predates that
decision and shows 5.

## Desired End State

`/dashboard`, `/people`, and a new `/ustawienia` stub share one persistent
app shell — a left sidebar at desktop widths, a fixed bottom tab bar on
mobile, three nav items (Dziś / Bliscy / Ustawienia). `/people` renders as a
responsive card grid with a per-relationship-type color swatch. Every card
in the app carries a shared soft-shadow token. No schema change anywhere.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Persistent nav | Build now: sidebar (desktop) + bottom tab bar (mobile), one shared nav-items config | User's explicit call; matches the mock's two distinct breakpoint patterns and the PRD's mobile-usability NFR | Plan (confirmed) |
| Nav items | Dziś, Bliscy, Ustawienia — "Historia" dropped | No history feature exists yet; a nav item with nothing behind it is worse than one fewer item | Plan (confirmed) |
| Shell scope | Wraps only `/dashboard`, `/people`, new `/ustawienia` stub | `/profile` and `/people/new` are focused-task cards in the mock too, without a sidebar | Plan (confirmed) |
| `/people` catalog | Visual grid reskin only — no tabs/search/inactive-filter | That would deliver the roadmap's parked, nice-to-have `FR-006`, out of scope under `main_goal: speed` | Plan (confirmed) |
| Profile/add-person forms | Keep exact current fields, restyle spacing only | The mock's onboarding wizard and trait-chip fields don't exist in the shipped schema; not reopening `FR-002`/`FR-003` here | Plan (confirmed) |
| Person detail page | Not built this pass | Its main content (AI reasoning, history) needs `S-02`/`S-03`, which don't exist yet | Plan (confirmed) |
| Swatch color source | Keyed on `relationship_type`, not `id` | Deterministic and meaningful (same category = same color) without a schema change; hashing `id` would look random | Plan (confirmed) |

## Scope

**In scope:**
- New app shell: sidebar + mobile bottom bar, shared nav-items config, zero client JS
- `/dashboard`, `/people`, new `/ustawienia` stub migrated into the shell; middleware updated to protect the new route
- `/people` grid reskin + `PersonCard` reflow (swatch, drop description, keep pill + weight indicator)
- Shared `--shadow-card` token applied to every card in the app (shell, catalog, and the standalone auth/profile/add-person cards)

**Out of scope:**
- `S-02`'s ranked "Dziś" content, `S-03`'s contact history, `S-04`'s real reminder settings (`/ustawienia` is a placeholder)
- Category tabs, search, inactive-filter on `/people` (parked `FR-006`)
- Any field change to `ProfileForm`/`PersonForm`, any wizard chrome, any chip-tag input
- `/people/[id]` detail page
- `S-06`'s landing page, `F-04`/`S-04`'s email templates
- Google/OAuth sign-in, dark mode, Storybook

## Architecture / Approach

Five phases: shared tokens (shadow + swatch) → shell components (nav config,
sidebar, bottom bar, composing `AppShell`, built with no callers yet) →
migrate three pages into the shell + middleware update → `/people` grid
reskin → mechanical shadow polish on the pages that stay standalone. Every
shell component is server-rendered Astro with `Astro.url.pathname`-driven
active-nav state — no client JS anywhere in this pass.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared tokens | `--shadow-card` token, relationship-type color-swatch lookup | None — additive, unused until later phases |
| 2. App shell components | `nav-items.ts`, `shell-summary.ts`, `AppSidebar`, `BottomNav`, `AppShell` | None — no page imports these yet |
| 3. Migrate + Ustawienia stub | `/dashboard`, `/people`, `/ustawienia` inside the shell; sign-out moved to sidebar | Forgetting the `PROTECTED_ROUTES` middleware edit ships an unauthenticated route |
| 4. Catalog grid reskin | `/people` as a responsive grid, `PersonCard` reflowed | Dropping the description paragraph is a content trade-off flagged for sign-off, not purely mechanical |
| 5. Standalone-card polish | Shadow token on auth/profile/add-person cards | Auth-flow regression risk is low but should be click-through tested, not just eyeballed |

**Prerequisites:** `F-03` (`design-system-foundation`, done) and `S-01` (`profile-and-first-people`, done) — both satisfied.
**Estimated effort:** ~1–2 sessions across 5 phases (no new data model, no new runtime logic beyond static Astro components).

## Open Risks & Assumptions

- Breakpoint choice (`lg`, 1024px) means a portrait tablet (768–1023px) gets
  the mobile bottom-bar treatment despite having room for a sidebar — an
  accepted trade-off, not a bug.
- Keying the color swatch on `relationship_type` means every "Inne" (other)
  person renders identically — accepted given no `color` column exists.
- The grid card drops the `description` paragraph with no detail page yet to
  show it elsewhere — a deliberate, flagged trade-off pending implementer
  confirmation during Phase 4, not an oversight.

## Success Criteria (Summary)

- `/dashboard`, `/people`, `/ustawienia` share one persistent nav shell that
  switches correctly between sidebar (desktop) and bottom bar (mobile)
- `/people` renders as a grid with consistent per-type color swatches and
  correct tied-weight rendering
- Full auth click-through and the existing `/profile`/`/people/new` flows are
  unaffected in behavior — only shadows changed
