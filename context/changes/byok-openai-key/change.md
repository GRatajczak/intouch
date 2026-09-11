---
change_id: byok-openai-key
title: Own OpenAI key unlocks unlimited recomputes; without one, one manual recompute a day
status: implemented
created: 2026-09-09
updated: 2026-09-11
archived_at: null
---

## Notes

użytkownik podaje własny klucz OpenAI i dostaje nielimitowane przeliczenia AI; bez klucza ręczne "Przelicz teraz" raz na dobę

Decyzje podjęte przy otwarciu zmiany (2026-09-09):

- **Przechowywanie klucza:** szyfrogram AES-GCM w kolumnie na `profiles`, kluczem szyfrującym jest nowy sekret Workera. W UI wyłącznie maska (`sk-…4f2a`), pełna wartość nigdy nie wraca do przeglądarki.
- **Zakres limitu:** darmowy licznik obejmuje wyłącznie ręczne „Przelicz teraz" (`force: true`), 1 na dobę. Automatyczne odświeżenie po 24 h (`STALE_AFTER_MS`) zostaje darmowe i nielimitowane.
- **Cron:** sweep przypomnień liczy kluczem właściciela, gdy ten go podał; bez klucza spada na klucz aplikacji i nie dotyka dziennego licznika.

Odparkowuje wpis „User-supplied OpenAI API key (bring your own key)" z `context/foundation/roadmap.md` §Parked → Other.

Decyzje uzupełniające po researchu (2026-09-09):

- **Nieudane odszyfrowanie:** cichy fallback na klucz aplikacji i darmowy limit, żeby rotacja sekretu nikomu nie zepsuła rankingu, plus widoczny w `/settings` stan „klucz nieczytelny, podaj ponownie". Użytkownik nie zostaje z przekonaniem, że ma działający klucz.
- **Format szyfrogramu:** niesie wersję klucza szyfrującego od pierwszego zapisu (`v1:<iv>:<ciphertext>`), żeby późniejsza rotacja sekretu nie wymagała migracji formatu.
- **Martwy klucz:** walidacja jednym tanim wywołaniem przy zapisie, a dodatkowo `AuthenticationError` (401) lub `RateLimitError` (429) z przebiegu w tle oznacza klucz przy profilu, żeby `/settings` mogło powiedzieć, że wymaga uwagi.
- **Bez pytania:** slice dostaje numer S-17 (S-12…S-16 zarezerwowane w trackerze); FR-001 w PRD dostaje datowaną adnotację, bo BYOK odwraca mechanizm kontroli kosztów, na który to wymaganie się powołuje; nowe zdarzenie analityczne nie powstaje.
