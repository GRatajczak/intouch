# App Shell Navigation and Catalog Visual Alignment Implementation Plan

## Overview

Close the remaining visual gap between the shipped app and the finished
Claude Design handoff (`.ai/intouch-design-preparation/project/InTouch.dc.html`).
`design-system-foundation` (`F-03`, done) already pulled the mock's palette,
radii, and typography into `src/styles/global.css` and restyled every screen
that existed at the time. What's left, found by direct comparison against the
mock: no persistent navigation exists anywhere, `/people` is a flat list
instead of the mock's grid, and no card anywhere has a shadow. This plan adds
a shared app-shell (sidebar + mobile bottom bar), reskins the people catalog
to a grid, and applies a shadow token everywhere the existing card recipe is
used.

## Current State Analysis

- **Tokens already match the mock closely** (`src/styles/global.css`) — light
  warm-pastel palette, `Instrument Serif`/`Plus Jakarta Sans`, full radius
  scale. No shadow token exists; every card is `border` only.
- **No persistent nav exists.** `src/components/Topbar.astro` is a thin status
  bar imported only by `Welcome.astro` (the `/` landing hero) — not global
  chrome. Every other page (`dashboard.astro`, `people/index.astro`,
  `profile.astro`, `people/new.astro`, the three `auth/*.astro` pages) is an
  isolated centered card with the identical recipe
  `border-border bg-card text-card-foreground rounded-2xl border p-8` (or
  `p-4` for `PersonCard`).
- **`src/pages/dashboard.astro`** (30 lines) is a placeholder menu card:
  greeting, two nav buttons (`/profile`, `/people`), and a sign-out `<form>`.
  It does not query Supabase for anything beyond `Astro.locals.user.email`.
- **`src/pages/people/index.astro`** (56 lines) queries `people` ordered by
  `weight desc, created_at asc`, renders `<EmptyState />` or a `space-y-3`
  flat list of `<PersonCard>` — no grid, no category filtering.
- **`src/components/people/PersonCard/PersonCard.tsx`** (30 lines) shows name,
  a relationship-type text pill (`RELATIONSHIP_TYPE_LABELS`), an optional
  "Grupa" tag, the full `description` paragraph, and a 10-segment
  `WeightIndicator` — a wide list-row shape, not the mock's compact catalog
  card.
- **`src/middleware.ts`** (42 lines): `PROTECTED_ROUTES = ["/dashboard",
  "/profile", "/people"]`, `PROFILE_GATED_ROUTES = ["/people"]`. A new
  `/ustawienia` route must be added to the first array or it ships
  unauthenticated.
- **Weight scale is 1–10** (explicit `FR-004` amendment during `S-01`
  planning — the mock's visual 5-dot scale predates that decision and must
  not be reintroduced).
- **`ProfileForm.tsx`** (3 fields: name, birthDate, lifeContext) and
  `PersonForm.tsx` (multi-row: name, relationshipType, description,
  isCollective, weight) both have field sets the mock's onboarding
  wizard/chip-tag UI doesn't match — those extra mock fields (weekly time
  available, contact preference, trait chips, last-contact chip-select) don't
  exist in the shipped schema.
- Two other roadmap items already own adjacent mock sections and are not
  touched here: `S-06` (`landing-page`, mock section 8) and `F-04`/`S-04`
  (email delivery, mock section 9).

## Desired End State

`/dashboard`, `/people`, and a new `/ustawienia` stub render inside one
shared app shell: a left sidebar at `lg:` (1024px) and up, a fixed bottom tab
bar below that, both driven by one nav-items list
(`Dziś`→`/dashboard`, `Bliscy`→`/people`, `Ustawienia`→`/ustawienia`) with
server-rendered active-route highlighting and zero client JS. `/people`
renders as a responsive card grid with a per-relationship-type color swatch
on each card. Every card in the app — auth, profile, add-person, dashboard,
catalog, shell chrome — carries the mock's soft shadow via one new token. No
schema change, no new routes beyond the `ustawienia` stub, no field changes
anywhere.

