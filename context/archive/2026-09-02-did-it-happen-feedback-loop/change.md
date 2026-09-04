---
change_id: did-it-happen-feedback-loop
title: Did-it-happen confirmation feeding the next ranking
status: archived
created: 2026-09-02
updated: 2026-09-04
archived_at: 2026-09-04T20:46:27Z
---

## Notes

@context/foundation/roadmap.md (S-03)

Roadmap slice `S-03` — the **north star**. PRD `US-01` (acceptance criterion:
"the hierarchy takes into account time since the last (un)successful contact")
+ `FR-009`. Closes the loop: the app suggests, the user acts, the user
confirms, and the next ranking is better for it.

Seams `S-02` deliberately left open for this slice (see
`context/changes/ai-contact-hierarchy/change.md`):

- `rankings` + `ranking_entries` are owner-scoped and durable precisely so this
  slice can attach a yes/no answer to an entry.
- The `Dziś` view deliberately ships without the `Ostatni kontakt` /
  `Poprzednia próba` chips and without the `Zaplanowałam kontakt` /
  `Odłóż o tydzień` actions — they need the contact-history table this slice
  owns. The design mock has them; `S-02` chose a thinner screen over dead UI.
- The ranking prompt currently has no contact history to read. Feeding it back
  is what makes the loop visible.

Roadmap's stated risk is behavioural, not technical: users will not bother
marking did-it-happen unless the marker is frictionless, and an empty loop
leaves the hierarchy permanently stale. This slice lands *before* reminders
(`S-04`) on purpose — the confirmation is prompted in-app from the hierarchy
view, so the loop closes without waiting on the delivery path.
