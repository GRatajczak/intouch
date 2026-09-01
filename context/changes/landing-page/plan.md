# Public Landing Page Implementation Plan

## Overview

`/` is the first thing every prospect meets, and today it renders a four-element hero:
logo, one headline, one paragraph, two auth buttons (`src/components/Welcome.astro:1-27`).
The finished design already contains a complete seven-section marketing page for this
route — hero with a product preview, problem statement, four-step how-it-works, who-it's-for,
stated principles, closing CTA, footer — written in InTouch's own voice, in Polish, on the
exact palette the product already ships.

This plan transcribes `.ai/intouch-design-preparation/project/InTouch.dc.html:852-1046`
into a real page at `/`, built from section components on the existing `F-03` token layer,
fully responsive, with every link on the page pointing at something that exists.

## Current State Analysis

**The roadmap's premise is partly stale.** `S-06` describes `/` as rendering "the
10x-astro-starter's placeholder `Welcome` component". It does not — `F-03` already reskinned
`Welcome.astro` onto the new tokens with InTouch copy. The gap is not a wrong palette, it is
a missing page: what stands there is correct-looking and roughly 5% of the designed content.

**The token layer is already this design's palette.** `src/styles/global.css:16-71` carries
`#efe9e1` (`--background`), `#fbf8f4` (`--card`), `#2a2724` (`--foreground`/`--primary`),
`#e4dcd1` (`--border`), `#f3ede5` (`--muted`), `#6b645c` (`--muted-foreground`), `#8b837a`
(`--color-text-tertiary`), all five pastel swatches (`--color-swatch-*`), the urgency/warning/
success pairs, `--font-display: "Instrument Serif"`, `--shadow-card`, and a `--text-display-*`
scale. Every colour in the landing mock resolves to one of these — with the two exceptions
noted under Key Discoveries. **No `.dark` token block exists**, so roadmap Open Questions 6
(palette) and 7 (dark mode) are already closed by `F-03`; this slice inherits them and decides
nothing about them.

**The type scale lines up almost exactly.** Mock hero 62px = `--text-display-xl` (3.875rem);
mock closing headline 44px = `--text-display-lg` (2.75rem); mock section headings 40px vs
`--text-display-md` 2.375rem/38px (a 2px difference, absorbed); mock nav wordmark 24px and
section eyebrow 12px uppercase.

**`Logo.astro` already renders the mark** the landing uses in its nav and closing CTA — two
overlapping circles with `mix-blend-mode: multiply`, arbitrary size, optional wordmark
(`src/components/Logo.astro:1-33`).

**`/` is public and stays public.** `middleware.ts:4` lists only `/dashboard`, `/profile`,
`/people`, `/settings` as protected. The middleware does populate `context.locals.user` on
every route, including `/`, so the page can read auth state without any middleware change.

**No test framework exists in this repo.** Verification across every prior slice has been
`npm run lint`, `npx astro check`, `npm run build`, plus manual review. This plan does not
introduce one — a static marketing page is the worst possible place to start.

## Desired End State

An unauthenticated visitor opening `/` sees the full designed marketing page: a header with
the InTouch mark and three anchor links plus a "Zacznij" button; a hero pairing the headline
"Bliscy nie znikają nagle. Znikają po cichu." with a preview of a ranked Monday; a three-card
problem band; four numbered steps; a dark "Dla kogo" band with three audience cards; four
principle cards; a centred closing CTA; and a footer carrying the tagline. Every link works —
the three nav links scroll to their sections, all primary CTAs land on `/auth/signup`, the
hero's secondary CTA scrolls to "Jak to działa". The page reads correctly from 360px to
1440px+. A signed-in visitor never sees it; they are sent to `/dashboard`.

Verified by: `npm run build` succeeding, `npx astro check` clean, `npm run lint` clean, and a
manual pass at three widths plus a keyboard-only traversal.

### Key Discoveries:

- `src/components/Welcome.astro` and `src/components/Topbar.astro` are imported by nothing
  except `src/pages/index.astro:2` and `Welcome.astro:2` respectively (grep-verified across
  `src/`). Both become dead code the instant this page ships.
- The mock's outermost element is a 1200px-wide, 24px-radius, bordered, shadowed card
  (`InTouch.dc.html:858`). **That is artboard chrome, not page chrome** — it is how every
  other artboard in the file frames its screen. The real page is full-bleed: each section
  becomes a full-width band with its own background, and content is centred in a
  max-width container.