**Verification**: `npm run build` and `npm run lint` pass; manual click-through
at ~1200px and ~390px widths confirms the sidebar/bottom-bar swap at the `lg`
breakpoint, active-nav highlighting, sign-out reachable from every shell page,
and `/ustawienia` redirecting to sign-in when logged out.

### Key Discoveries:

- Tailwind v4's `@theme inline` block in `global.css:66-124` already mirrors
  every `--radius-*`/`--color-*` custom property into a Tailwind utility the
  same way; a `--shadow-card` token added the same way generates a
  `shadow-card` utility with no other wiring needed.
- Every page already queries Supabase directly in its own frontmatter — there
  is no shared "layout data loader" convention in this codebase (Astro has no
  Next.js-style layout data fetching). The shell's profile-summary footer
  should follow that same pattern via a small shared helper, not hide a query
  inside a "dumb" layout component.
- `src/components/Logo.astro` already implements the mock's two-overlapping-
  circle mark exactly (`#F3C7CD` / `#C6CDEE`, `mix-blend-mode: multiply`) —
  reuse as-is, no changes needed.
- Sign-out today lives only inside `dashboard.astro`'s content. Once the
  shell wraps three pages, sign-out must move into `AppSidebar.astro` or it
  becomes unreachable from `/people` and `/ustawienia`.

## What We're NOT Doing

- **Not building `S-02`'s ranked "Dziś" content, `S-03`'s history, or `S-04`'s
  real reminder settings.** `/dashboard` keeps its current placeholder content
  (now inside the shell) and `/ustawienia` is a "Wkrótce" stub — those slices
  own their own content when they land.
- **Not adding category tabs, search, or an inactive-filter to `/people`.**
  That would deliver the roadmap's parked, nice-to-have `FR-006`. This pass
  only changes the catalog's visual layout (grid vs. list), not its
  filtering/sorting behavior.
- **Not touching `ProfileForm`'s or `PersonForm`'s field sets.** No wizard
  chrome, no progress bar, no chip-tag trait input, no "last contact" chip
  selector — those mock elements need data or a multi-step flow this schema
  and this pass don't have.
- **Not building a `/people/[id]` detail page.** `PersonCard` stays
  non-clickable; a detail view needs `S-02`/`S-03`/`S-05` content (AI
  reasoning, contact history, edit/deactivate) to be worth building.
- **Not touching `S-06`'s landing page or `F-04`/`S-04`'s email templates.**
- **Not adding a Google/OAuth sign-in button** — no OAuth exists in the
  Supabase backend; the mock's button has nothing to wire to.
- **Not adding dark mode, Storybook, or a component gallery.**

## Implementation Approach

Five phases: (1) shared tokens the rest of the plan depends on — a shadow
token and a relationship-type color-swatch lookup; (2) the shell's building
blocks (nav-items config, sidebar, bottom bar, composing `AppShell`) as
standalone components with no callers yet; (3) migrate `dashboard.astro` and
`people/index.astro` into the shell, add the `ustawienia.astro` stub, update
middleware; (4) reskin `/people` to a grid and adapt `PersonCard`; (5)
mechanical shadow-token polish on the standalone-card pages that stay outside
the shell. Phases 1 and 2 have no user-visible effect on their own — nothing
imports the new components until Phase 3.

## Phase 1: Shared tokens

### Overview

Add the one new visual primitive (card shadow) and one new data-derived
lookup (relationship-type color swatch) that every later phase consumes.

### Changes Required:

#### 1. Shadow token

**File**: `src/styles/global.css`

**Intent**: Add a single card-elevation token so every card in the app can
pick up the mock's soft drop shadow from one place, following the exact
pattern already used for `--radius-*`/`--color-*`.

**Contract**: Add `--shadow-card: 0 18px 40px -28px rgba(60,45,30,0.45);` to
`:root` (near the existing radius block), and mirror it into the
`@theme inline` block as `--shadow-card: var(--shadow-card);` so Tailwind
generates a `shadow-card` utility class. No per-file hand-written
`box-shadow` — one token, one utility, applied via `shadow-card` wherever the
existing card recipe appears.

#### 2. Relationship-type color swatch

