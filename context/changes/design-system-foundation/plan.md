# Design System Foundation Implementation Plan

## Overview

Replace the two disconnected visual systems currently in the repo — the unused
shadcn token layer and the starter's hardcoded "cosmic" theme — with a single
token layer derived from the InTouch design bundle (`.ai/intouch-design-preparation/`),
and apply it to every screen that exists in the app today. This closes roadmap
foundation `F-03`.

## Current State Analysis

- `src/styles/global.css` defines a full shadcn token set (`--background`,
  `--primary`, etc. via `oklch()`) plus a `.dark` block, but only
  `src/components/ui/button.tsx` consumes those tokens. Nothing ever toggles
  the `.dark` class.
- Every other screen and component hardcodes the starter's "cosmic" theme:
  `@utility bg-cosmic` (a dark gradient, `global.css:113-115`), `purple-*`,
  `blue-*`, `indigo-*` Tailwind utilities, glassmorphism (`bg-white/10`,
  `backdrop-blur-xl`), and raw hex in `src/components/Banner.astro`. Affected
  files: `Welcome.astro`, `Topbar.astro`, `LibBadge.astro`, `SubmitButton.tsx`,
  `FormField.tsx`, `SignUpForm.tsx` (hint copy), `dashboard.astro`,
  `confirm-email.astro`, `signup.astro`, `signin.astro`.
- `src/components/ui/LibBadge.astro` is dead code — defined, never imported
  anywhere in `src/`.
- `Layout.astro` still has `title = "10x Astro Starter"` as its default and no
  favicon beyond the starter's `favicon.png`.
- A full design bundle now exists at `.ai/intouch-design-preparation/project/InTouch.dc.html`
  (Claude Design handoff): a light, warm pastel palette, 'Instrument Serif'
  (display) + 'Plus Jakarta Sans' (body) typography, a two-circle logo mark,
  and mockups for screens well beyond this foundation's scope (contact
  hierarchy, people catalog, add-person form, reminders, email templates,
  full marketing landing page) — those belong to `S-01`/`S-02`/`S-03`/`S-04`
  and are explicitly out of scope here (see below).

## Desired End State

`src/styles/global.css` defines one light-only token layer (palette, type
scale, radius scale, semantic status colors) sourced from the design bundle.
Every screen that exists in the app today — `Layout.astro`, `index.astro` +
`Welcome.astro`, `dashboard.astro`, the three `auth/*.astro` pages and their
React form components, `Banner.astro`, `Topbar.astro` — renders on that token
layer with no `bg-cosmic`, no `purple-*`/`blue-*`/`indigo-*` utility, and no
raw hex color. `Layout.astro` carries InTouch's own title and an SVG favicon
using the new logo mark. `LibBadge.astro` and the `.dark` block / `bg-cosmic`
utility are deleted.

**Verification**: `npm run build` and `npm run lint` pass; `grep -rn "bg-cosmic\|purple-\|blue-1\|blue-9\|indigo-" src` returns nothing; manual visual check of all 6 existing routes (`/`, `/dashboard`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, and the config-missing `Banner`) confirms the new palette renders correctly at both 1200px desktop and 390px mobile widths.

### Key Discoveries:

- The design bundle's CTA buttons use a dark warm neutral (`#2A2724` /
  `#FBF8F4` text), not a pastel — the pastel hues (rose, amber, green,
  lavender) are reserved for semantic/status meaning only, never for primary
  actions. This maps cleanly onto shadcn's existing `--primary`/`--primary-foreground` pair.
- The mockup has no `.dark` variant anywhere — confirms the earlier decision
  to ship light-only and delete the `.dark` block rather than build it out.
- `Topbar.astro` (`src/components/Topbar.astro`) is only ever imported by
  `Welcome.astro` — it is not a global nav, just the index page's signed-in-status
  bar.
- `SubmitButton.tsx` (`src/components/auth/SubmitButton.tsx:18`) overrides
  `Button`'s own `default` variant with a hardcoded `bg-purple-600` className —
  once `--primary` carries the new token, this override should be removed
  entirely rather than restyled, letting `Button`'s default variant apply.

## What We're NOT Doing

- **Not building the S-01/S-02/S-03/S-04 screens** the design bundle also
  covers: contact hierarchy list, people catalog/categories grid, person
  profile + add-person form, reminder settings, "did it happen?" confirmation,
  or the reminder email template. Those need a data model and real fields that
  don't exist yet (`FR-002`/`FR-003` fields are still unpinned per the
  roadmap). The bundle stays as the visual reference for those slices' own
  plans.