- The mock's nav sets mark and wordmark to the same 24px (`InTouch.dc.html:861-866`), but
  `Logo.astro:12` hardcodes `wordmarkSize = size * 1.28` — a ratio taken from the design's
  own title block (50px mark / 64px wordmark, `InTouch.dc.html:27-31`). The landing nav is
  the first consumer that wants 1:1, so `Logo` needs an override rather than a fork.
- `Button`'s largest size is `lg` = `h-10` (40px) at `rounded-md` (`button.tsx:24`). The
  landing's three primary CTAs are 54px tall at 14px radius; its nav CTA is 42px at 12px.
  40px covers the nav CTA within 2px; 54px does not exist and must be added.
- `Button` renders fine in `.astro` with no client directive — `Welcome.astro:18-23` already
  does `<Button asChild size="lg"><a …>`, server-rendered, zero hydration. The landing has no
  interactive state at all, so nothing on this page hydrates.
- Two mock colours have no token: the dark band's raised cards `#3a3530`
  (`InTouch.dc.html:981`) and its dimmed body text `#b5ada3` / eyebrow `#a39a90`. All three
  are `--primary` (`#2a2724`) or `--primary-foreground` (`#fbf8f4`) shifted by a small amount
  of the other — expressible as opacity over `bg-primary` without adding tokens.
- `astro.config.mjs:12` already registers `@astrojs/sitemap` against a real `site`, so `/`
  is already in the sitemap. Nothing to add.
- `Layout.astro:20-26` already preloads and links both `Instrument Serif` and
  `Plus Jakarta Sans` — the landing needs no additional font work.
- The mock contains a typo: "Dla ludzi, którym zależy na swoich najbliższych **osobac**"
  (`InTouch.dc.html:978`), missing a trailing `h`.

## What We're NOT Doing

- No privacy policy, terms, or contact page. The footer's link row is dropped rather than
  pointed at routes that do not exist.
- No CMS, no blog, no second marketing page, no A/B testing, no analytics.
- No dark-mode variant. `F-03` shipped light-only and this page follows it.
- No new design tokens. Everything resolves to `global.css` as it stands, or to an opacity
  over an existing token.
- No changes to `middleware.ts`. The signed-in redirect lives on the page.
- No test framework, no new npm dependency.
- No OG image asset. The metadata work adds the tags and a text-only preview; producing an
  image is a separate design task.
- No reuse of this page's components anywhere else. `AppShell` and its sidebar/bottom-nav stay
  untouched — the landing is outside the app shell entirely, exactly as the mock shows.

## Implementation Approach

Build bottom-up: three small edits to shared components first (Phase 1), because the page's
markup depends on all three and discovering their shape mid-page would mean rewriting sections
already written. Then the page shell plus the two most structurally distinctive sections
(Phase 2), which gets a real, viewable `/` early. Then the four middle content bands
(Phase 3), which are largely card grids and share one shape. Then the closing pair plus a
whole-page verification sweep (Phase 4).

Each section is a separate `.astro` file under `src/components/landing/`, mirroring how
`src/components/layout/` splits `AppShell` / `AppSidebar` / `BottomNav`. Note that
`lessons.md`'s "folder with types.ts and barrel index" rule is scoped to **React** components;
these are `.astro` files with no props and no prop types, so they are flat files in one folder,
matching `src/components/layout/`.

Responsive behaviour is built into each section as it is written, not bolted on at the end.
The mock's fixed 1200px grid becomes: a `max-w-6xl` centred container, `px-5` on mobile rising
to `px-14` at `lg`, and every multi-column grid collapsing to one column below `md` (the 4-up
step grid passing through 2-up at `md`).

## Critical Implementation Details

**`/` must never be added to `PROTECTED_ROUTES`.** `middleware.ts:22` matches with
`startsWith`, so the string `"/"` would protect every route in the application and lock out
the auth pages. The signed-in redirect belongs in `index.astro`'s frontmatter, reading the
`Astro.locals.user` that middleware has already populated.

**Anchor scrolling and reduced motion.** The mock's header is a static band, not sticky, so
anchors need no scroll offset compensation. Smooth scrolling must be wrapped in a
`prefers-reduced-motion: no-preference` guard — an unguarded `scroll-behavior: smooth` on a
page this tall is a vestibular trigger.