**File**: `src/lib/validation/person.ts` (add alongside the existing
`RELATIONSHIP_TYPE_LABELS`), `src/styles/global.css` (new tokens)

**Intent**: Give each catalog card a small color swatch without a schema
change, by deriving it from the existing `relationship_type` enum rather than
hashing `id` — a `family` card should always render the same color as every
other `family` card, not an arbitrary one keyed on a UUID.

**Contract**: Add five `--color-swatch-*` background tokens to `global.css`
(mirrored into `@theme inline`, same pattern as the existing
`--color-success`/`--color-warning`/`--color-urgent` pairs), and export
`RELATIONSHIP_TYPE_SWATCH: Record<RelationshipType, string>` mapping each of
`family/friend/colleague/acquaintance/other` to one token.

### Success Criteria:

#### Automated Verification:
- `npm run build` passes
- `npm run lint` passes

#### Manual Verification:
- `shadow-card` utility is available and renders visibly on a test element

---

## Phase 2: App shell components

### Overview

Build the shell's pieces — nav config, sidebar, mobile bottom bar, composing
wrapper — as standalone components. Nothing imports them yet, so this phase
is invisible in the running app.

### Changes Required:

#### 1. Nav items config

**File**: `src/lib/nav-items.ts` (new)

**Intent**: Single source of truth for both nav rednerings so the sidebar and
bottom bar can never drift out of sync with each other.

**Contract**: Export a `NAV_ITEMS` list of `{ href, label, icon }` for
`Dziś`→`/dashboard`, `Bliscy`→`/people`, `Ustawienia`→`/ustawienia` (icons as
directly-imported `lucide-react` components — Astro renders them to static
HTML server-side, no hydration needed), plus
`isNavItemActive(pathname: string, href: string): boolean` doing an exact-or-
prefix match, called identically from both nav renderers against
`Astro.url.pathname`.

#### 2. Shell summary helper

**File**: `src/lib/shell-summary.ts` (new)

**Intent**: Supply the sidebar's profile-summary footer ("{name} / {count}
bliskich osób") without hiding a Supabase query inside a "dumb" layout
component — follows this codebase's existing convention of pages owning
their own queries.

**Contract**: A small helper (or pair of helpers) taking a Supabase client
and `owner_id`, returning the profile's `name` as `string | null` — `null`
when no `profiles` row exists yet. Callers that already have the full `people`
array in scope (`people/index.astro`) pass `people.length` directly rather
than re-querying a count.

**No-profile case is reachable and must be handled**: `middleware.ts:5` gates
only `/people` on profile existence, so a signed-up user who hasn't completed
`/profile` lands on `/dashboard` (and can reach `/ustawienia`) with no
`profiles` row. When `profileName` is `null`, `AppSidebar`'s footer renders a
"Uzupełnij profil" prompt with a button linking to `/profile` — not the
name/count summary, and never a bare `undefined`.

#### 3. Sidebar

**File**: `src/components/layout/AppSidebar.astro` (new)

