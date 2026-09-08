# Podłoga świeżości kontaktu — Plan Brief

> Pełny plan: `context/changes/ranking-recency-floor/plan.md`
> Research: `context/changes/ranking-recency-floor/research.md`

## What & Why

Oznaczenie „rozmawialiśmy dziś" nie zmienia okna czasowego, a trzy kolejne przeliczenia tego samego
wejścia dają trzy różne odpowiedzi. Zgłosił to tester na produkcji; zrzut ekranu pokazuje kartę,
w której uzasadnienie mówi „ostatni kontakt był szacunkowo 2–6 miesięcy temu", a chip trzy linijki
niżej — „Ostatni kontakt dziś". Ta zmiana usuwa źródło sprzeczności w prompcie i dokłada wąską
deterministyczną regułę, która czyni zachowanie powtarzalnym.

## Starting Point

`prompt.ts:147-150` wysyła `last_contact_bucket` bezwarunkowo, obok bloku faktów — a pole to
zapisują wyłącznie formularze osoby i nic nie aktualizuje go przy zapisie zdarzenia. `prompt.ts:59`
każe rankować „przede wszystkim na wadze relacji", bo powstało w S-02, gdy historia kontaktu była
wprost poza zakresem. `reconcileEntries` (`run.ts:37-70`) waliduje wyłącznie `personId`, więc
`timeWindow` idzie z modelu prosto do bazy. `facts.ts:24-25` liczy dni jako bloki 24-godzinne w UTC,
a chip liczy doby kalendarzowe w strefie przeglądarki.

## Desired End State

Osoba oznaczona jako „rozmawialiśmy" w ciągu ostatnich dwóch dób, bez nieudanej próby od tego czasu,
dostaje „Nie ma pośpiechu" — w każdym przeliczeniu, niezależnie od wagi i od tego, co zwróci model.
Jej uzasadnienie mówi to samo, co plakietka, a jej pozycja nie stoi ponad osobami z pilniejszym oknem.
Żadne uzasadnienie nie powołuje się na szacunek z formularza, gdy istnieje realny, datowany kontakt.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Kiedy odciąć bucket z promptu | Gdy `lastHappenedAt !== null` | Dorównanie do zasady, którą już stosuje `PersonDetailView.tsx:298-302`; osoba z samymi „Jeszcze nie" zachowuje szacunek, bo to fakt zgodny, nie sprzeczny | Research |
| Hierarchia przesłanek | Świeżość pierwsza, waga rozstrzyga wewnątrz poziomu | Prymat wagi to artefakt S-02, gdy świeżość nie istniała jako wejście — nie decyzja do odwrócenia | Research |
| Progi podłogi | 0–2 dni → `no_rush`, 3–6 → `this_month`, ≥7 bez podłogi | Łapie zgłoszony przypadek i nic ponad to; każdy dodatkowy próg szerzej nadpisuje zasadę S-03 | Plan |
| Kolejność wpisów | Stabilne sortowanie po pilności przed zapisem | `timeWindow` steruje kolorem numeru pozycji (`HierarchyCard.tsx:14-19`), a pozycja pochodzi od modelu — bez sortowania zamieniamy jedną sprzeczność na inną | Plan |
| Proza przy zadziałaniu podłogi | Zastąpiona zdaniem z faktów | Podłoga odpala się tylko wtedy, gdy model źle ocenił tę osobę; wzorzec uzasadnienia pisanego kodem istnieje (`run.ts:62`) | Plan |
| Znaczenie „dni" | Doby kalendarzowe w zaszytej `Europe/Warsaw` | Jedna definicja „dziś" dla serwera i chipa; `profiles` nie ma kolumny strefy, a produkt jest wyłącznie polskojęzyczny | Plan |
| Parametry losowości modelu | Nie pinujemy żadnych | `seed` nie istnieje w Responses API; `temperature` nie jest zweryfikowany dla `gpt-5.4-mini`, a 400 w Workerze zamieniłby każdy ranking w `failed job` | Research + Plan |
| Sufit (podbijanie pilności) | Poza zakresem | Podbijanie jest ryzykowniejsze niż wygaszanie — osoba o wadze 1 mogła zostać celowo odłożona | Plan |

## Scope

**In scope:** odcięcie nieaktualnego bucketu z promptu; przeredagowanie hierarchii przesłanek; wspólna
funkcja dób kalendarzowych używana przez `facts.ts` i chip; czysta funkcja podłogi z testem
jednostkowym; deterministyczne uzasadnienie; stabilne sortowanie po pilności; log diagnostyczny;
scenariusz stabilności w `scripts/verify-ranking.ts`.