- **Not building the full marketing landing page** from the bundle's section 8
  (problem/how-it-works/for-whom/rules/footer). `index.astro` gets a short,
  restyled hero only — the current placeholder has no traffic to convert yet.
- **Not adding dark mode.** Light-only, per the design bundle and the earlier
  decision.
- **Not building a Storybook or component gallery.**
- **Not touching `components.json`'s `baseColor` field.** The new palette is
  applied by overriding the CSS custom properties `cssVariables: true` already
  points at in `global.css`; the scaffold-time base color choice is irrelevant
  once those variables are hand-authored.
- **Not regenerating `public/favicon.png`.** A new `public/favicon.svg` (the
  logo mark) is added and referenced first; the existing PNG stays as a
  fallback `<link>` for browsers that don't support SVG favicons.

## Implementation Approach

Three phases, each independently buildable and visually checkable:

1. **Tokens & typography** — rewrite `global.css`'s custom properties and
   `@theme inline` block from the design bundle's values, add the two Google
   Fonts, delete the `.dark` block and `bg-cosmic` utility.
2. **Product identity** — a small `Logo` component (two overlapping circles),
   wired into `Layout.astro`'s title/favicon.
3. **Migrate existing screens** — every file listed in Current State Analysis
   moves off hardcoded starter-theme classes onto the new tokens; delete
   `LibBadge.astro`.