**The dark band inverts the page's foreground/background pair.** Inside
`LandingAudience`, `--primary` is the surface and `--primary-foreground` is the text —
the reverse of everywhere else. Anything relying on the `@layer base` default (`body` gets
`bg-background text-foreground`) will be wrong inside it, so colour is set explicitly on
that section rather than inherited.

---

## Phase 1: Shared surface prep

### Overview

Three small, independent edits to existing shared components, each of which the landing markup
depends on. No visible change to any current screen.

### Changes Required:

#### 1. Page metadata

**File**: `src/layouts/Layout.astro`

**Intent**: The landing is the page that gets pasted into a chat window, and today a paste
renders a bare URL. Add optional description and social-card metadata so the landing can
supply real values while every existing page keeps working unchanged.

**Contract**: `Props` gains `description?: string` and `ogImage?: string`. The `<head>` gains
`<meta name="description">`, the Open Graph quartet (`og:title`, `og:description`, `og:type`,
`og:url`) and `<meta name="twitter:card" content="summary_large_image">`, each rendered only
when a value is present so pages passing nothing emit nothing new. `og:url` derives from
`Astro.url`; the existing `site` in `astro.config.mjs:10` makes that absolute. `ogImage` is
accepted but no default asset is supplied — the tag is omitted until one exists.

#### 2. Logo wordmark ratio

**File**: `src/components/Logo.astro`

**Intent**: The landing nav wants a 24px mark beside a 24px wordmark; `Logo` currently forces
the wordmark to 1.28× the mark. Make the ratio overridable so the landing uses the same
component as the rest of the app rather than reimplementing the mark.

**Contract**: `Props` gains `wordmarkSize?: number`. When absent, the existing `size * 1.28`
applies, so `signin.astro`, `signup.astro`, `AppSidebar` and every other current caller renders
byte-identically.

#### 3. Extra-large button size

**File**: `src/components/ui/button.tsx`

**Intent**: The landing's three primary CTAs are 54px tall with a 14px radius and 16px
semibold text — taller than any existing size.

**Contract**: Add an `xl` entry to `buttonVariants`' `size` variants: 54px height, horizontal
padding matching the mock's 28-30px, `text-base`, `font-semibold`, and the 14px radius that
`--radius` already defines. The four existing sizes and both `defaultVariants` are untouched.
The landing's 42px nav CTA uses the existing `lg` (40px) — a 2px difference not worth a
second variant.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `/auth/signin`, `/auth/signup`, `/dashboard` and `/people` render visually unchanged — no
  caller of `Logo`, `Button` or `Layout` shifted
- Page source of an existing page shows no new empty `<meta>` tags

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 2: Page shell, navigation and hero

### Overview

Stand up `/` as the real landing page and deliver its two most structurally distinctive
sections. At the end of this phase `/` shows the designed header and hero and nothing else,
and the two starter-era components are gone.

### Changes Required:

#### 1. The route

**File**: `src/pages/index.astro`

**Intent**: Replace the `Welcome` wrapper with the landing composition, and send signed-in
visitors to the app instead of a signup pitch.

**Contract**: Frontmatter redirects to `/dashboard` when `Astro.locals.user` is set, before
rendering anything. Renders `Layout` with a landing-specific `title` and the new `description`
prop, wrapping the landing sections in document order. **`middleware.ts` is not edited** — see
Critical Implementation Details.

#### 2. Header

**File**: `src/components/landing/LandingNav.astro`

**Intent**: The page's top band — mark plus wordmark on the left, three section links and the
primary CTA on the right. Transcribes `InTouch.dc.html:860-874`.

**Contract**: Non-sticky band with a bottom border. `Logo` at `size={24} withWordmark
wordmarkSize={24}`. Three anchors to `#jak-to-dziala`, `#dla-kogo` and `#zasady` — the third
labelled "Prywatność" per the design, targeting the principles section where the privacy
promise is actually written. `Button size="lg" asChild` wrapping an `<a href="/auth/signup">`
labelled "Zacznij". Below `md` the three text anchors are hidden and only mark + CTA remain;
no hamburger menu, since the anchors' targets are the sections the visitor is about to scroll
through anyway.

#### 3. Hero

**File**: `src/components/landing/LandingHero.astro`

**Intent**: The page's opening claim and its two CTAs, paired with a static preview of what a
ranked Monday looks like. Transcribes `InTouch.dc.html:876-914`.

