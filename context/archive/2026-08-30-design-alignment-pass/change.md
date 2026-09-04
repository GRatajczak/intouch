---
change_id: design-alignment-pass
title: App shell navigation and catalog visual alignment
status: archived
created: 2026-08-30
updated: 2026-09-04
archived_at: 2026-09-04T20:46:27Z
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

## Divergences from the plan

- **`/ustawienia` shipped as `/settings`** (`feb24ec`, file move in `4a25a2e`).
  User decision during implementation: page filenames — and so routes — stay
  English; only UI copy is Polish. The nav label is still "Ustawienia".
  Recorded as a rule in `context/foundation/lessons.md`. The plan text and its
  `## Progress` step titles still say `/ustawienia`; titles were left verbatim
  per the Progress format contract.
- **`WeightIndicator` segments now shrink to fit** (`1b8b7c5`). At the
  `WeightSelector`'s fixed `size-6` the 10 segments need 276px, which overflows
  a `lg:grid-cols-3` catalog cell (~248px of content) — so Phase 4's success
  criterion 4.5 could not have passed unchanged. `weightSegmentShapeClassName`
  was split out of `weightSegmentClassName` so the indicator sizes itself
  without a Tailwind class conflict; the form's selector renders unchanged.
- **`BottomNav`'s `shadow-card` renders downward**, i.e. off-screen under a
  bottom-fixed bar, rather than upward into the content as the plan's aside
  suggested. Reversing it would need a hand-written `box-shadow`, which Phase
  1's "one token, one utility" contract forbids. The mock's own bottom bar
  (`InTouch.dc.html:374`) separates itself with a top border and no shadow, and
  that border is present.
