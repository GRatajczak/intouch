---
change_id: add-person-context-fields
title: "Add-person form: shell nav + richer per-person context fields"
status: implementing
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
