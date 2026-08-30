---
change_id: design-alignment-pass
title: App shell navigation and catalog visual alignment
status: implementing
created: 2026-08-30
updated: 2026-08-30
archived_at: null
---

## Notes

@context/foundation/roadmap.md

Roadmap item `F-05`. Follow-on to `design-system-foundation` (`F-03`, done) and
a cosmetic pass over `profile-and-first-people`'s (`S-01`, done) shipped
screens — closes the remaining visual gap between the app and the finished
Claude Design handoff at `.ai/intouch-design-preparation/`.

Scope was narrowed through explicit user decisions during planning to keep
this a pure visual-alignment pass rather than reopening settled data-model
decisions from `FR-002`/`FR-003`/`FR-004`/`FR-006`:

- Build a persistent nav shell now (desktop sidebar + mobile bottom tab bar),
  wrapping only `/dashboard`, `/people`, and a new minimal `/ustawienia` stub.
  `/profile` and `/people/new` stay standalone cards, matching the design.
- `/people` gets a visual grid reskin only — no category tabs, search, or
  inactive-filter (that would deliver the roadmap's parked `FR-006`).
- Profile form and add-person form keep their exact current fields — restyle
  spacing only, no wizard chrome, no chip-tag trait inputs.
- No new `/people/[id]` detail page — deferred to `S-02`/`S-03`/`S-05`, which
  actually have content (AI reasoning, contact history, edit/deactivate) for
  it.

Full plan: `context/changes/design-alignment-pass/plan.md`. Brief:
`context/changes/design-alignment-pass/plan-brief.md`.