**Out of scope:** sufit; pinowanie `temperature`/`top_p`/`reasoning.effort`; zmiana `RANKING_MODEL`;
unieważnianie rankingu po oznaczeniu kontaktu (F-5); oznaczanie nieaktualnej prozy w UI (F-3); zdanie
„Pozostałe N osób jest spokojnych"; zmiany w `isStale`; `last_contact_bucket` w formularzu edycji.

## Architecture / Approach

Prompt przestaje być sprzeczny (faza 1), liczenie dni zyskuje jedną definicję (faza 2), a kod dokłada
gwarancję na wyjściu modelu (faza 3):

```
facts.ts (doby kalendarzowe, Europe/Warsaw)
      │
      ├──→ prompt.ts ── bucket tylko bez udanego kontaktu; świeżość przed wagą
      │                        │
      │                        ▼
      │                    model → entries
      │                        │
      └──→ reconcileEntries ───┴──→ podłoga (czysta funkcja) → uzasadnienie z faktów
                                            │
                                            ▼
                            stabilne sortowanie po pilności → persistRanking
```

Podłoga jest czystą funkcją przyjmującą `ContactFacts`, bez zegara i bez we/wy — dzięki temu jej test
nie potrzebuje ani fake timerów, ani mocka OpenAI, ani fabryki wierszy, z których żadne w tym repo
nie istnieje.

## Phases at a Glance

| Faza | Co dostarcza | Główne ryzyko |
| --- | --- | --- |
| 1. Prompt | Model przestaje dostawać sprzeczne fakty i błędną hierarchię | Przeredagowanie może zgubić instrukcję o rozstrzyganiu remisów (kryterium US-01) |
| 2. Liczenie dni | Jedna definicja „dziś" dla serwera i UI | Zmienia semantykę widocznej etykiety „Już potwierdzone dzisiaj" |
| 3. Podłoga | Powtarzalna gwarancja + pierwszy test w obszarze Ryzyka #3 | Świadomie nadpisuje zapisaną zasadę S-03 o kolejności |
| 4. Weryfikacja | Dowód wobec wdrożonego Workera | Wymaga deployu i żywego wywołania modelu; skrypt zapisuje realne zdarzenie |

**Prerequisites:** konto weryfikacyjne z wypełnionym profilem i co najmniej jedną osobą
(`VERIFY_EMAIL`/`VERIFY_PASSWORD`); wdrożona wersja preview do fazy 4; lokalny stack Supabase do
uruchomienia pełnej suchy.
**Estimated effort:** ~2–3 sesje; fazy 1–2 są krótkie, faza 3 niesie większość pracy.

## Open Risks & Assumptions

- **Nadpisujemy zapisaną zasadę.** S-03 ustaliło „*nothing about the order is computed in code*"
  (`did-it-happen-feedback-loop/plan.md:130-133`). Ta zmiana zawęża ją o jeden nazwany przypadek.
  Stabilne sortowanie ogranicza szkodę — model zachowuje kolejność wewnątrz jednego okna.
- **Nie gwarantujemy pełnej powtarzalności.** Bez pinowania parametrów proza i kolejność wewnątrz
  okna nadal będą się różnić między przebiegami. Gwarantowana jest wyłącznie podłoga — i asercja
  w fazie 4 celowo sprawdza tylko ją, żeby nie migotała.
- **Zaszyta strefa `Europe/Warsaw`** jest błędna dla użytkownika za granicą i będzie długiem przy
  internacjonalizacji.
- **Progi 0–2 / 3–6 to hipoteza produktowa**, nie wynik z danych. Rozszerzać dopiero, gdy F-4
  (`ranking-observability`) dostarczy telemetrię.
- **S-03 przewidziało to zgłoszenie** („*the user taps and observes nothing change*",
  `plan.md:147-151`) i przyjęło je jako świadomy koszt. Ten plan nie zmienia tamtej decyzji —
  zmienia to, żeby przeliczenie, gdy już nastąpi, dawało inny wynik.

## Success Criteria (Summary)

- Oznaczenie „rozmawialiśmy" u osoby o wysokiej wadze daje „Nie ma pośpiechu" i **zostaje** takie
  w trzech kolejnych przeliczeniach
- Żadne uzasadnienie nie mówi „szacunkowo", gdy osoba ma zapisany udany kontakt
- Pozycja na liście i kolor plakietki nie mówią dwóch różnych rzeczy o tej samej osobie
