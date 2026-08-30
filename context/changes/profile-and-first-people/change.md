---
change_id: profile-and-first-people
title: Self-profile and first people
status: implementing
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
- **FR-002** — amended 2026-08-30 mid-Phase-2, on user feedback during manual
  review of the profile form: `age_range` (3-bucket enum) replaced with an
  exact `birth_date`, and `life_context` (4-option enum + conditional detail
  field) replaced with a single bounded free-text field (max 300 chars, UI
  tooltip shows an example). Phase 1's migration was edited in place (not
  superseded by a new one) since it had not been applied anywhere but local
  dev. `scripts/verify-rls.ts`, `src/lib/validation/profile.ts`,
  `ProfileForm.tsx`, and `profile.astro` were all updated to match.

All three amended in `context/foundation/prd.md`.

- **Phase 3 scope expansion** — amended 2026-08-30 on user feedback after trying the single-person `/people/new` form: the add-person flow was redesigned to support adding multiple people/groups in one view before submitting, rather than one person per page visit. `PersonForm` now holds a dynamic array of rows (add/remove controls, each row independently validated), submitted as one native POST with indexed field names (`name-0`, `name-1`, ...). `src/lib/validation/person.ts` gained `peopleFormSchema` (`z.array(personSchema)`) and `parseForm`/`toRows` operate on the whole array; `/api/people` does one bulk `.insert()`. This doesn't contradict FR-003's wording, so the PRD was not amended — it's an additive UX improvement, not a redefinition of the field set.
