---
change_id: privacy-compliance-phase-1
title: Privacy compliance phase 1 (GDPR technical fixes)
status: implementing
created: 2026-10-06
updated: 2026-10-06
archived_at: null
---

## Notes

Faza 1 wdrożenia RODO/privacy dla InTouch. Zakres:

1. `store: false` w wywołaniu OpenAI (src/lib/ranking/run.ts) + minimalizacja danych (wiek zamiast daty urodzenia w prompcie).
2. Zgoda na analitykę PostHog przed włączeniem (baner, domyślnie wyłączona, migracja forward-compatible). Odwraca decyzję z 2026-09-10 o braku banera (komentarz w src/lib/analytics/browser.ts, change web-analytics-pageviews).
3. Prawdziwe usunięcie konta (auth.users przez supabase-admin + usunięcie danych w PostHog). Dziś /api/settings/delete-data zostawia wiersz auth.users.
4. Eksport danych użytkownika (art. 15/20, JSON).
5. Retencja rankings / reminder_sends / contact_events.

Kontekst: administrator = osoba prywatna; OpenAI bez regionu UE (transfer USA, SCC/DPF); Supabase prod eu-west-1; PostHog Cloud EU.
Poza zakresem (osobne zmiany): Faza 2 (polityka prywatności + regulamin), Faza 3 (stopka, checkbox, terms_accepted_at).