**Contract**: Two-column at `lg` (copy left, preview right at a fixed 420px), single column
stacked below with the preview following the copy. Headline in `font-display` at
`text-display-xl`, fluid down on small viewports. Primary CTA `Button size="xl"` → `/auth/signup`
labelled "Dodaj pierwsze osoby"; secondary CTA `variant="outline" size="xl"` → `#jak-to-dziala`
labelled "Zobacz, jak to wygląda". Reassurance line beneath in `--color-text-tertiary`.

The preview card is inert, non-interactive markup reproducing the mock verbatim: eyebrow
"TWÓJ PONIEDZIAŁEK W INTOUCH"; a featured card for "Rodzina z gór" with rank badge, "cisza od
12 miesięcy", a "ten tydzień" chip and the reason box; two compact rows for "Maciej" and
"Kasia"; and the closing "pozostałe 11 osób jest spokojnych" line. Rank badges and chips use
the existing `--color-urgent{,-bg}`, `--color-warning{,-bg}` and `--color-success{,-bg}`
pairs — the same tokens the real `S-02` hierarchy will use. It carries `aria-hidden="true"`:
it is decorative illustration of a feature that does not exist yet, and its fake names and
counts are noise to a screen reader that has just heard the headline.

#### 4. Retire the starter hero

**Files**: `src/components/Welcome.astro`, `src/components/Topbar.astro`

**Intent**: Both become unreachable once `index.astro` stops importing `Welcome`. Delete them
rather than leave two plausible-looking hero/nav components that render nowhere.

**Contract**: Both files deleted. Grep confirms no other importer; `AppSidebar` already
provides the signed-in email and signout affordance that `Topbar` carried.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- No references remain: `grep -rn "Welcome\|Topbar" src/` returns nothing

#### Manual Verification:

- `/` renders the designed header and hero, matching `InTouch.dc.html:860-914` at 1200px
- Hero stacks correctly at 390px with no horizontal scroll, and the preview card is legible
- "Zacznij" and "Dodaj pierwsze osoby" both land on `/auth/signup`
- Visiting `/` while signed in lands on `/dashboard`; while signed out, the page renders
- Link-preview metadata is present in page source (`description`, `og:title`, `og:url`)

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 3: Middle content bands

### Overview

The four sections between hero and close. All are heading-plus-grid; the variation is in
column count, background and — for one — an inverted colour scheme.

### Changes Required:

#### 1. Problem statement

**File**: `src/components/landing/LandingProblem.astro`

**Intent**: Name the problem the product solves, in three cards. Transcribes
`InTouch.dc.html:915-940`.

**Contract**: Full-width band on `--muted` with top and bottom borders. Eyebrow "PROBLEM",
`font-display` heading at `text-display-md`, then a 3-up grid of cards on `--card` with a
small rounded swatch tile each (family pink, friend blue, other green — the existing
`--color-swatch-*` tokens). Grid collapses to one column below `md`.

#### 2. How it works

**File**: `src/components/landing/LandingHowItWorks.astro`

**Intent**: The four steps, with the anchor target the nav and the hero's secondary CTA both
point at. Transcribes `InTouch.dc.html:941-971`.

**Contract**: `id="jak-to-dziala"` on the section element. Band on `--background`, eyebrow
"JAK TO DZIAŁA", `font-display` heading. Four columns at `lg`, two at `md`, one below; each
step is a 4px coloured rule, a two-digit number, a bold title and body copy. The four rule
colours are the swatch tokens in the mock's order (pink, blue, purple, green).

#### 3. Who it's for

**File**: `src/components/landing/LandingAudience.astro`

**Intent**: The dark band naming the audience and ruling out the ones this is not for.
Transcribes `InTouch.dc.html:972-994`.

**Contract**: `id="dla-kogo"`. Band on `bg-primary` with `text-primary-foreground` set
explicitly — see Critical Implementation Details. Two columns at `lg` (copy left, three
audience cards right), stacked below. The raised cards and the dimmed body/eyebrow text use
opacity over the two primary tokens rather than the mock's untokenised `#3a3530` / `#b5ada3` /
`#a39a90`. **The heading's copy is corrected** to "…na swoich najbliższych osobach"; the mock
drops the final `h`.

#### 4. Principles

**File**: `src/components/landing/LandingPrinciples.astro`