**Intent**: Desktop nav chrome — logo, nav list with active-state
highlighting, profile-summary footer, and sign-out (moved here from
`dashboard.astro` — see Phase 3 — so it's reachable from every shell page).

**Contract**: `hidden lg:flex` fixed-width column. Reuses
`src/components/Logo.astro` with `withWordmark` unchanged. Renders
`NAV_ITEMS` via `isNavItemActive`. Accepts `profileName` and an optional
`peopleCount`; renders the count line only when `peopleCount` is supplied.
Sign-out as the existing `<form method="POST" action="/api/auth/signout">`
pattern already used in `dashboard.astro` today. Carries `shadow-card` as the
"shell chrome" half of the End State's shadow promise.

#### 4. Mobile bottom bar

**File**: `src/components/layout/BottomNav.astro` (new)

**Intent**: The mock's distinct mobile nav pattern — a fixed bottom tab bar,
not a squeezed sidebar — satisfying the PRD's mobile-usability NFR.

**Contract**: `fixed bottom-0 inset-x-0 lg:hidden`, same `NAV_ITEMS`, icon+
label per tab, `pb-[env(safe-area-inset-bottom)]` for iOS home-indicator
devices. **Plus a 4th "Wyloguj" tab** rendering the same
`<form method="POST" action="/api/auth/signout">` as `AppSidebar` — without
it, sign-out is unreachable below `lg` once Phase 3 removes
`dashboard.astro`'s own form (`AppSidebar` is `hidden lg:flex`). This is a
deliberate divergence from the mock's 3-tab bar (`InTouch.dc.html:375-377`),
which has no sign-out control anywhere; verify the 4 tabs still fit at 390px.
Carries `shadow-card` (shadow pointing upward into the content) as the
"shell chrome" half of the End State's shadow promise.

#### 5. Composing shell

**File**: `src/components/layout/AppShell.astro` (new)

**Intent**: The single import point pages reach for — composes `Layout`,
`AppSidebar`, `<main>`, and `BottomNav` around a content slot.

**Contract**: Props `title`, `profileName`, **optional** `peopleCount`, default
`<slot />`. `peopleCount` is optional because only `/people` has the array in
scope for free — when it's omitted (`/dashboard`, `/ustawienia`) the sidebar
footer shows the name alone, with no count line and **no count query**.
`<main>` gets `pb-20 lg:pb-0` so content clears the fixed bottom bar on
mobile. Does not own per-page `<h1>` or header actions (e.g. `/people`'s
"Dodaj osobę" button) — those stay in the slot since they differ per page.

### Success Criteria:

#### Automated Verification:
- `npm run build` passes
- `npm run lint` passes
- `npm run typecheck` passes (if present in `package.json`)

#### Manual Verification:
- N/A — no page imports these components yet (verified in Phase 3)

---

## Phase 3: Migrate dashboard + people into the shell; new Ustawienia stub

### Overview

Wire the Phase 2 components into the three pages that should have persistent
nav, and protect the new route.

### Changes Required:

#### 1. Dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the standalone centered card with the shell; keep the
existing placeholder content (still no real "today" content — that's `S-02`)
but move sign-out into the sidebar.

**Contract**: Wrap existing content in `<AppShell title="Panel"
profileName={...}>` — no `peopleCount`, so this page adds exactly one new
query (the profile name) and no count query; fetch the summary via
`shell-summary.ts`; remove the page's own sign-out `<form>` now that
`AppSidebar` and `BottomNav` render it. Keep the greeting + two nav buttons in
a card, dropping the page's own `min-h-screen`/centering wrapper (the shell
owns page chrome now) and adding `shadow-card` to the retained
`border-border bg-card text-card-foreground rounded-2xl border p-8` recipe at
`dashboard.astro:10` — this is the 7th and last occurrence of that recipe, and
Phase 5 does not cover it.

#### 2. People list

**File**: `src/pages/people/index.astro`

**Intent**: Same wrapper swap; existing query and empty-state conditional
move into the slot unchanged (grid reskin itself is Phase 4).

**Contract**: `<AppShell title="Twoi bliscy" profileName={...}
peopleCount={people.length}>`; remove the page's own `max-w-2xl` centered
wrapper (the shell now owns page chrome).

#### 3. Ustawienia stub

**File**: `src/pages/ustawienia.astro` (new)

**Intent**: Give the "Ustawienia" nav item a real, safe destination without
building the actual reminder-settings feature (`S-04`, blocked on an
unresolved cadence decision).

**Contract**: `<AppShell title="Ustawienia" profileName={...}>` — no
`peopleCount`, same as `/dashboard` — wrapping a heading + "Wkrótce…"
placeholder paragraph. No form, no settings logic.

#### 4. Route protection

**File**: `src/middleware.ts`

**Intent**: Ensure the new stub requires authentication like every other
shell page.

**Contract**: Add `"/ustawienia"` to `PROTECTED_ROUTES` (line 4). Do not add
it to `PROFILE_GATED_ROUTES` — matches `/dashboard`'s current treatment (only
`/people` currently gates on profile completeness).

### Success Criteria:

#### Automated Verification:
- `npm run build` passes
- `npm run lint` passes

#### Manual Verification:
- Sidebar renders on `/dashboard`, `/people`, and `/ustawienia`; bottom bar
  renders on the same three pages below the `lg` breakpoint
