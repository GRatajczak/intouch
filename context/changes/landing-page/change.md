---
change_id: landing-page
title: Public landing page at /
status: implementing
created: 2026-09-01
updated: 2026-09-01
archived_at: null
---

## Notes

@context/foundation/roadmap.md

Roadmap item `S-06`. A leaf outcome — nothing downstream depends on it.
Prerequisite `F-03` (`design-system-foundation`) is done, so the token layer
this page renders on already exists and already carries the design's palette,
display font and type scale.

Transcribes section "8 — Landing page" of the Claude Design handoff at
`.ai/intouch-design-preparation/project/InTouch.dc.html:852-1046` into a real
page at `/`, replacing the minimal hero that `F-03` left there.

Decisions taken during planning (see `plan-brief.md` for the full table):

- Nav links become on-page scroll anchors; the footer's Prywatność / Regulamin
  / Kontakt link row is dropped rather than pointed at pages that do not exist.
  Closes roadmap Open Question 8, half A.
- All three primary CTAs route to `/auth/signup`; the hero's secondary CTA
  scrolls to "Jak to działa". Closes roadmap Open Question 8, half B.
- Full responsive build, mobile-first stacking — the mock is desktop-only
  (1200px), so every breakpoint on this page is designed here rather than
  transcribed.
- A signed-in visitor to `/` is redirected to `/dashboard`.
- `Welcome.astro` and `Topbar.astro` are deleted; `/` was their only consumer.

Full plan: `context/changes/landing-page/plan.md`. Brief:
`context/changes/landing-page/plan-brief.md`.
