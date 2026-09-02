---
change_id: ai-contact-hierarchy
title: AI-ranked contact hierarchy with suggested time windows
status: impl_reviewed
created: 2026-09-01
updated: 2026-09-02
archived_at: null
---

## Notes

@context/foundation/roadmap.md (S-02)

Roadmap slice `S-02`, PRD `US-01` + `FR-007`. Turns the placeholder
`/dashboard` ("Dziś" in `NAV_ITEMS`) into the ranked "who to reconnect with"
view, computed from the self-profile (`S-01` + `S-09`) and the people catalog
(`S-01`) through the non-blocking OpenAI call path (`F-02`).

Decisions taken in the planning session (2026-09-01) — see `plan-brief.md`
for the full table:

- **Scope boundary against `S-03`**: render only what this slice has data for.
  No `Ostatni kontakt` / `Poprzednia próba` chips and no
  `Zaplanowałam kontakt` / `Odłóż o tydzień` actions — those need the contact
  history table `S-03` owns. The shipped screen is deliberately thinner than
  the design mock rather than showing dead UI or fabricated history.
- **Persistence**: a new owner-scoped `rankings` + `ranking_entries` pair, not
  KV. `S-03` attaches its yes/no answer to an entry and `S-04` reads the order
  for reminders; both need something durable that outlives F-02's 1h TTL.
- **Trigger**: stale-on-view (24h) plus the design's explicit "Przelicz teraz".
  The nightly cron the mock implies is deliberately *not* built — it needs the
  cross-user, no-signed-in-user sweep the roadmap parks in `S-04`.
- **Model**: `gpt-5.4-mini`. `F-02`'s `gpt-4o-mini` was a throwaway ping choice
  it explicitly left to this slice.
- **Output contract**: full ordered list of every person, structured through
  `responses.parse()` + `zodTextFormat`; time window is an enum bucket with a
  Polish label map, never model-authored prose.
- **Explanation depth** (the roadmap's named Unknown, now closed): full
  `Dlaczego teraz` + factor chips for the top 3, one-line collapsed rows with
  `Rozwiń` below.
- **Rhythm degradation**: when `S-09`'s optional fields are empty, the prompt
  omits the section entirely and the card omits the `Twój rytm` chip. No
  neutral defaults — a fabricated rhythm claim is worse than none.
- **Failure**: a failed run never overwrites the stored ranking.
- **`owner_id` FK**: `ON DELETE CASCADE`, decided explicitly per `lessons.md`.
