---
change_id: self-profile-rhythm-fields
title: Self-profile rhythm fields feeding the AI schedule
status: implemented
created: 2026-08-31
updated: 2026-09-01
archived_at: null
---

## Notes

@context/foundation/roadmap.md

Roadmap slice `S-09`. Extends the `/profile` form S-01 shipped (name, birth
date, life context) with the three rhythm selectors the design bundle's
onboarding card asks for — weekly time budget, preferred channels, availability
windows — because they are the sole source of the `Twój rytm` factor the design
shows in the hierarchy card (`InTouch.dc.html:256`) and the reminder email
(`:1113`).

Decisions taken in the planning session (2026-08-31):

- **Fields**: the three design fields 1:1. A fourth candidate (`weekly_contact_goal`,
  "ilu osobom tygodniowo") was rejected — it duplicates the time budget and adds a
  field to a form the persona is expected to abandon once it grows.
- **UX**: stays a single card on `/profile`. The design's "krok 2 z 3" wizard is
  out of scope — inter-step state and abandonment handling are separate work.
- **Optional, not gated**: columns are nullable/defaulted and the Zod schema does
  not require them. Profiles filled before this slice keep working and their owners
  are never bounced back through the form — so `S-02` must degrade gracefully when
  the three are empty.
- **Multi-select for availability windows**, although the design mock shows a single
  pill selected: an array tolerates one element, the reverse doesn't.

Two PRD edits made while planning, both on 2026-08-31:

- **FR-002** — field set extended with the three optional rhythm selectors, with a
  dated amendment note recording that they came from the design bundle and had no
  PRD backing before this slice.
- **Open Question 2** — narrowed. The self-profile half is closed (S-01 + S-09);
  the per-person half (FR-003) stays open.

Not adopted from the design: the 3-step onboarding wizard, the `Push` reminder
channel (PRD v2 FR-008 is email-only), and everything on the person form.