Phase 1 is a hard prerequisite for 2 and 3 (both consume the new tokens).
Phases 2 and 3 have no dependency on each other and could run in either order;
they're sequenced 2-then-3 because the logo is needed inside the screens
Phase 3 touches (auth screens' card headers, `Topbar`).

## Critical Implementation Details

**Token naming departs from stock shadcn in three places.** `--input` is
repurposed to mean the input field's *background* (`#FFFFFF`), not a border
tint — stock shadcn convention uses `--input` as a border/ring color, but this
repo's `FormField.tsx` needs a white input surface distinct from the card
background, and the design bundle draws inputs as solid white boxes.
`--muted-foreground` is used for the design's secondary body text tier
(`#6B645C`); a new, non-shadcn token `--color-text-tertiary` (`#8B837A`) is
added for the lighter meta/timestamp tier the design also uses, since shadcn's
default set has no third text tier. Finally, the radius scale changes from a
single derived `--radius` (`calc()`-based `sm`/`md`/`lg`/`xl`) to explicit
per-step values, because the design uses genuinely different radii per
context rather than a mathematically derived scale — `Phase 1`'s Contract
below is the authoritative source for exact values.

## Phase 1: Design tokens & typography foundation

### Overview

Replace `src/styles/global.css`'s token layer end-to-end: new light-only
palette, semantic status colors, an explicit radius scale, and a serif
display / sans body type system, sourced from
`.ai/intouch-design-preparation/project/InTouch.dc.html`. Remove the `.dark`
block and the `bg-cosmic` utility.

### Changes Required:

#### 1. Token layer rewrite

**File**: `src/styles/global.css`

**Intent**: Replace every `:root` custom property with the design bundle's
values, delete `.dark` entirely (light-only per decision), delete
`@utility bg-cosmic`, and extend `@theme inline` so the new tokens are usable
as Tailwind utilities (`bg-background`, `text-foreground`, `rounded-2xl`,
`font-display`, etc.). Add the two Google Fonts `@import` (or rely on the
`<link>` tags added in Phase 2's `Layout.astro` change — pick one loading
mechanism and use it consistently, not both).

**Contract**: The following values are the plan's authoritative palette,
radius, and status-color contract — every later phase and every future screen
built on this foundation reads colors and radii from these names, not from
raw hex.

| Token | Value | Design bundle source |
| --- | --- | --- |
| `--background` | `#EFE9E1` | page background |
| `--foreground` | `#2A2724` | primary text |
| `--card`, `--popover` | `#FBF8F4` | card / modal surface |
| `--card-foreground`, `--popover-foreground` | `#2A2724` | — |
| `--primary` | `#2A2724` | CTA button fill (dark neutral, not a pastel) |
| `--primary-foreground` | `#FBF8F4` | CTA button text |
| `--secondary` | `#FFFFFF` | secondary/outline button surface |
| `--secondary-foreground` | `#2A2724` | — |
| `--muted` | `#F3EDE5` | sidebar / subtle section background |
| `--muted-foreground` | `#6B645C` | secondary body text |
| `--color-text-tertiary` (new, non-shadcn) | `#8B837A` | meta text / timestamps / eyebrow labels |
| `--accent` | `#E9DFEE` | lavender — selected/active state (nav item, chosen chip) |
| `--accent-foreground` | `#55446B` | — |
| `--border`, `--input` (border use) | `#E4DCD1` | card/input borders |
| `--input` (background use — see Critical Implementation Details) | `#FFFFFF` | input field surface |
| `--ring` | `#B8C0E4` | focus ring (lavender-tinted, from the mockup's selected-day-1 field) |
| `--destructive` | `#B3453D` | new — warm brick red, distinct from the rose urgency color |
| `--destructive-foreground` | `#FBF8F4` | — |
| `--color-success` / `--color-success-bg` | `#4A6B52` / `#D9E8DC` | green — confirmed contact, calm state |
| `--color-warning` / `--color-warning-bg` | `#8A6A34` / `#F5E7CE` | amber — relationship going quiet, medium urgency |
| `--color-urgent` / `--color-urgent-bg` | `#8C4A52` / `#F7D9DC` | rose — highest-urgency suggestion badge |
| `--radius-sm` | `0.625rem` (10px) | small controls |
| `--radius` (default) | `0.875rem` (14px) | buttons, inputs |
| `--radius-md` | `1rem` (16px) | nested content boxes |
| `--radius-lg` | `1.125rem` (18px) | secondary cards |
| `--radius-xl` | `1.25rem` (20px) | larger cards |
| `--radius-2xl` | `1.5rem` (24px) | primary containers (auth card, dashboard panel) |
| `--radius-full` | `999px` | pills, badges |
| `--font-display` | `'Instrument Serif', serif` | headings |
| `--font-sans` | `'Plus Jakarta Sans', system-ui, sans-serif` | body / UI text, replaces Tailwind's default sans |
| `--text-display-xl` | `3.875rem` (62px) | landing hero only |
| `--text-display-lg` | `2.75rem` (44px) | large CTA headline |
| `--text-display-md` | `2.375rem` (38px) | page headline (e.g. dashboard) |
| `--text-display-sm` | `1.875rem` (30px) | card/modal headline (auth screens) |
| `--text-display-xs` | `1.3125rem` (21px) | small wordmark lockup |

`--chart-*` and `--sidebar-*` tokens are unused anywhere in the app today
(`grep -rn "chart-\|sidebar-" src` returns nothing outside `global.css`
itself) — leave them as harmless unused shadcn scaffolding rather than
inventing values for them.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Lint passes: `npm run lint`
- No leftover starter-theme artifacts in the token file: `grep -n "bg-cosmic\|oklch" src/styles/global.css` returns nothing

#### Manual Verification:

- `src/components/ui/button.tsx`'s existing variants (default, outline, secondary, destructive) render with the new colors when checked on any page that renders a `<Button>` (e.g. `/auth/signin`)
- Both fonts load (checked via browser dev tools' Network/Fonts panel — 'Instrument Serif' and 'Plus Jakarta Sans' present, no FOUT flash to a generic serif/sans fallback for more than a moment)

---

## Phase 2: Logo & product identity

### Overview

Add the InTouch logo mark (two overlapping circles, `mix-blend-mode: multiply`)
as a reusable component, and give `Layout.astro` the product's own title and
favicon.

### Changes Required:

#### 1. Logo component

**File**: `src/components/Logo.astro`

**Intent**: A small, reusable mark matching the design bundle's logo section —
two overlapping circles (rose `#F3C7CD` left, lavender `#C6CDEE` right,
`mix-blend-mode: multiply`), with an optional serif "InTouch" wordmark next to
it. Used in the auth cards' headers and `Topbar.astro` in Phase 3.

**Contract**: `Logo.astro` accepts `size` (px, controls circle diameter — the
design bundle uses 24px in sidebars/nav, 26–30px in card headers, 40–50px in
hero contexts) and `withWordmark` (boolean, default `false`) props. When
`withWordmark` is true, render the "InTouch" text in `--font-display` at a
proportional size next to the mark.

#### 2. Product identity in Layout

**File**: `src/layouts/Layout.astro`

**Intent**: Replace the starter's default title and add InTouch's favicon.

**Contract**: `Props.title` default changes from `"10x Astro Starter"` to
`"InTouch"`. Add `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
before the existing PNG favicon link (SVG-capable browsers prefer the first
matching `<link>`; the PNG stays as fallback for browsers that don't support
SVG favicons). Add the Google Fonts `<link>` tags for 'Instrument Serif'
(ital 0;1, since the design bundle loads the italic axis) and 'Plus Jakarta
Sans' (weights 400;500;600;700) with the matching `preconnect` links, mirroring
the `<helmet>` block in `InTouch.dc.html:10-14` — unless Phase 1 already
handles font loading via CSS `@import`, in which case skip this and note which
mechanism was chosen.

#### 3. Favicon asset

**File**: `public/favicon.svg`

**Intent**: A static SVG file containing the same two-circle mark as
`Logo.astro`, sized for favicon use (viewBox around 32×32, matching the
design bundle's "favicon 32 px — sam znak, bez sygnatury" note).

**Contract**: Standalone SVG, no external font dependency (favicons render
before web fonts load), two circles only, no wordmark.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Lint passes: `npm run lint`
- `public/favicon.svg` exists and is valid XML: `xmllint --noout public/favicon.svg` (or equivalent parse check)

#### Manual Verification:

- Browser tab shows the new favicon on any page
- Page `<title>` reads "InTouch" (or a page-specific title) instead of "10x Astro Starter" — check via browser tab text or view-source
- `Logo` renders correctly at both a small size (e.g. 24px, as it will appear in `Topbar`) and a larger size (e.g. 40px, as in the auth card headers)

---

## Phase 3: Migrate existing screens off the starter theme

### Overview

Every screen and component that currently renders the starter's "cosmic"
theme moves onto the Phase 1 tokens and the Phase 2 logo. Dead code
(`LibBadge.astro`) is deleted.

### Changes Required:

#### 1. Shared chrome

**File**: `src/components/Banner.astro`

**Intent**: Replace the three variants' raw hex colors with token-based
equivalents — `info` maps to the `accent` (lavender) pair, `warning` to the
new `--color-warning`/`--color-warning-bg` pair, `error` to
`--destructive`/`--destructive-foreground` with a tinted background (matching
the existing `bg-destructive/10`-style pattern already used in
`button.tsx:14`).

**Contract**: Same `variant` prop API (`"info" | "warning" | "error"`), same
slot-based content — only the `<style>` block's hardcoded hex values change.

**File**: `src/components/Topbar.astro`

**Intent**: Replace `purple-300`/`blue-100/70`/`white/10` utilities with
`--card`/`--border`/`--foreground`/`--accent-foreground` tokens, and swap the
current inline circle placeholder for the new `Logo` component.

**Contract**: Same structure (email/status on the left, nav links on the
right), no prop changes.

#### 2. Existing pages

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the `bg-cosmic` + glassmorphism panel with the new
`--background`/`--card`/`--foreground` tokens and the standard `--radius-2xl`
container radius. Replace the hand-rolled sign-out `<button>` classes with the
`Button` component (`variant="outline"` or `"secondary"`).

**Contract**: Same route, same `Astro.locals.user` usage, same sign-out form
action.

**File**: `src/pages/index.astro` + `src/components/Welcome.astro`

**Intent**: Per the confirmed scope, this is a short restyled hero — not the
bundle's full landing page. Replace the cosmic gradient background, orb
decorations, and starter marketing copy ("10x Astro Starter", "cosmic
developer experience", the three feature cards) with: the `Logo` component,
an InTouch-specific one-line description, and the existing sign-in/sign-up
CTAs restyled onto the new `Button` variants. `Topbar` stays as the
signed-in-status bar, restyled per above.

**Contract**: `Welcome.astro` keeps its current props-free shape and stays the
sole child of `index.astro`'s `<Layout>`.

**Files**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`,
`src/pages/auth/confirm-email.astro`

**Intent**: Replace the `bg-cosmic` + glass card wrapper with
`--background`/`--card`/`--radius-2xl`, replace the gradient-text heading with
`--font-display` + `--foreground`, and add the `Logo` component above each
heading (matching the design bundle's card header pattern).

**Contract**: Same routes, same server-error query-param handling, same
`<SignInForm>`/`<SignUpForm>` mounting with `client:load`.

#### 3. Auth form components

**Files**: `src/components/auth/FormField.tsx`, `SubmitButton.tsx`,
`ServerError.tsx`, `PasswordToggle.tsx`

**Intent**: `FormField`'s `inputBase` moves from `bg-white/10`/`border-white/20`
to `bg-input`/`border-border` with `focus:ring-ring`; its error state uses
`--destructive` instead of `red-400`. `SubmitButton` drops its hardcoded
`bg-purple-600` className override entirely, letting `Button`'s restyled
`default` variant apply (see Key Discoveries). `ServerError` moves from
`red-900/30`/`red-500/30`/`red-300` to `--destructive`-based tokens
(`bg-destructive/10 border-destructive/30 text-destructive`, consistent with
`button.tsx`'s existing opacity-modifier pattern). `PasswordToggle` moves
`white/40` to `--color-text-tertiary` (or `muted-foreground`, whichever reads
correctly against the new light card background).

**Contract**: No prop or behavior changes to any of the four components —
purely class-level token substitution.

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: No visual change beyond what `FormField` already carries; verify
the password-length hint text (`SignUpForm.tsx:64`, currently `text-blue-100/50`)
also moves to a token.

**Contract**: Same validation logic, same field set.

#### 4. Dead code removal

**File**: `src/components/ui/LibBadge.astro`

**Intent**: Delete — confirmed unused anywhere in `src/` (`grep -rn "LibBadge" src` matches only its own definition).

**Contract**: File removed; no import sites to update.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Lint passes: `npm run lint`
- No starter-theme utility remains anywhere in `src/`: `grep -rn "bg-cosmic\|purple-\|blue-1\|blue-9\|indigo-" src` returns nothing
- `LibBadge.astro` no longer exists: `test ! -f src/components/ui/LibBadge.astro`

#### Manual Verification:

- All 6 routes (`/`, `/dashboard`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, and the config-missing-vars `Banner` — toggle by unsetting a Supabase env var locally) render on the new palette with no leftover dark/cosmic styling, at both ~1200px desktop and ~390px mobile widths
- Sign-in and sign-up forms are fully usable: typing, validation errors, password-visibility toggle, and submit all still work
- No regression in the auth flow itself (sign in, sign up, sign out, confirm-email) — only visual changes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None required — this change has no business logic, only markup/class/token changes. No existing test suite covers UI styling in this repo.

### Integration Tests:

- None — covered by the manual verification above (auth flow still functions).

### Manual Testing Steps:

1. Run `npm run dev`, visit `/` — confirm new hero, logo, and CTAs render, no cosmic gradient.
2. Visit `/auth/signup`, create a test account — confirm the form is usable and styled with new tokens.
3. Visit `/auth/confirm-email` — confirm the emoji/heading/description card matches the new style.
4. Sign in at `/auth/signin`, land on `/dashboard` — confirm the dashboard panel and sign-out button use new tokens.
5. Sign out, confirm redirect/state resets correctly.
6. Temporarily unset `SUPABASE_URL` in `.dev.vars` (revert after) to trigger `Banner`'s error state — confirm it renders with the new destructive tokens instead of raw hex.
7. Resize the browser to ~390px width and repeat steps 1–4 to confirm mobile rendering matches the design bundle's mobile mockups.

## Performance Considerations

None — this is a CSS/markup-only change with no new runtime dependencies
(Google Fonts are loaded via `<link>`/`@import`, same mechanism the design
bundle itself uses; no font files are bundled into the Worker).

## Migration Notes

Not applicable — no data model, no persisted state affected.

## References

- Design source: `.ai/intouch-design-preparation/project/InTouch.dc.html`
- Roadmap item: `context/foundation/roadmap.md` — `F-03: Design system and product identity`
- Existing token layer: `src/styles/global.css`
- Existing primitive to follow: `src/components/ui/button.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Design tokens & typography foundation

#### Automated

- [x] 1.1 Build succeeds: `npm run build` — e3a00ab
- [x] 1.2 Lint passes: `npm run lint` — e3a00ab
- [x] 1.3 No leftover starter-theme artifacts in the token file — e3a00ab

#### Manual

- [x] 1.4 Button variants render with new colors — e3a00ab
- [x] 1.5 Both fonts load correctly — e3a00ab

### Phase 2: Logo & product identity

#### Automated

- [x] 2.1 Build succeeds: `npm run build` — 3dd7e42
- [x] 2.2 Lint passes: `npm run lint` — 3dd7e42
- [x] 2.3 `public/favicon.svg` exists and is valid XML — 3dd7e42

#### Manual

- [x] 2.4 Browser tab shows new favicon — 3dd7e42
- [x] 2.5 Page title reads "InTouch" — 3dd7e42
- [x] 2.6 Logo renders correctly at small and large sizes — 3dd7e42

### Phase 3: Migrate existing screens off the starter theme

#### Automated

- [x] 3.1 Build succeeds: `npm run build`
- [x] 3.2 Lint passes: `npm run lint`
- [x] 3.3 No starter-theme utility remains anywhere in `src/`
- [x] 3.4 `LibBadge.astro` no longer exists

#### Manual

- [x] 3.5 All 6 routes render on new palette at desktop and mobile widths
- [x] 3.6 Sign-in/sign-up forms fully usable
- [x] 3.7 No regression in auth flow
