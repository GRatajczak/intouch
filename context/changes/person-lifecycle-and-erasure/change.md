---
change_id: person-lifecycle-and-erasure
title: Edit, deactivate and irreversibly delete a person
status: implementing
created: 2026-09-04
updated: 2026-09-04
archived_at: null
---

## Notes

@context/foundation/roadmap.md (S-05)

Roadmap slice `S-05`. PRD `FR-005` (edit a person, deactivate them — AI stops
considering them while their data, including contact history, is retained —
and delete them only after deactivation) + the binary, GDPR-adjacent erasure
NFR ("deleting a person's data is fully and irreversibly honored").

Anticipated by name in three prior plans, which deliberately left this scope
untouched:

- `context/changes/ai-contact-hierarchy/plan.md:101` — "No person editing,
  deactivation or deletion — S-05. A deactivated-person filter is not built
  here because there is no `is_active` column yet."
- `context/changes/did-it-happen-feedback-loop/plan-brief.md:36` —
  `contact_events` is person-centric specifically so this slice's deactivation
  can retain it.
- `context/changes/per-user-data-isolation/reviews/impl-review.md:50` —
  explicit carry-forward flag for deactivate/delete semantics.

The two destructive-data FK chains this slice relies on
(`ranking_entries.person_id` and `contact_events.person_id`, both
`ON DELETE CASCADE` onto `people`) already exist — a real person delete
already fully erases derived data. What's missing is everything upstream of
that: the lifecycle state itself, the routes, and the UI.
