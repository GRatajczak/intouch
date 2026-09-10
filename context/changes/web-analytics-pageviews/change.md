---
change_id: web-analytics-pageviews
title: Rozszerzenie PostHoga o pageviews i sesje (DAU, ścieżki, źródła ruchu)
status: impl_reviewed
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

## Zakres zmieniony 2026-09-10: banner zgody usunięty

Faza 3 planu (banner zgody dla ruchu anonimowego) **nie powstanie**. Decyzja
użytkownika w trakcie implementacji: znacznik w Ustawieniach → Prywatność
wystarczy jako jedyny mechanizm kontroli.

Konsekwencja, świadomie przyjęta: **ruch anonimowy jest zbierany domyślnie.**
Gość przed rejestracją nie ma wiersza w `profiles`, więc nie ma skąd przeczytać
werdyktu — a to właśnie ruch anonimowy (landing, źródła, UTM-y, ścieżka do
rejestracji) jest tym, co ta zmiana miała zmierzyć. `applyConsent()` w
`src/lib/analytics/browser.ts` traktuje więc `"unknown"` jak zgodę; wycisza
tylko jawne `"denied"` z `profiles.analytics_opt_out`.

Odrzucone warianty: liczenie wyłącznie zalogowanych (zakładka Web Analytics
pokazywałaby ułamek ruchu, bez źródeł i bez ścieżki rejestracji) oraz tryb
bezciasteczkowy PostHoga (w aplikacji MPA sesja restartowałaby się co
przeładowanie strony, przez co bounce rate i czas sesji tracą sens).

Wpływ na dalsze fazy:

- Faza 3 zostaje w planie jako zapis tego, co rozważano, ale jej wiersze w
  `## Progress` pozostają niezaznaczone i nie zostaną wykonane.
- Faza 4 bez zmian: middleware czyta `analytics_opt_out`, layout podaje werdykt,
  kopia w `AnalyticsSection` zostaje rozszerzona. Uwaga: błąd zapytania musi
  rozwiązywać się do `"denied"`, nie do `"unknown"` — po tej zmianie `"unknown"`
  znaczy „zbieraj".
- Faza 5: katalog zdarzeń musi opisać ten model zgody, a nie ten z planu.
