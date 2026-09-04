# Public Landing Page — Plan Brief

> Full plan: `context/changes/landing-page/plan.md`

## What & Why

`/` is the first page every prospect meets, and it currently carries a four-element hero —
logo, one headline, one paragraph, two auth buttons. The finished design already contains a
complete seven-section marketing page for exactly this route, in InTouch's own voice. This
plan transcribes it: hero with a product preview, problem statement, four-step how-it-works,
who-it's-for, stated principles, closing CTA, footer.

## Starting Point

The roadmap (`S-06`) describes `/` as rendering the starter's placeholder — that is stale.
`F-03` already reskinned `Welcome.astro` onto the product's tokens with InTouch copy, so the
palette is right and roughly 5% of the designed content is present. More usefully, `F-03`'s
token layer (`src/styles/global.css`) *is* this design's palette: every colour, the display
font, and a type scale that maps almost 1:1 onto the mock's sizes. `Logo.astro` already renders
the two-circle mark the landing uses. There is no `.dark` block, so light-only is settled.

## Desired End State

An unauthenticated visitor opening `/` gets the full designed page, reading correctly from
360px to 1440px+. Every link works: three nav links scroll to their sections, all primary CTAs
land on `/auth/signup`, the hero's secondary CTA scrolls to "Jak to działa". Nothing on the
page is a dead link or a placeholder. A signed-in visitor never sees it — they land on
`/dashboard`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Nav + footer link targets | Nav links become scroll anchors; footer link row dropped | No privacy policy, terms or contact page exists, and a footer of dead links is worse than a quiet one — closes roadmap Open Question 8, half A. | Plan |
| CTA destinations | All three primary CTAs → `/auth/signup`; secondary scrolls to how-it-works | Shortest path to the only conversion that matters, with labels that tell the truth — closes Open Question 8, half B. | Plan |
| Responsive scope | Full responsive, mobile-first stacking | The mock is desktop-only (no 390px artboard, unlike sections 1-6), and a desktop-only landing is a broken landing on the page where first impressions are the point. | Plan |
| Signed-in visitor at `/` | Redirect to `/dashboard` | A logged-in user has no use for a signup pitch, and clicking "Zacznij" while signed in is otherwise a dead end. | Plan |
| Code structure | One `.astro` per section under `src/components/landing/` | Mirrors how `src/components/layout/` splits the app shell; each file stays scannable and a copy tweak touches one small file. | Plan |
| Hero preview card | Build verbatim as inert, `aria-hidden` markup | It is the one element that *shows* the product rather than describing it, and the urgency/swatch tokens it needs already exist. | Plan |
| `Welcome.astro` / `Topbar.astro` | Delete both | Grep confirms `/` is their only consumer; leaving them means the next agent finds two plausible hero/nav components that render nowhere. | Plan |
| Page metadata | Add `description` + OG/Twitter props to `Layout` | This is the page that gets pasted into a chat, and without them a paste renders a bare URL; `@astrojs/sitemap` already covers the rest. | Plan |
| Palette & dark mode | Inherit `F-03` unchanged; no new tokens | Roadmap Open Questions 6 and 7 were already closed by `F-03` — this slice decides nothing about them. | Roadmap / F-03 |

## Scope

**In scope:** the seven designed sections at `/`; three small shared-component edits
(`Layout` metadata props, `Logo` wordmark override, `Button` `xl` size); the signed-in
redirect; anchor scrolling with reduced-motion respect; deleting the two starter-era
components.

**Out of scope:** privacy/terms/contact pages; any second marketing page, CMS, blog, analytics
or A/B testing; a dark variant; new design tokens; `middleware.ts` changes; an OG image asset;
a test framework; any new dependency.

## Architecture / Approach

`src/pages/index.astro` performs the auth redirect and composes seven `.astro` section
components from `src/components/landing/` inside the existing `Layout`. Nothing hydrates —
every component is server-rendered, and the two `Button` usages go through `asChild` exactly as
`Welcome.astro` does today. The mock's outer 1200px rounded card is artboard chrome, not page
chrome: each section becomes a full-bleed band with its own background, content centred in a
`max-w-6xl` container. All colour resolves to existing tokens, or to an opacity over one.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared surface prep | `Layout` metadata props, `Logo` wordmark override, `Button` `xl` size | Touches components every screen uses — a regression here is invisible on `/` and visible everywhere else |
| 2. Shell, nav, hero | A real `/` with header + hero + preview card; starter components deleted | The preview card is the densest element on the page and the hardest to make work at 390px |
| 3. Middle content bands | Problem, how-it-works, who-it's-for, principles | The dark band inverts the page's foreground/background pair, so inherited colour is wrong inside it |
| 4. Close, footer, sweep | Closing CTA, footer, anchor scrolling, whole-page verification | The mobile layout is invented rather than transcribed, so this sweep is the first time it is judged as one page |

**Prerequisites:** `F-03` (done) — the token layer. The design handoff at
`.ai/intouch-design-preparation/`. Nothing else; this slice touches no table, no API, no auth.

**Estimated effort:** ~2 sessions across 4 phases. Phase 3 is the bulk of the markup; phases 1
and 4 are small.

## Open Risks & Assumptions

- The mobile layout has no design to check against — it is designed during implementation, so
  Phase 4's manual sweep is the only real judgement of it.
- The hero preview card illustrates `S-02`'s ranked hierarchy, which does not exist yet. When
  `S-02` ships something that looks different, this card silently becomes inaccurate; nothing
  in the codebase will flag it.
- The mock contains a typo — "najbliższych **osobac**" — corrected to "osobach" in the build
  and recorded as a divergence.
- Two mock colours (`#3a3530`, `#b5ada3`) have no token and are approximated with opacity over
  `--primary` / `--primary-foreground`; the result should be eyeballed against the mock rather
  than assumed exact.
- Dropping the footer's legal row is the right MVP answer, but a privacy policy still has to be
  written before this page is put in front of strangers.

## Success Criteria (Summary)

- A visitor opening `/` reads the whole designed page — what InTouch is, who it's for, how it
  works, and what it promises — and can sign up from three places without hitting a dead link.
- The page works on a phone, which is where most first visits will happen.
- A signed-in user going to `/` lands in the app, not on a signup pitch.
