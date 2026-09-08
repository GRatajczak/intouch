---
change_id: ranking-recency-floor
title: Suggested time window must react to a recorded contact, deterministically
status: implementing
created: 2026-09-08
updated: 2026-09-08
archived_at: null
---

## Notes

F-1 z triage'u feedbacku testera — `context/changes/feedback-triage-2026-09-08/triage.md`
(dowód: `evidence/dashboard-2026-09-08-2054.jpeg`).

Objaw zgłoszony przez testera: „jak zaznaczę że kontakt: dziś to wciąż mam że w ciągu
miesiąca (tak jakby się nic nie zmieniło)", a kolejne przeliczenia dają za każdym razem
inną odpowiedź (`this_month` → `two_weeks` → `no_rush`) przy tym samym wejściu.

Cztery rzeczy w zakresie:

1. **Odetnij nieaktualny `last_contact_bucket` z promptu, gdy osoba ma blok „Historia
   kontaktu"** (`prompt.ts:147-150`). Pole zapisują wyłącznie formularze osoby
   (`PersonForm.tsx:363`, `PersonEditForm.tsx:240`) i nic nie aktualizuje go przy zapisie
   `contact_event`. Zrzut ekranu dowodzi, że model cytuje je dosłownie — proza na karcie
   brzmiała „ostatni kontakt był **szacunkowo** 2–6 miesięcy temu", co jest echem
   `Ostatni kontakt (szacunkowo): ${LAST_CONTACT_BUCKET_LABELS[bucket]}` — podczas gdy
   blok faktów w tym samym prompcie mówił o zerze dni. Bucket ma zostać seedem wyłącznie
   do pierwszego rankingu, przed jakimkolwiek zdarzeniem. To ta sama zasada
   pominięcia-zamiast-domyślnej-wartości, którą `prompt.ts` już stosuje dla rytmu i faktów.

2. **Odwróć hierarchię przesłanek w `buildSystemMessage`** (`prompt.ts:59` vs `:64`).
   Dziś: „opierając się przede wszystkim na wadze relacji", a świeżość kontaktu dopisana
   niżej jako miękkie „MUSI obniżać pilność" — konkuruje z twardym „przede wszystkim"
   i przegrywa. Docelowo: świeżość kontaktu jest pierwszym kryterium pilności, waga
   rozstrzyga w obrębie tego samego poziomu.

3. **Deterministyczna podłoga po odpowiedzi modelu** (`run.ts:37-70`). `reconcileEntries`
   waliduje dziś wyłącznie `personId`; `timeWindow` idzie z modelu prosto do bazy bez
   konfrontacji z `daysSinceLastHappened`, a żaden parametr sterujący losowością nie jest pinowany
   (`run.ts:107-111`). Reguła: `daysSinceLastHappened <= N` i
   `failedAttemptsSinceLastHappened === 0` → `timeWindow` nie może być pilniejszy niż
   ustalony próg. Progi jako nazwane stałe, jedna tabela `dni → najpilniejsze dozwolone
   okno`. **To jedyny punkt, który czyni zachowanie powtarzalnym** — 1 i 2 tylko poprawiają
   szanse.

4. **Ujednolić liczenie dni.** `facts.ts:24-25` liczy z różnicy milisekund
   (`Math.floor`), a `ContactChips.formatRelativeDate:10` porównuje `toDateString()`.
   Dwie definicje „dziś" rozjeżdżają chip i prompt o jeden dzień, a próg z pkt. 3 stoi
   na tej liczbie. Jedna funkcja, dni kalendarzowe, strefa udokumentowana.

Kryteria akceptacji:

- Przypadek ze zrzutu (waga 4/10, „Znajomy/Znajoma", kontakt dziś, brak nieudanych prób)
  → `no_rush` w każdym z trzech kolejnych przeliczeń.
- Żadne uzasadnienie nie zawiera frazy „szacunkowo", gdy osoba ma zapisane zdarzenie.
- Test jednostkowy podłogi bez wołania modelu; obecne testy w `tests/` zostają zielone.

**Korekta po `/10x-research` (2026-09-08):** `seed` NIE istnieje w Responses API tego SDK
(`openai@7.8.0`) — występuje wyłącznie na Chat Completions i jest tam `@deprecated`. Nie wpisywać
go do planu. Dostępne dźwignie to `temperature`, `top_p` i `reasoning.effort`; szczegóły i
nierozstrzygnięte pytanie o runtime `gpt-5.4-mini` w `research.md` §E.

Poza zakresem: zmiana `RANKING_MODEL` (najpierw podłoga i prompt — wymiana modelu przed
nimi zamaskuje przyczynę); oznaczanie nieaktualnej prozy na karcie (F-3,
`stale-reason-marking`); unieważnianie rankingu po oznaczeniu kontaktu (F-5).