**Intent**: The four product promises — including the privacy promise the nav's third link
points at. Transcribes `InTouch.dc.html:995-1019`.

**Contract**: `id="zasady"`. Band on `--background`, eyebrow "ZASADY, KTÓRYCH SIĘ TRZYMAMY",
`font-display` heading, then a 2-up grid of four bordered cards, collapsing to one column
below `md`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- All four bands match `InTouch.dc.html:915-1019` at 1200px, including band backgrounds and
  the border seams between them
- Each grid collapses cleanly at `md` and at 390px with no clipped or overflowing card
- The dark band's text is legible against its background at every card and eyebrow
- Clicking the nav's three links scrolls to the correct section

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 4: Close, footer and whole-page sweep

### Overview

The last two sections, then a verification pass across all seven — the point at which the
invented mobile layout, the anchor behaviour and the keyboard path are checked as one page
rather than seven pieces.

### Changes Required:

#### 1. Closing call to action

**File**: `src/components/landing/LandingClosing.astro`

**Intent**: The page's final ask, centred, with the mark repeated above it. Transcribes
`InTouch.dc.html:1020-1028`.

**Contract**: Band on `--muted` with a top border, centre-aligned. `Logo size={40}` with no
wordmark, `font-display` heading at `text-display-lg` capped to a readable measure, supporting
line, and a `Button size="xl"` → `/auth/signup` labelled "Zacznij".

#### 2. Footer

**File**: `src/components/landing/LandingFooter.astro`

**Intent**: Close the page with the mark and tagline. Transcribes
`InTouch.dc.html:1029-1044`, minus its link row.

**Contract**: Bordered top, `Logo size={18}` and the tagline "InTouch · bądź blisko bez
pilnowania" in `--color-text-tertiary`. **The mock's Prywatność / Regulamin / Kontakt row is
omitted** — no such page exists, and a footer of dead links is worse than a quiet one. On
mobile the row stacks.

#### 3. Anchor scrolling

