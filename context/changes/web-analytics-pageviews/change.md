---
change_id: web-analytics-pageviews
title: Rozszerzenie PostHoga o pageviews i sesje (DAU, ścieżki, źródła ruchu)
status: implementing
created: 2026-09-09
updated: 2026-09-10
archived_at: null
---

## Notes

Rozszerzenie PostHoga o $pageview/sesje (DAU, ścieżki, źródła ruchu) z sanityzacją person_id w URL i zgodą dla ruchu anonimowego.

Punkt wyjścia — stan po F-06 (`context/archive/2026-09-04-product-analytics-posthog/`):
pięć zdarzeń funnela wysyłanych gołym `fetch` z Workera, `$process_person_profile: false`,
brak SDK w przeglądarce, brak `$pageview`. Dashboard Web Analytics jest pusty, a DAU nie
da się policzyć — trzy z pięciu zdarzeń padają raz w życiu konta.

Do rozstrzygnięcia w planie:

- `posthog-js` w `Layout.astro` vs serwerowa emisja `$pageview` z middleware (własny `$session_id`);
  wariant serwerowy nie da bounce rate ani czasu sesji, za to nie ma go czym zablokować.
- **Blokada prywatności:** `$current_url` dla `/people/<uuid>` niesie `person_id`, którego
  `src/lib/analytics/events.ts` i event-catalog wprost zakazują. Sanityzacja ścieżki
  (uuid → `:id`) musi istnieć zanim poleci pierwszy pageview.
- Zgoda dla ruchu anonimowego: dziś opt-out to `profiles.analytics_opt_out` czytany serwerowo,
  a gość przed rejestracją nie ma wiersza.
- Wspólny `distinct_id` (id z Supabase) dla zdarzeń klienta i serwera, żeby funnel z F-06 się nie rozjechał.
- Zakres pozostaje bez session replay i autocapture — roadmap parkuje je świadomie.
