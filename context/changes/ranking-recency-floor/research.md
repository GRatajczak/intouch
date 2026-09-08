---
date: 2026-09-08T09:40:04+0200
researcher: g.ratajczak97@gmail.com
git_commit: 2c9b7e5b6f04ec9172421c0354dee22b54767206
branch: main
repository: intouch
topic: "Okno czasowe nie reaguje na zapisany kontakt i nie jest powtarzalne (F-1)"
tags: [research, codebase, ranking, prompt, contact-history, determinism, timezone]
status: complete
last_updated: 2026-09-08
last_updated_by: g.ratajczak97@gmail.com
---

# Research: okno czasowe nie reaguje na zapisany kontakt i nie jest powtarzalne

**Data**: 2026-09-08T09:40:04+0200
**Badacz**: g.ratajczak97@gmail.com
**Commit**: `2c9b7e5b6f04ec9172421c0354dee22b54767206`
**Gałąź**: `main`
**Repozytorium**: `intouch`

## Pytanie badawcze

Cztery punkty z `change.md`: (1) odciąć nieaktualny `last_contact_bucket` z promptu, (2) odwrócić
hierarchię przesłanek waga-vs-świeżość, (3) dodać deterministyczną podłogę na `timeWindow`,
(4) ujednolicić liczenie dni. Plus dwa pytania oddane do zbadania: **kiedy dokładnie odciąć
bucket** i **co zrobić z prozą uzasadnienia, gdy podłoga nadpisze okno**.

## Streszczenie

Siedem ustaleń, z których cztery zmieniają kształt planu:

1. **Poprawna zasada pierwszeństwa już istnieje w tym repo — prompt jest jedynym miejscem, które
   jej nie stosuje.** `PersonDetailView.tsx:298-302` renderuje „Ostatni kontakt" jako
   `facts?.lastHappenedAt ? formatLastContact(...) : person.last_contact_bucket ? LABELS[...] : "Brak danych"`.
   Realna data wygrywa, bucket jest fallbackiem. `prompt.ts:147-150` wysyła oba bezwarunkowo.
   To rozstrzyga pytanie o bucket: **odcinamy dokładnie wtedy, gdy `lastHappenedAt !== null`** —
   nie wymyślamy reguły, tylko dorównujemy do konwencji, która już działa w UI.

