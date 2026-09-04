---
change_id: add-person-context-fields
title: "Add-person form: shell nav + richer per-person context fields"
status: impl_reviewed
created: 2026-09-04
updated: 2026-09-04
archived_at: null
---

## Notes

@context/foundation/roadmap.md

Roadmap slice `S-10`. Closes the still-open per-person half of FR-003 /
Open Roadmap Question 2: the design bundle's `Kim jest dla Ciebie?` free
text, context-tag chips, and `Kiedy ostatnio rozmawialiście?` bucket
(`InTouch.dc.html:598-660`) have no shipped counterpart today — the form
collapses everything into one `description` textarea and `/people/new`
renders outside the app shell.

Decisions taken in the planning session (2026-09-04):

- **Multi-row form kept**: `PersonForm.tsx`'s existing multi-person-per-submit
  capability is preserved: every row gets its own relationship-context line,
  tag list, and last-contact bucket, not simplified to single-person add.
- **`description` untouched**: `Kim jest dla Ciebie?` lands as a new
  `relationship_context` column, supplementing rather than splitting or
  replacing the existing `description` (≤500) the ranking prompt already
  depends on.
- **Tags**: a bounded `text[]` column on `people` (mirrors S-09's
  `preferred_channels`/`availability_windows` pattern), capped at 5, surfaced
  both in the ranking prompt and as chips on `PersonCard`.
- **Last-contact bucket is informational, not `contact_events`**: seeding a
  synthetic `contact_events` row from a vague bucket ("2–6 miesięcy temu")
  would corrupt `facts.ts`'s `daysSinceLastHappened` precision, which depends
  on real confirmed events. Stored as its own enum column, and still passed
  into the ranking prompt as context text — it just never touches
  `contact_events`.
- **All three new fields optional**: matches the design copy itself ("nic
  nie jest obowiązkowe poza imieniem i wagą") and the S-09 precedent of
  nullable, non-gating columns.
- **`Kategoria` selector and the 1–5 weight strip in the mock are not
  adopted**: `Kategoria` is FR-006, already parked; the shipped weight scale
  is 1–10 (`FR-004`'s own resolved Socrates note) and must not regress.

Not adopted from the design: any change to `relationship_type`/`Kategoria`,
any change to the weight scale, and any write path into `contact_events`.

Decisions taken during implementation (2026-09-04):

- **"Osoba czy grupa" converted from `SelectField` to `SegmentedToggle`**
  (new `src/components/forms/SegmentedToggle/`), matching the design
  bundle's actual 2-button treatment for that field
  (`InTouch.dc.html:616-620`) — user-requested mid-Phase-2, out of the
  plan's original file list but same field, same form.
- **`TagChipsField` styled to the mock's exact tag measurements**
  (12px radius, 13px/9px padding, 13px font — `InTouch.dc.html:629-631`)
  rather than the app's default rounded-full pill scale, since the mock
  draws context tags as softer rectangles distinct from `ChoiceChips`'
  fully-pill buckets.
- **Phase 4's automated check (plan item 4.3, `verify:ranking` extended to
  assert prompt content) dropped.** `verify-ranking.ts` is HTTP-based
  against a *deployed* Worker and a hosted Supabase account, purpose-built
  to prove the non-blocking call path (see `lessons.md`) — extending it to
  also assert `buildPeopleSection`'s conditional-line logic would mix two
  unrelated verification concerns and require a real deploy to run at all.
  No replacement automated check was added; the manual hierarchy-regen
  spot-check (plan item 4.6) is this phase's only verification that the new
  context reaches the model.
- **Add-person form layout redesigned mid-Phase-4, user-requested**: the
  outer card wrapper on `/people/new` is gone; `PersonForm` now renders each
  person as a fixed-width column (`w-72`) in a horizontally-scrolling row
  (`overflow-x-auto`) rather than vertically stacked cards, with "Dodaj
  kolejną osobę" collapsed to a `+` column at the end of that row. Field
  spacing inside each column was tightened (`gap-3` instead of the previous
  `space-y-4`/`space-y-6`, textarea `rows={2}` instead of `3`) so one
  column's 8 fields fit a typical viewport height without an internal
  vertical scroll. Not a hard viewport lock (no JS height measurement, no
  `overflow: hidden` on `AppShell`'s shared `<main>`) — on short viewports
  or with many fields' error states expanded, some vertical scroll can still
  occur; the redesign targets the normal case.