- Active nav item is visually highlighted correctly on each of the three
  pages
- Sign-out works from all three pages (not just from where it used to live
  on `/dashboard`) — tested at **both** ~1200px (sidebar) and ~390px
  (`BottomNav`'s 4th tab), since the two controls live in different components
- Visiting `/ustawienia` while signed out redirects to `/auth/signin`
- Signed in with **no profile row yet**, `/dashboard` and `/ustawienia` render
  the sidebar footer's "Uzupełnij profil" prompt + button (never `undefined`),
  and the button lands on `/profile`
- `/profile` and `/people/new` are unaffected — still standalone cards, no
  shell

---

## Phase 4: People catalog grid reskin

### Overview

Convert `/people` from a flat list to the mock's responsive card grid, and
adapt `PersonCard` to a denser catalog-card shape.

### Changes Required:

#### 1. Grid layout

**File**: `src/pages/people/index.astro`

**Intent**: Match the mock's 3-column desktop catalog layout.

**Contract**: Replace the `space-y-3` flat-list wrapper with
`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`. Sort order and data
query are unchanged from Phase 3.

#### 2. Person card

**File**: `src/components/people/PersonCard/PersonCard.tsx`

**Intent**: Reflow the existing wide list-row card into a compact,
vertical catalog-card shape matching the mock, using only fields that
already exist.

**Contract**: Add `shadow-card` to the existing card recipe. Add the Phase 1
color swatch (small rounded square, top-left) alongside — not replacing —
the existing relationship-type text pill (the pill is the accessible label;
the swatch alone isn't legible). Reflow to swatch → name → pill → weight
indicator, top to bottom. Drop the `description` paragraph from this view —
there is no detail page to send users to for the full text yet, and showing
free-text (up to 500 chars) in a ~1/3-width grid cell needs truncation logic
the mock doesn't call for. `PersonCardProps` is unchanged.

### Success Criteria:

#### Automated Verification:
- `npm run build` passes
- `npm run lint` passes

#### Manual Verification:
- `/people` with 0 people shows `<EmptyState />` unchanged
- `/people` with 1, a few, and several people (including two people sharing
  a `relationship_type`, to confirm swatch consistency, and two sharing a
  `weight`, to confirm tied-weight rendering) renders correctly as a 1/2/3
  column grid at mobile/tablet/desktop widths
- `WeightIndicator`'s 10 segments fit visibly inside a grid cell at `lg`
  width without wrapping or overflowing

---

## Phase 5: Standalone-card polish

### Overview

Mechanical shadow-token application to the pages that stay outside the
shell, with no structural change.

### Changes Required:

#### 1. Shadow on standalone cards

**Files**: `src/pages/profile.astro`, `src/pages/people/new.astro`,
`src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`,
`src/pages/auth/confirm-email.astro`

**Intent**: Bring the remaining standalone cards in line with the shell and
catalog cards now that a shadow token exists.

**Contract**: Add `shadow-card` to each page's existing
`border-border bg-card text-card-foreground rounded-2xl border p-...` class
string. No other change — no OAuth button (none exists in the backend), no
field changes.

### Success Criteria:

#### Automated Verification:
- `npm run build` passes
- `npm run lint` passes

#### Manual Verification:
- Full auth click-through (sign up → confirm-email → sign in → dashboard →
  sign out) behaves identically to before this phase — only the visual
  shadow changed
- `/profile` and `/people/new` render correctly, unaffected in structure

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful.

---

## Testing Strategy

### Unit Tests:
- None new — this pass has no new business logic, only presentational
  components and Tailwind class changes.

### Integration Tests:
- None new.

### Manual Testing Steps:
1. At ~1200px width, confirm the sidebar renders on `/dashboard`, `/people`,
   `/ustawienia` with the correct active item highlighted, and does not
   render on `/profile` or `/people/new`.
2. At ~390px width, confirm the bottom tab bar replaces the sidebar on the
   same three pages, and content isn't clipped behind it.
3. Sign out from `/people` and from `/ustawienia` (not just `/dashboard`) to
   confirm the moved sign-out control works everywhere — **at both widths**,
   since desktop uses `AppSidebar`'s form and mobile uses `BottomNav`'s 4th
   tab. Signing out only at ~1200px would leave the mobile path untested.
4. Visit `/ustawienia` signed out — confirm redirect to `/auth/signin`.
5. On `/people`, add several people via `/people/new` including two with the
   same `relationship_type` and two with the same `weight`; confirm the grid
   renders all of them distinctly with consistent swatch colors per type.
6. Full auth click-through after Phase 5's shadow-only edits.
7. Visual spot-check against `.ai/intouch-design-preparation/project/InTouch.dc.html`
   sections 2 (empty state), 3 (sidebar shape, both breakpoints), and 4
   (catalog grid) for the parts actually in scope.

## Performance Considerations

No new client JS. The only added work is one profile-name lookup per shell
page render (`/dashboard` and `/ustawienia` — `/people` already opens a
Supabase client), the same shape as existing per-page queries. `peopleCount`
is deliberately optional so those two pages add **no** count query on top of
that: one new subrequest per render, not two. This keeps the per-request
subrequest count well inside Cloudflare's free-tier ceiling — worth stating
explicitly because `lessons.md` notes `astro dev` does not enforce those
production limits, so a fast local run is not evidence.

## Migration Notes

No schema or data migration — this pass touches presentation only.

## References

- Design source: `.ai/intouch-design-preparation/project/InTouch.dc.html`
  (sections 2, 3, 4 in scope; sections 5's onboarding/chip UI, 6, 8, 9 out of
  scope per "What We're NOT Doing")
- Prior plan this follows: `context/changes/design-system-foundation/plan.md`
- Data model this respects unchanged: `context/changes/profile-and-first-people/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared tokens

#### Automated

- [x] 1.1 `npm run build` passes — ab2fded
- [x] 1.2 `npm run lint` passes — ab2fded

#### Manual

- [x] 1.3 `shadow-card` utility is available and renders visibly on a test element — ab2fded

### Phase 2: App shell components

#### Automated

- [x] 2.1 `npm run build` passes — cbb11f5
- [x] 2.2 `npm run lint` passes — cbb11f5
- [x] 2.3 `npm run typecheck` passes (if present) — no `typecheck` script exists; ran `npx astro check` instead (0 errors) — cbb11f5

### Phase 3: Migrate dashboard + people into the shell; new Ustawienia stub

#### Automated

- [x] 3.1 `npm run build` passes — 5bf8f5a
- [x] 3.2 `npm run lint` passes — 5bf8f5a

#### Manual

- [ ] 3.3 Sidebar renders on `/dashboard`, `/people`, `/ustawienia`; bottom bar renders on the same three below `lg`
- [ ] 3.4 Active nav item highlights correctly on each of the three pages
- [ ] 3.5 Sign-out works from all three shell pages at both ~1200px (sidebar) and ~390px (`BottomNav` 4th tab)
- [ ] 3.6 `/ustawienia` redirects to `/auth/signin` when signed out
- [ ] 3.7 Signed in with no profile row, the sidebar footer shows the "Uzupełnij profil" prompt + button (never `undefined`)
- [ ] 3.8 `/profile` and `/people/new` remain standalone cards, unaffected

### Phase 4: People catalog grid reskin

#### Automated

- [x] 4.1 `npm run build` passes — 1b8b7c5
- [x] 4.2 `npm run lint` passes — 1b8b7c5

#### Manual

- [ ] 4.3 Empty state unchanged at 0 people
- [ ] 4.4 Grid renders correctly at 1/2/3 columns across breakpoints, including tied-relationship-type and tied-weight cases
- [ ] 4.5 `WeightIndicator` fits visibly inside a grid cell at `lg` width

### Phase 5: Standalone-card polish

#### Automated

- [x] 5.1 `npm run build` passes — 4a25a2e
- [x] 5.2 `npm run lint` passes — 4a25a2e

#### Manual

- [ ] 5.3 Full auth click-through (sign up → confirm-email → sign in → dashboard → sign out) unaffected
- [ ] 5.4 `/profile` and `/people/new` render correctly, unaffected in structure