2. **Prymat wagi nigdy nie został rozstrzygnięty przeciwko świeżości.** S-02 wprost wykluczyło
   historię kontaktu z zakresu (`plan.md:94`: „**No contact history.** … explicitly out of scope
   here"), więc zdanie „przede wszystkim na wadze relacji" powstało, gdy świeżość **nie istniała
   jako wejście**. S-03 dołożyło konkurencyjną instrukcję (`prompt.ts:64`) **nie ruszając** starej.
   Punkt 2 planu nie odwraca więc żadnej decyzji — domyka uzgodnienie, którego S-03 nie zrobiło.

3. **Podłoga świadomie łamie zapisaną zasadę S-03.** `2026-09-02-did-it-happen-feedback-loop/plan.md:130-133`:
   „*Nothing about the order is computed in code, so `US-01`'s claim that context breaks ties stays
   the model's to keep.*" Deterministyczna podłoga to pierwsze miejsce, w którym kod orzeka o treści
   rankingu. To jest do zrobienia, ale **musi być w planie nazwane jako świadome nadpisanie**, nie
   przemycone.

4. **`seed` nie istnieje w Responses API.** W `openai@7.8.0` `seed` występuje wyłącznie na Chat
   Completions (`resources/chat/completions/completions.d.ts:1881`, w dodatku `@deprecated`), a w
   `resources/responses/responses.d.ts` nie ma go wcale. Moje własne `change.md` i `triage.md`
   sugerowały „pinowanie `temperature`/`seed`" — **`seed` trzeba z planu wykreślić**. To dokładnie
   ten błąd, przed którym ostrzega `lessons.md` („Verify exact config API in node_modules").

5. **Sama podłoga nie wystarczy — bo `timeWindow` steruje całą wizualną pilnością karty, a pozycja
   zostaje modelu.** `HierarchyCard.tsx:14-19` mapuje `timeWindow` na kolor plakietki, kolor
   **numeru pozycji**, kolor etykiety i obramowanie karty. `rank_position` pochodzi wyłącznie z
   kolejności tablicy modelu (`store.ts:128`). Jeśli podłoga zgasi wpis na pozycji 1, dostajemy szary
   numer „1" i szare obramowanie na szczycie listy „Kto teraz czeka na Twój telefon", nad czerwoną
   pozycją 2. Zamieniamy jedną sprzeczność na inną.

6. **„Dni kalendarzowe w strefie użytkownika" są dziś niewykonalne.** Nigdzie nie przechowujemy
   strefy ani locale użytkownika — tabela `profiles` nie ma takiej kolumny (pełna lista kolumn niżej).
   Serwer to Cloudflare Worker (UTC), a chip „dziś" liczy się w przeglądarce w strefie widza.
   Punkt 4 planu musi wybrać jedną z trzech możliwych strategii, nie „udokumentować strefę".

7. **Infrastruktura testowa nie ma nic, czego ten test potrzebuje** — brak globa na testy jednostkowe,
   brak precedensu mockowania OpenAI, brak fabryk `Tables<"people">`/`ContactFacts`, brak
   `vi.useFakeTimers` w całym repo. To argument, żeby podłoga była **czystą funkcją** przyjmującą
   `daysSinceLastHappened` jako liczbę — wtedy test nie potrzebuje ani zegara, ani mocka, ani fikstury.

## Ustalenia szczegółowe

### A. Bucket vs. fakty — precedens pierwszeństwa już istnieje

Trzy konsumenty `last_contact_bucket`, dwa zachowują się poprawnie:

| Konsument | Zachowanie | Ocena |
| --- | --- | --- |
| `PersonDetailView.tsx:298-302` | `facts?.lastHappenedAt` → realna data; inaczej bucket; inaczej „Brak danych" | **poprawne** |
| `PersonForm.tsx:363`, `PersonEditForm.tsx:240` | jedyne miejsca zapisu | poprawne (źródło) |
| `prompt.ts:147-150` | wysyła bucket **bezwarunkowo**, obok bloku faktów | **błąd** |

Pole zapisują wyłącznie formularze — potwierdzone, poza `PersonForm`/`PersonEditForm` nie ma żadnego
zapisu, w szczególności `POST /api/contact-events` (`src/pages/api/contact-events.ts:62-72`) go nie
dotyka.

**Dlaczego akurat `lastHappenedAt !== null`, a nie „istnieje blok historii":** osoba z samymi wpisami
`not_yet` ma blok historii, ale `lastHappenedAt === null`. Prompt mówi wtedy „Nie odnotowano jeszcze
udanego kontaktu" — a bucket („2–6 miesięcy temu") jest z tym **zgodny i komplementarny**: aplikacja
nie zarejestrowała udanego kontaktu, a użytkownik szacował, że ostatnio rozmawiali pół roku temu.
Sprzeczność powstaje wyłącznie wtedy, gdy istnieje realny, datowany udany kontakt. Odcięcie na „jest
jakikolwiek blok" kasowałoby informację bez powodu.

Historia potwierdza, że to niedopatrzenie, nie decyzja: `2026-09-04-add-person-context-fields/plan.md:80-87`
chroni precyzję `contact_events` **przed** bucketem („*A bucket like '2–6 miesięcy temu' has no honest
single timestamp to seed a row with — inserting one would quietly corrupt that math*"), ale ryzyka
odwrotnego — że bucket zwietrzeje obok realnych zdarzeń — **nie podnosi nigdzie**.

### B. Prymat wagi — artefakt, nie decyzja

- S-02 (`2026-09-01-ai-contact-hierarchy/plan.md:94`): „**No contact history.** … `US-01`'s fourth
  acceptance criterion ('takes into account time since the last (un)successful contact') is therefore
  explicitly out of scope here."
- Jedyne zdanie kształtujące `prompt.ts:59` (`plan.md:322-324`) dotyczy **rozstrzygania remisów opisem**,
  nie relacji waga↔świeżość.
- S-03 dołożyło `prompt.ts:64` i wprost zostawiło resztę: „*The model's job is unchanged … Nothing
  about the order is computed in code*" (`plan.md:130-133`). Klauzuli „przede wszystkim" nie tknęło.

Wniosek: dwie instrukcje w jednym prompcie konkurują, bo nikt nigdy nie postawił ich obok siebie.

### C. Podłoga — co dokładnie nadpisuje i czego nie widzi

`reconcileEntries` (`run.ts:37-70`) sprawdza **wyłącznie** integralność `personId`. Zasięg był
świadomie wąski — `2026-09-01-ai-contact-hierarchy/plan.md:155-160` mówi o „*id existence*", nigdy o
treści `timeWindow`.

Trzy fakty konstrukcyjne dla planu:

1. **`facts` nie dociera dziś do `reconcileEntries`.** W `run.ts:88-96` mapa `facts` jest ładowana i
   trafia tylko do `buildRankingPrompt` (`run.ts:105`). Podłoga wymaga przekazania jej dalej —
   jeden dodatkowy argument.
2. **`TIME_WINDOW_VALUES` jest już posortowane malejąco po pilności** (`validation/ranking.ts:10`:
   `this_week, two_weeks, this_month, no_rush`), więc indeks w tej tablicy *jest* rangą pilności.
   Dziś ta własność jest niejawna — plan powinien ją nazwać, zamiast na niej milcząco polegać.
3. **Strażnik ma być `failedAttemptsSinceLastHappened === 0`.** To subsumuje `lastAttemptFailed`:
   nieudana próba po ostatnim udanym kontakcie zawsze podbija ten licznik (`facts.ts:29-31`).
   Scenariusz „rozmawialiśmy" a potem „jeszcze nie" tego samego dnia — dokładnie to, co robił tester —
   daje `failedAttemptsSinceLastHappened === 1`, więc podłoga **nie zadziała**, i słusznie.

### D. Kolejność — dlaczego sama podłoga zostawia kartę niespójną

`HierarchyCard.tsx:14-19` (`TIME_WINDOW_TONE`) wiąże `timeWindow` z: tłem plakietki numeru
(`:39`, `:66`), kolorem etykiety (`:50`), obramowaniem karty (`:60`) i pigułką okna (`:84`).
Pozycja pochodzi z `rank_position`, nadawanego jako `index + 1` po kolejności tablicy
(`store.ts:124-128`), czyli po kolejności modelu.

Dodatkowo `HierarchyView.tsx:31-33` rozwija **trzy pierwsze pozycje**, więc wygaszony wpis nadal
zajmuje slot rozwinięty, który powinien przypaść komuś pilnemu.

Naprawa jest tania: `persistRanking` numeruje po kolejności tablicy, więc **stabilne sortowanie
tablicy po randze pilności przed zapisem** wystarcza; `unique (ranking_id, rank_position)`
(`20260901120000_create_rankings_tables.sql`) pozostaje spełnione. Ale to jest właśnie miejsce, w
którym łamiemy zasadę z ustalenia 3 — sortowanie po oknie **jest** liczeniem kolejności w kodzie.
Stabilne sortowanie ogranicza szkodę: model nadal decyduje o wszystkim wewnątrz jednego okna.

### E. Determinizm — co realnie da się ustawić

`openai@7.8.0`, wywołanie `client.responses.parse` (`run.ts:107-111`), typ ciała
`ResponseCreateParamsBase` (`node_modules/openai/resources/responses/responses.d.ts:7996`):

| Parametr | W typach SDK | Werdykt |
| --- | --- | --- |
| `temperature` | `responses.d.ts:8203` | legalny typowo; **nie potwierdzone**, czy `gpt-5.4-mini` go przyjmuje w runtime |
| `top_p` | `responses.d.ts:8253` | jw. |
| `reasoning.effort` | `responses.d.ts:8144` + `shared.d.ts:162` | komentarz w typach: „**gpt-5 and o-series models only**" — udokumentowana dźwignia dla tej rodziny |
| `seed` | **nie istnieje** dla Responses; tylko Chat Completions (`chat/completions/completions.d.ts:1881`, `@deprecated`) | **wykreślić z planu** |
| `service_tier`, `max_output_tokens` | obecne | bez związku z determinizmem |

`zodTextFormat` (`node_modules/openai/helpers/zod.d.ts:106`) kształtuje wyłącznie `text.format` i
nie ogranicza żadnego z powyższych.

**Czego nie dało się ustalić:** czy `gpt-5.4-mini` faktycznie przyjmuje niedomyślne `temperature`
w runtime, czy odrzuca je błędem 400 — ani typy, ani dokumentacja tego nie rozstrzygają dla tej
rodziny. To wymaga jednego żywego wywołania i **nie powinno być założeniem planu**.

### F. Liczenie dni — dziewięć miejsc, dwie strefy, zero konfiguracji

Miejsca istotne dla tej zmiany:

| Miejsce | Algorytm | Gdzie się wykonuje | Strefa „dziś" |
| --- | --- | --- | --- |
| `facts.ts:24-25` | `Math.floor((Date.now() - occurred_at)/MS_PER_DAY)` | **serwer** (Worker) | UTC |
| `ContactChips.tsx:7-21` | `toDateString()` równość, potem różnica dni | **klient** | strefa widza |
| `ContactMarker.tsx:34` | `daysSinceLastHappened === 0 && !lastAttemptFailed` | klient, ale **czyta liczbę z serwera** | faktycznie UTC |
| `ContactHistorySheet.tsx:33-49` | jak `ContactChips` | klient | strefa widza |
| `PersonCard.tsx:6-20` | jak wyżej | serwer (bez hydracji) | UTC |
| `PersonDetailView.tsx:33-48` | jak wyżej | SSR, potem klient | **rozjazd na granicy hydracji** |
| `store.ts:92-97` (`isStale`) | 24 h, nie doba kalendarzowa | serwer | n/d |

Fakty ograniczające:

- `profiles` nie ma kolumny strefy ani locale. Pełny zestaw:
  `owner_id`, `name`, `birth_date`, `life_context`, `updated_at`, `weekly_time_budget`,
  `preferred_channels`, `availability_windows`
  (`20260830101704_add_profiles_and_people_fields.sql:8-12`, `20260831202209_add_profile_rhythm_fields.sql:17-22`).
- `contact_events.occurred_at` i `.created_at` to `timestamptz not null default now()`
  (`20260902184909_create_contact_events_table.sql:23,26`).
- W repo nie ma żadnej biblioteki dat ani jednego użycia `Intl.DateTimeFormat` z opcją `timeZone`.
- `runRanking` wykonuje się w Workerze przez `cfContext.waitUntil` (`rankings.ts:69-72`) → zegar UTC.

`facts.ts` jest importowany wartościowo **wyłącznie** serwerowo; wszystkie komponenty importują
`ContactFacts` jako `import type`, więc liczba `daysSinceLastHappened` jest liczona raz, na serwerze,
i przekazywana jako dane. To dobra wiadomość: jest **jedno** miejsce do poprawienia dla logiki, a
reszta rozjazdów dotyczy wyłącznie prezentacji.

**Konsekwencja, której `change.md` nie przewidywał:** `ContactMarker.tsx:34` używa
`daysSinceLastHappened === 0` jako predykatu „dziś" do etykiety „Już potwierdzone dzisiaj". Zmiana
matematyki dni zmienia zachowanie tej etykiety — to nie jest zmiana czysto wewnętrzna.

### G. Testy — czego nie ma

- `vitest.config.ts:41` — `test.include` to wyłącznie `tests/rls/**`, `tests/routes/**`, `tests/http/**`.
  **Nie ma globa na testy jednostkowe.** Test podłogi wymaga albo nowego wzorca w configu, albo
  ulokowania w istniejącym katalogu wbrew jego semantyce.
- Alias `@` działa, `cloudflare:workers` jest aliasowany do `tests/stubs/cloudflare-workers.ts`
  (`vitest.config.ts:27-28`) — istotne, bo `run.ts:5` → `ai-jobs.ts:4` importuje `cloudflare:workers`.
- **OpenAI nie jest nigdzie mockowany** — brak precedensu.
- **Brak fabryk** dla `Tables<"people">`, `Tables<"profiles">`, `ContactFacts`.
- **Brak `vi.useFakeTimers`/`vi.setSystemTime` w całym repo**; brak abstrakcji zegara.
- `test-plan.md` §2 Risk #3: „*A malformed, partial or nonsense AI response renders as an
  authoritative hierarchy with no error — the user sees a **wrong order, not a failure***", ze
  wskazaniem hot-spotu `src/lib/ranking`. To jest dokładnie zgłoszony objaw. Odpowiadająca mu
  §3 Faza 3 ma status **not started**, a §6.5 („Adding a test around the AI boundary") to zaślepka
  „TBD". Ten plan pisze **pierwszy** test w tym obszarze ryzyka.
- Bramki jakości są w **§5**, nie §4 — `CLAUDE.md:36,84,118` wskazuje trzykrotnie na „§4 Quality
  Gates", a §4 to „Stack". Nieaktualny wskaźnik w pliku instrukcji dla agentów.
- `scripts/verify-ranking.ts` już wysyła `{ force: true }` (`:127`) i sprawdza poprawność każdego
  `timeWindow` (`:177`) wobec **wdrożonego** Workera — to gotowy szkielet dla kryterium „trzy
  kolejne przeliczenia dają to samo".

## Odniesienia do kodu

- `src/lib/ranking/prompt.ts:59` — klauzula „przede wszystkim na wadze relacji"
- `src/lib/ranking/prompt.ts:64` — konkurencyjna instrukcja o świeżości (dodana przez S-03)
- `src/lib/ranking/prompt.ts:147-150` — bezwarunkowe wysłanie `last_contact_bucket`
- `src/lib/ranking/run.ts:37-70` — `reconcileEntries`, waliduje tylko `personId`
- `src/lib/ranking/run.ts:62` — **precedens uzasadnienia autorstwa kodu**, nie modelu
- `src/lib/ranking/run.ts:88-105` — `facts` ładowane, ale nieprzekazywane do reconcile
- `src/lib/ranking/run.ts:107-111` — wywołanie modelu, bez parametrów determinizmu
- `src/lib/ranking/store.ts:124-128` — `rank_position` = kolejność tablicy modelu
- `src/lib/contact-history/facts.ts:24-25` — dni z różnicy milisekund, serwer/UTC
- `src/lib/contact-history/facts.ts:29-31` — `failedAttemptsSinceLastHappened`
- `src/lib/validation/ranking.ts:10` — `TIME_WINDOW_VALUES`, już w kolejności pilności
- `src/components/hierarchy/HierarchyCard/HierarchyCard.tsx:14-19` — `timeWindow` → cała paleta karty
- `src/components/hierarchy/HierarchyView/HierarchyView.tsx:31-33` — rozwijane trzy pierwsze pozycje
- `src/components/hierarchy/HierarchyView/HierarchyView.tsx:240,268` — „Pozostałe N osób jest spokojnych"
- `src/components/hierarchy/ContactMarker/ContactMarker.tsx:34` — `daysSinceLastHappened === 0`
- `src/components/people/PersonDetailView/PersonDetailView.tsx:298-302` — **wzorzec pierwszeństwa**
- `vitest.config.ts:41` — brak globa dla testów jednostkowych
- `scripts/verify-ranking.ts:127,177` — gotowa ścieżka weryfikacji end-to-end

## Wnioski architektoniczne

**Zasada pominięcia-zamiast-domyślnej-wartości jest w tym repo ustalona i konsekwentna.**
`prompt.ts` stosuje ją dla rytmu (`:69-73` — „rhythmNote MUSI być null") i dla historii kontaktu
(`:104-109` — osoba nieobecna w `facts` nie dostaje bloku). Odcięcie bucketu przy istniejącym udanym
kontakcie jest **trzecim zastosowaniem tej samej zasady**, nie wyjątkiem od niej.

**Uzasadnienie autorstwa kodu jest już zaakceptowanym wzorcem.** `run.ts:62` wpisuje
„Nie udało się wygenerować uzasadnienia dla tej osoby w tym przebiegu." dla osoby pominiętej przez
model. Deterministyczne uzasadnienie towarzyszące podłodze nie wprowadza nowej kategorii — rozszerza
istniejącą. Limit 400 znaków (`ranking_entries.reason` CHECK) obowiązuje.

**Granica model/kod przesuwa się w tej zmianie i trzeba to powiedzieć wprost.** Dotychczas: kod liczy
fakty, model orzeka o kolejności i oknie. Po zmianie: kod dodatkowo gwarantuje dolną granicę
spokoju. Zasada nie jest zastępowana inną — jest zawężana o jeden, nazwany przypadek.

## Kontekst historyczny

- `context/archive/2026-09-01-ai-contact-hierarchy/plan.md:94` — S-02 wyklucza historię kontaktu z zakresu
- `context/archive/2026-09-01-ai-contact-hierarchy/plan.md:155-160` — wąski, celowy zakres reconcile
- `context/archive/2026-09-01-ai-contact-hierarchy/plan.md:288-292` — `no_rush` dodany jako „calm tail",
  bez związku ze świeżością; użycie go jako celu podłogi to **nowe znaczenie** dla tej wartości
- `context/archive/2026-09-02-did-it-happen-feedback-loop/plan.md:130-133` — „nothing about the order
  is computed in code" (zasada nadpisywana przez tę zmianę)
- `context/archive/2026-09-02-did-it-happen-feedback-loop/plan.md:108-110` — „**No recompute triggered
  by marking.**" — decyzja świadoma, z uzasadnieniem kosztowym; dotyczy F-5, nie tej zmiany
- `context/archive/2026-09-02-did-it-happen-feedback-loop/plan.md:147-151` — S-03 **przewidziało
  dokładnie ten raport**: „*the user taps and observes nothing change, which is precisely the 'empty
  loop' failure `roadmap.md` names as this slice's principal risk*"
- `context/archive/2026-09-04-add-person-context-fields/plan.md:80-87` — bucket celowo bez związku z
  `contact_events`; ryzyko zwietrzenia nierozważone
- `context/foundation/lessons.md` — „Verify exact config API in node_modules" (trafione: `seed`)

## Powiązane materiały

- `context/changes/feedback-triage-2026-09-08/triage.md` — triage całego zgłoszenia (F-1…F-7)
- `context/changes/feedback-triage-2026-09-08/evidence/dashboard-2026-09-08-2054.jpeg` — dowód

## Rekomendacje na dwa oddane pytania

**Bucket:** odcinać dokładnie przy `lastHappenedAt !== null`. Uzasadnienie: dorównanie do
`PersonDetailView.tsx:298-302`, zachowanie informacji dla osób z samymi nieudanymi próbami.
Dodatkowo warto przeredagować etykietę promptu tak, by mówiła jasno, że to szacunek użytkownika
sprzed rejestracji — dziś „Ostatni kontakt (szacunkowo)" obok „Nie odnotowano jeszcze udanego
kontaktu" nadal brzmi jak dwa konkurujące fakty.

**Proza:** gdy podłoga zadziała, **zastąpić `reason` zdaniem budowanym z tych samych faktów** i
**posortować stabilnie po pilności**. Uzasadnienie: podłoga odpala się tylko wtedy, gdy model
wykazał się złą oceną tej osoby, więc jego proza o niej nie jest warta zachowania; precedens
uzasadnienia autorstwa kodu istnieje (`run.ts:62`); bez sortowania zamieniamy sprzeczność
proza↔chip na sprzeczność pozycja↔kolor (ustalenie D). Odrzucona alternatywa: druga runda modelu na
przepisanie uzasadnienia — dokłada koszt, opóźnienie i kolejne źródło niedeterminizmu do zmiany,
której celem jest determinizm.

**Progi (propozycja do decyzji):** `d ≤ 2 → no_rush`, `3 ≤ d ≤ 6 → this_month`, `d ≥ 7 → bez podłogi`.
Celowo wąsko: podłoga ma łapać zgłoszony przypadek i nie więcej, bo każdy dodatkowy próg to szersze
nadpisanie zasady z ustalenia 3. Rozszerzać dopiero, gdy F-4 dostarczy dane.

## Pytania otwarte

1. **Progi** — do decyzji użytkownika; propozycja wyżej.
2. **Sortowanie po pilności: tak czy nie?** Jedyny punkt planu, który wprost łamie „nothing about the
   order is computed in code". Alternatywa: zostawić kolejność modelowi i przyjąć rozjazd
   pozycja↔kolor. Rekomendacja: sortować stabilnie, bo rozjazd jest widoczny dla użytkownika.
3. **Strefa czasowa** — trzy opcje, żadna darmowa: (a) zostać przy UTC i udokumentować (w Polsce doba
   UTC kończy się o 01:00/02:00 czasu lokalnego), (b) zaszyć `Europe/Warsaw` (produkt jest wyłącznie
   polskojęzyczny), (c) dodać kolumnę strefy do `profiles`. Wpływa też na `ContactMarker.tsx:34`.
4. **Czy `gpt-5.4-mini` przyjmuje `temperature` w runtime?** Nierozstrzygnięte przez typy i dokumentację.
   Wymaga jednego żywego wywołania **przed** wpisaniem do planu. Rozważyć `reasoning.effort` jako
   udokumentowaną alternatywę dla tej rodziny modeli.
5. **Bucket w formularzu edycji po pojawieniu się zdarzeń** — `PersonEditForm.tsx:240` pozwala zmienić
   szacunek, gdy istnieją już realne zdarzenia, i nic tego nie stempluje czasem. Ponowne wprowadzenie
   tej samej klasy nieaktualności. Poza zakresem F-1, ale warte własnego wpisu.
6. **Sufit (reguła symetryczna)** — czy kod ma też podbijać pilność przy bardzo długiej ciszy?
   Proponuję **jawny non-goal** w tym planie: podbijanie pilności jest ryzykowniejsze niż wygaszanie
   (osoba o wadze 1 mogła być celowo odłożona).
7. **„Pozostałe N osób jest spokojnych"** (`HierarchyView.tsx:240,268`) — twierdzenie oparte na
   **pozycji**, nie na oknie: przy 10 osobach mówi „pozostałe 7 osób jest spokojnych", nawet gdy
   pięć z nich ma `this_week`. Ta sama rodzina błędu. Należy do F-3, ale sortowanie z punktu 2
   czyni to zdanie znacznie bliższym prawdy.
8. **Gdzie ma mieszkać test jednostkowy** — `test.include` nie obejmuje żadnego katalogu
   jednostkowego. Plan musi albo dodać wzorzec, albo świadomie ulokować test w `tests/routes/`.
9. **Nieaktualny wskaźnik w `CLAUDE.md`** — trzy odwołania do „test-plan.md §4 Quality Gates",
   podczas gdy bramki są w §5. Drobiazg, ale to plik instrukcji dla agentów.
