---
change_id: profile-and-first-people
title: Self-profile and first people
status: plan_reviewed
created: 2026-08-29
updated: 2026-08-30
archived_at: null
---

## Notes

@context/foundation/roadmap.md

Roadmap slice `S-01`. Two PRD amendments made while planning this slice:

- **FR-004** — weight scale amended from the PRD's original 1–5 to 1–10 during
  this plan's questioning.
- **FR-003** — the single-vs-collective field narrowed from a free-text
  collective label to a two-option marker (`is_collective` boolean + an
  "Osoba"/"Grupa" dropdown), amended 2026-08-30 while triaging finding F4 of
  `reviews/plan-review.md`. The collective's identity now lives in
  `description`; if `S-02` finds the AI can't reliably pull it out of prose,
  the fallback is a nullable `collective_label` column (F4's Fix B).

Both amended in `context/foundation/prd.md`.