**File**: `src/pages/index.astro` (or `src/styles/global.css` if the rule is better placed
there — the implementer's call, but it must not apply to app screens if global)

**Intent**: Make the four in-page anchors scroll smoothly, without triggering motion sickness.

**Contract**: `scroll-behavior: smooth` applied to the landing's root, wrapped in
`@media (prefers-reduced-motion: no-preference)`. A small `scroll-margin-top` on the three
anchor targets so a heading is not flush against the viewport edge on arrival.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- The full page matches `InTouch.dc.html:852-1046` end to end at 1200px, section order and
  band backgrounds included
- The page reads correctly at 360px, 768px and 1440px, with no horizontal scroll at any width
- Every link and button resolves: three primary CTAs → `/auth/signup`, four anchors → their
  sections, no dead links anywhere on the page
- Keyboard-only traversal reaches every interactive element in visual order, with a visible
  focus ring on each
- Smooth scrolling is suppressed when the OS "reduce motion" setting is on
- The preview card is skipped by a screen reader; the surrounding copy is not
- Signed-in redirect to `/dashboard` still holds after all sections are in place

**Implementation Note**: This is the final phase. After manual confirmation, the roadmap item
`S-06` and its Linear issue move to done per `lessons.md`'s status-mirroring rule.

---

## Testing Strategy

There is no test framework in this repo and this plan does not add one — a static marketing
page with no state, no data access and no user input is the wrong place to introduce one.
Verification is the three automated commands plus a structured manual pass.

### Automated:

- `npx astro check` — type errors, including the new `Layout` and `Logo` props
- `npm run lint` — ESLint with `eslint-plugin-jsx-a11y` and the Astro plugin, which is the
  repo's only automated accessibility signal
- `npm run build` — catches broken imports and adapter-level failures the dev server tolerates

### Manual Testing Steps:

1. Sign out, open `/`, and read the whole page top to bottom at 1200px against the mock.
2. Resize to 768px and 360px; confirm every grid collapses, nothing overflows, and the hero
   preview card stays legible.
3. Click all three nav anchors and the hero's secondary CTA; confirm each lands on its section.
4. Click all three primary CTAs; confirm each reaches `/auth/signup`.
5. Tab through the page from the top; confirm focus order matches reading order and every stop
   has a visible ring.
6. Turn on the OS reduce-motion setting, click an anchor, confirm the jump is instant.
7. Sign in, navigate to `/`, confirm the redirect to `/dashboard`.
8. Spot-check `/auth/signin`, `/dashboard` and `/people` for regressions from the Phase 1
   shared-component edits.

## Performance Considerations

The page hydrates nothing — every component is `.astro`, and the two `Button` usages render
server-side through `asChild` exactly as `Welcome.astro:18-23` does today. There is no image
on the page: the mark is two CSS circles and every illustration is markup. Per-request work is
one `Astro.locals.user` read that middleware has already performed, so the
`astro dev does not enforce Cloudflare's production limits` lesson does not bite here — this
page's CPU cost is rendering static markup.

## Migration Notes

Not applicable — no schema change, no data, no stored state. The only removal is two unused
components, recoverable from git history.

## References

- Design handoff: `.ai/intouch-design-preparation/project/InTouch.dc.html:852-1046`
  (section "8 — Landing page")
- Roadmap item: `context/foundation/roadmap.md` → `### S-06: Public landing page`; this plan
  closes its Open Question 8 (both halves)
- Token layer this page renders on: `src/styles/global.css:6-71` (`F-03`)
- Multi-file Astro component precedent: `src/components/layout/AppShell.astro` +
  `AppSidebar.astro` + `BottomNav.astro` (`F-05`)
- Server-rendered `Button asChild` precedent: `src/components/Welcome.astro:18-23`
- Rules applied: `context/foundation/lessons.md` — English routes/Polish copy; React-component
  folder rule scoped to React and therefore not applied to these `.astro` files; Linear
  status mirroring on completion

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared surface prep

#### Automated

- [x] 1.1 Type checking passes: `npx astro check` — edcfa48
- [x] 1.2 Linting passes: `npm run lint` — edcfa48
- [x] 1.3 Build succeeds: `npm run build` — edcfa48

#### Manual

- [x] 1.4 `/auth/signin`, `/auth/signup`, `/dashboard` and `/people` render visually unchanged — no caller of `Logo`, `Button` or `Layout` shifted — edcfa48
- [x] 1.5 Page source of an existing page shows no new empty `<meta>` tags — edcfa48

### Phase 2: Page shell, navigation and hero

#### Automated

- [x] 2.1 Type checking passes: `npx astro check`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Build succeeds: `npm run build`
- [x] 2.4 No references remain: `grep -rn "Welcome\|Topbar" src/` returns nothing

#### Manual

- [x] 2.5 `/` renders the designed header and hero, matching `InTouch.dc.html:860-914` at 1200px
- [x] 2.6 Hero stacks correctly at 390px with no horizontal scroll, and the preview card is legible
- [x] 2.7 "Zacznij" and "Dodaj pierwsze osoby" both land on `/auth/signup`
- [x] 2.8 Visiting `/` while signed in lands on `/dashboard`; while signed out, the page renders
- [x] 2.9 Link-preview metadata is present in page source (`description`, `og:title`, `og:url`)

### Phase 3: Middle content bands

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build succeeds: `npm run build`

#### Manual

- [ ] 3.4 All four bands match `InTouch.dc.html:915-1019` at 1200px, including band backgrounds and the border seams between them
- [ ] 3.5 Each grid collapses cleanly at `md` and at 390px with no clipped or overflowing card
- [ ] 3.6 The dark band's text is legible against its background at every card and eyebrow
- [ ] 3.7 Clicking the nav's three links scrolls to the correct section

### Phase 4: Close, footer and whole-page sweep

#### Automated

- [ ] 4.1 Type checking passes: `npx astro check`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Build succeeds: `npm run build`

#### Manual

- [ ] 4.4 The full page matches `InTouch.dc.html:852-1046` end to end at 1200px, section order and band backgrounds included
- [ ] 4.5 The page reads correctly at 360px, 768px and 1440px, with no horizontal scroll at any width
- [ ] 4.6 Every link and button resolves: three primary CTAs → `/auth/signup`, four anchors → their sections, no dead links anywhere on the page
- [ ] 4.7 Keyboard-only traversal reaches every interactive element in visual order, with a visible focus ring on each
- [ ] 4.8 Smooth scrolling is suppressed when the OS "reduce motion" setting is on
- [ ] 4.9 The preview card is skipped by a screen reader; the surrounding copy is not
- [ ] 4.10 Signed-in redirect to `/dashboard` still holds after all sections are in place
