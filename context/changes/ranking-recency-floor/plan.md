# Podłoga świeżości kontaktu — plan wdrożenia

## Overview

Okno czasowe („Odezwij się w tym tygodniu" … „Nie ma pośpiechu") jest dziś w całości wybierane
przez model i nie jest z niczym konfrontowane. W efekcie oznaczenie „rozmawialiśmy dziś" nie zmienia
nic, a trzy kolejne przeliczenia tego samego wejścia dają trzy różne odpowiedzi. Ten plan usuwa
źródło sprzeczności w prompcie i dokłada wąską, deterministyczną regułę w kodzie: świeży kontakt
studzi pilność, zawsze, niezależnie od tego, co zwróci model.

## Current State Analysis

- `prompt.ts:147-150` wysyła `person.last_contact_bucket` **bezwarunkowo**, obok bloku
  „Historia kontaktu". Pole zapisują wyłącznie formularze osoby (`PersonForm.tsx:363`,
  `PersonEditForm.tsx:240`); `POST /api/contact-events` go nie dotyka. Model dostaje więc naraz
  „Ostatni kontakt (szacunkowo): 2–6 miesięcy temu" i „Dni od ostatniego udanego kontaktu: 0".
- `prompt.ts:59` każe rankować „przede wszystkim na wadze relacji". Instrukcja o świeżości
  (`prompt.ts:64`) jest młodsza, miększa i z tamtą konkuruje.
- `reconcileEntries` (`run.ts:37-70`) waliduje **wyłącznie** `personId`. `timeWindow` idzie z modelu
  prosto do bazy. Mapa `facts` istnieje w `run.ts:88-96`, ale trafia tylko do `buildRankingPrompt`.
- `rank_position` to `index + 1` po kolejności tablicy modelu (`store.ts:124-128`), a `timeWindow`
  steruje kolorem plakietki numeru, obramowania, etykiety i pigułki (`HierarchyCard.tsx:14-19`).
- `facts.ts:24-25` liczy dni jako upływ 24-godzinnych bloków w UTC; `ContactChips.tsx:10` liczy dobę
  kalendarzową w strefie przeglądarki. Kontakt sprzed 23 h to „0 dni" w prompcie i „wczoraj" na chipie.
- `profiles` nie ma kolumny strefy ani locale; w repo nie ma żadnej biblioteki dat.
- `vitest.config.ts:41` obejmuje wyłącznie `tests/rls/**`, `tests/routes/**`, `tests/http/**`.
  Żaden test nie dotyka dziś `src/lib/ranking/*` ani `src/lib/contact-history/*`.

## Desired End State

Osoba oznaczona jako „rozmawialiśmy" w ciągu ostatnich dwóch dób kalendarzowych, bez nieudanej próby
od tego czasu, dostaje `no_rush` — w każdym przeliczeniu, niezależnie od wagi relacji i od tego, co
zwróci model. Jej uzasadnienie mówi to samo, co plakietka, a jej pozycja na liście nie stoi ponad
osobami oznaczonymi jako pilniejsze. Żadne uzasadnienie nie powołuje się na szacunek z formularza,
gdy istnieje realny, datowany kontakt.

Weryfikacja: `npm test` (test jednostkowy podłogi) plus `npm run verify:ranking -- <preview-url>`,
który oznacza kontakt i sprawdza stabilność okna w trzech wymuszonych przeliczeniach.

### Key Discoveries

- **Poprawna zasada pierwszeństwa już istnieje w repo.** `PersonDetailView.tsx:298-302` renderuje
  „Ostatni kontakt" jako `facts?.lastHappenedAt` → realna data, inaczej bucket, inaczej „Brak danych".
  Prompt jest jedynym konsumentem, który jej nie stosuje — ta zmiana dorównuje do konwencji, nie
  wprowadza nowej.
- **Prymat wagi to artefakt, nie decyzja.** S-02 wprost wykluczyło historię kontaktu z zakresu
  (`context/archive/2026-09-01-ai-contact-hierarchy/plan.md:94`), więc klauzula z `prompt.ts:59`
  powstała, gdy świeżość nie istniała jako wejście. S-03 dołożyło `prompt.ts:64` nie ruszając starej.
- **Ta zmiana świadomie nadpisuje zapisaną zasadę S-03**: „*Nothing about the order is computed in
  code*" (`context/archive/2026-09-02-did-it-happen-feedback-loop/plan.md:130-133`). Zasada nie jest
  zastępowana — jest zawężana o jeden, nazwany przypadek: dolną granicę spokoju przy świeżym kontakcie.
- **`TIME_WINDOW_VALUES` jest już posortowane malejąco po pilności** (`validation/ranking.ts:10`),
  więc indeks w tej tablicy *jest* rangą pilności. Dziś to własność niejawna.
- **Uzasadnienie autorstwa kodu jest zaakceptowanym wzorcem** — `run.ts:62` już wpisuje własne zdanie
  dla osoby pominiętej przez model. Limit `char_length(reason) <= 400` obowiązuje (CHECK w migracji).
- **`seed` nie istnieje w Responses API** (`openai@7.8.0`): występuje wyłącznie na Chat Completions i
  jest tam `@deprecated`. Nie wolno go wpisać do wywołania.

## What We're NOT Doing

- **Żadnego sufitu.** Kod wygasza pilność przy świeżym kontakcie, ale nigdy jej nie podbija. Długa
  cisza pozostaje sprawą promptu. Podbijanie jest ryzykowniejsze niż wygaszanie — osoba o wadze 1
  mogła zostać celowo odłożona.
- **Żadnego pinowania parametrów losowości.** Ani `temperature`, ani `top_p`, ani `reasoning.effort`.
  Nie jest zweryfikowane, czy `gpt-5.4-mini` przyjmuje je w runtime, a błąd 400 w Workerze zamieniłby
  każdy ranking w `failed job`. Podłoga jest jedyną gwarancją powtarzalności w tej zmianie.
- **Bez zmiany `RANKING_MODEL`.**
- **Bez unieważniania rankingu po oznaczeniu kontaktu** — to F-5, i trzeba tam argumentować przeciwko
  świadomej decyzji S-03 („*No recompute triggered by marking*", `plan.md:108-110`).
- **Bez oznaczania nieaktualnej prozy w UI** — to F-3 (`stale-reason-marking`).
- **Bez poprawki zdania „Pozostałe N osób jest spokojnych"** (`HierarchyView.tsx:240,268`), mimo że
  jest z tej samej rodziny błędu. Należy do F-3; sortowanie z fazy 3 i tak je poprawia pośrednio.
- **Bez zmian w `isStale`** (`store.ts:92-97`) — 24 h świeżości rankingu to inna wielkość niż doba
  kalendarzowa kontaktu i celowo zostaje upływem czasu.
- **Bez ruszania `last_contact_bucket` w formularzu edycji.** To, że można tam nadpisać szacunek przy
  istniejących zdarzeniach, jest realnym długiem, ale własnym.

## Implementation Approach

Cztery fazy, ułożone tak, że najpewniejsza naprawa ląduje pierwsza, a każda kolejna stoi na poprzedniej.

Faza 1 usuwa udowodnioną przyczynę źródłową w prompcie i jest całkowicie niezależna — może zostać
wdrożona sama. Faza 2 ujednolica liczenie dni, bo progi z fazy 3 stoją na tej liczbie i zmiana jej
później unieważniłaby tamte testy. Faza 3 dokłada gwarancję: czystą funkcję podłogi, deterministyczne
uzasadnienie i stabilne sortowanie. Faza 4 dowodzi całości wobec wdrożonego Workera, bo `astro dev`
nie egzekwuje limitów produkcyjnych, a kryterium „trzy przeliczenia dają to samo" wymaga żywego modelu.

## Critical Implementation Details

**Nie usuwaj instrukcji o rozstrzyganiu remisów, przepisując `prompt.ts:59`.** S-03 zaliczyło już raz
tę lekcję w drugą stronę (`did-it-happen-feedback-loop/plan.md:137-145`): skasowanie całej klauzuli
zamiast jej zawężenia otwiera z powrotem ryzyko, które ta klauzula zamykała. Tutaj chodzi o zdanie
„gdy dwie osoby mają tę samą wagę, rozstrzygnij kolejność na podstawie kontekstu z ich opisów"
(`prompt.ts:60`) — to jest kryterium akceptacji US-01 i musi przetrwać przeredagowanie hierarchii.

**Zmiana z fazy 2 przestawia semantykę widocznej etykiety.** `ContactMarker.tsx:34` czyta
`facts.daysSinceLastHappened === 0` jako predykat „dziś" dla napisu „Już potwierdzone dzisiaj".
Po fazie 2 znaczy to „ta sama doba kalendarzowa w Europe/Warsaw" zamiast „mniej niż 24 h temu".
To jest zamierzona poprawka, nie efekt uboczny — ale trzeba ją obejrzeć okiem, nie tylko testem.

**Sortowanie musi być stabilne.** `Array.prototype.sort` jest stabilny od ES2019, więc sortowanie po
samej randze pilności zachowuje kolejność modelu wewnątrz jednego okna. Nie dodawaj drugiego klucza —
to właśnie ta stabilność ogranicza nadpisanie zasady S-03 do minimum.

---

## Phase 1: Prompt — odcięcie bucketu i hierarchia przesłanek

### Overview

Model przestaje dostawać nieaktualny szacunek obok realnych faktów i przestaje być instruowany, że
waga jest ważniejsza od świeżości.

### Changes Required:

#### 1. Blok osoby: bucket tylko wtedy, gdy nie ma realnego kontaktu

**File**: `src/lib/ranking/prompt.ts`

**Intent**: Przestać wysyłać `Ostatni kontakt (szacunkowo): …`, gdy dla osoby istnieje datowany udany
kontakt. Bucket zostaje tym, czym miał być — szacunkiem obowiązującym do pierwszego zdarzenia.

**Contract**: W `buildPeopleSection` (`prompt.ts:129-158`) linia bucketu jest emitowana wtedy i tylko
wtedy, gdy `facts.get(person.id)?.lastHappenedAt` jest nieobecne lub `null`. Osoba z samymi wpisami
`not_yet` **zachowuje** bucket — „Nie odnotowano jeszcze udanego kontaktu" i „szacunkowo pół roku temu"
to fakty zgodne, nie sprzeczne. To ten sam warunek, który stosuje już `PersonDetailView.tsx:298-302`.

#### 2. Etykieta bucketu mówi wprost, skąd pochodzi

**File**: `src/lib/ranking/prompt.ts`

**Intent**: Nawet gdy bucket zostaje, „Ostatni kontakt (szacunkowo)" obok „Nie odnotowano jeszcze
udanego kontaktu" czyta się jak dwa konkurujące fakty. Etykieta ma nazwać go szacunkiem użytkownika
sprzed jakichkolwiek zapisanych zdarzeń.

**Contract**: Zmiana wyłącznie tekstu etykiety w linii budowanej dziś w `prompt.ts:149`. Wartości
`LAST_CONTACT_BUCKET_LABELS` bez zmian — to ten sam słownik, którego używa UI.

#### 3. Hierarchia przesłanek w komunikacie systemowym

**File**: `src/lib/ranking/prompt.ts`

**Intent**: Uczynić świeżość kontaktu pierwszym kryterium pilności, a wagę relacji kryterium
rozstrzygającym w obrębie tego samego poziomu pilności — zamiast dwóch konkurujących instrukcji.

**Contract**: Przeredagowanie `buildSystemMessage` (`prompt.ts:55-76`), konkretnie linii 59 i 64, tak
by tworzyły jedną spójną hierarchię. **Musi przetrwać**: zdanie o rozstrzyganiu remisów kontekstem
z opisów (`prompt.ts:60`, kryterium akceptacji US-01) oraz cała klauzula o niewymyślaniu faktów
(`prompt.ts:62-63`). Zamknięty zbiór wartości `timeWindow` bez zmian.

### Success Criteria:

#### Automated Verification:

- Typy przechodzą: `npx astro check`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Istniejąca sucha przechodzi bez regresji: `npm test`

#### Manual Verification:

- Dla osoby z zapisanym udanym kontaktem prompt nie zawiera już linii z szacunkiem — sprawdzone przez
  zalogowanie treści promptu albo przez uzasadnienie, które przestaje mówić „szacunkowo"
- Osoba z samymi wpisami „Jeszcze nie" nadal ma w prompcie swój szacunek
- Uzasadnienia nadal rozstrzygają remisy kontekstem z opisów, a nie losowo

**Implementation Note**: Po tej fazie zatrzymaj się i poczekaj na potwierdzenie ręcznej weryfikacji.

---

## Phase 2: Wspólne liczenie dni kalendarzowych

### Overview

Jedna funkcja licząca doby kalendarzowe w stałej strefie, używana przez serwer i przez chip, zamiast
dwóch różnych definicji „dziś".

### Changes Required:

#### 1. Moduł dat

**File**: `src/lib/dates.ts` (nowy)

**Intent**: Dać całej aplikacji jedno pojęcie doby. Produkt jest wyłącznie polskojęzyczny, a `profiles`
nie ma kolumny strefy, więc strefa jest zaszytą, nazwaną stałą — jednym miejscem do zmiany, gdyby to
się kiedyś zmieniło.

**Contract**: Eksportuje `APP_TIME_ZONE = "Europe/Warsaw"` oraz funkcję liczącą pełne doby
kalendarzowe między dwiema chwilami widzianymi w tej strefie. Bez biblioteki dat — w repo żadnej nie ma.
Algorytm: sformatować obie chwile przez `Intl.DateTimeFormat` z `timeZone: APP_TIME_ZONE` i locale
dającym `YYYY-MM-DD` (`en-CA`), potraktować oba wyniki jako północe UTC i odjąć. To jedyny sposób
policzenia różnicy dób w danej strefie bez zewnętrznej zależności i dlatego jest tu opisany wprost.

#### 2. `facts.ts` liczy doby, nie bloki 24-godzinne

**File**: `src/lib/contact-history/facts.ts`

**Intent**: `daysSinceLastHappened` ma znaczyć „ile dób kalendarzowych minęło", bo na tej liczbie stoją
progi z fazy 3 i predykat „dziś" w UI.

**Contract**: `foldEvents` (`facts.ts:21-45`) liczy `daysSinceLastHappened` nową funkcją zamiast
`Math.floor((Date.now() - …) / MS_PER_DAY)` (`facts.ts:24-25`). Typ `ContactFacts` bez zmian — nadal
`number | null`, nadal `null` przy braku udanego kontaktu. `MS_PER_DAY` znika, jeśli nic go już nie używa.

#### 3. Chip używa tej samej funkcji

**File**: `src/components/hierarchy/ContactChips/ContactChips.tsx`

**Intent**: Usunąć drugą definicję „dziś", przez którą chip i prompt potrafiły powiedzieć co innego
o tym samym zdarzeniu.

**Contract**: `formatRelativeDate` (`ContactChips.tsx:7-21`) liczy różnicę dób nową funkcją zamiast
pary `toDateString()` + `Math.floor`. Progi prezentacji („dziś" / „wczoraj" / „N dni temu" / data)
bez zmian. Pozostałe formatery dat (`ContactHistorySheet.tsx:33-49`, `PersonCard.tsx:6-20`,
`PersonDetailView.tsx:33-48`) **zostają nietknięte w tej fazie** — to prezentacja poza ścieżką tej zmiany.

### Success Criteria:

#### Automated Verification:

- Typy przechodzą: `npx astro check`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Istniejąca sucha przechodzi: `npm test`

#### Manual Verification:

- Kontakt oznaczony wczoraj wieczorem pokazuje się jako „wczoraj" na chipie **i** liczy się jako 1 dzień
  w uzasadnieniu — nie „dziś" w jednym miejscu i „0 dni" w drugim
- Etykieta „Już potwierdzone dzisiaj" (`ContactMarker.tsx:34`) pojawia się dla kontaktu z dzisiejszej
  doby i znika po północy czasu polskiego, a nie po 24 godzinach
- Historia osoby i karta osoby nadal renderują daty poprawnie (nietknięte, ale warte spojrzenia)

**Implementation Note**: Po tej fazie zatrzymaj się i poczekaj na potwierdzenie ręcznej weryfikacji.

---

## Phase 3: Podłoga, uzasadnienie i kolejność

### Overview

Kod zaczyna gwarantować dolną granicę spokoju: świeży kontakt bez nieudanej próby nie może wylądować
jako pilny, jego uzasadnienie mówi to samo co plakietka, a lista jest uporządkowana po pilności.

### Changes Required:

#### 1. Czysta funkcja podłogi

**File**: `src/lib/ranking/recency-floor.ts` (nowy)

**Intent**: Wyrazić regułę jako funkcję bez zegara, bez sieci i bez bazy — dzięki temu jej test nie
potrzebuje ani `vi.useFakeTimers` (nie ma go dziś w repo), ani mocka OpenAI (nie ma precedensu), ani
fabryki wierszy (nie ma żadnej).

**Contract**: Przyjmuje wybrane przez model `timeWindow` oraz `ContactFacts | undefined` tej osoby,
zwraca docelowe `timeWindow` wraz z informacją, czy podłoga zadziałała.

Zwraca wejście bez zmian, gdy: brak faktów, `lastHappenedAt === null`, `daysSinceLastHappened === null`,
albo `failedAttemptsSinceLastHappened > 0`. Ten ostatni warunek subsumuje `lastAttemptFailed` —
nieudana próba po ostatnim udanym kontakcie zawsze podbija ten licznik (`facts.ts:29-31`) — więc
scenariusz „rozmawialiśmy", a potem „jeszcze nie" tego samego dnia **nie** jest wygaszany, i słusznie.

Tabela progów, jako nazwane stałe:

| dni od udanego kontaktu | najpilniejsze dozwolone okno |
| --- | --- |
| 0–2 | `no_rush` |
| 3–6 | `this_month` |
| ≥ 7 | bez ograniczenia |

„Podłoga" znaczy *nie pilniej niż* — gdy model zwrócił okno spokojniejsze od progu, zostaje jego.
Ranga pilności to indeks w `TIME_WINDOW_VALUES` (`validation/ranking.ts:10`), która jest już
posortowana malejąco po pilności; ta faza ma tę własność nazwać jawnie, a nie polegać na niej milcząco.

#### 2. Deterministyczne uzasadnienie przy zadziałaniu podłogi

**File**: `src/lib/ranking/recency-floor.ts`

**Intent**: Gdy podłoga zadziała, proza modelu uzasadnia okno, którego już nie ma. Zostawienie jej
odtwarza dokładnie tę sprzeczność, którą ta zmiana usuwa.

**Contract**: Funkcja budująca `reason` z tych samych faktów, po polsku, w drugiej osobie („per Ty"),
zgodnie z konwencją reszty uzasadnień. Wynik nie przekracza 400 znaków — `ranking_entries.reason` ma
CHECK `char_length(reason) <= 400`, a `run.ts:50` i tak przycina przez `truncate`. Wzorzec uzasadnienia
pisanego kodem istnieje w `run.ts:62`. `contextNote` i `rhythmNote` zostają nietknięte — dotyczą opisu
osoby i rytmu, nie pilności.

#### 3. Wpięcie podłogi i sortowania w przebieg

**File**: `src/lib/ranking/run.ts`

**Intent**: Zastosować podłogę do każdego wpisu, a potem uporządkować listę po pilności, żeby pozycja
i kolor plakietki nie mówiły dwóch różnych rzeczy.

**Contract**: `reconcileEntries` (`run.ts:37-70`) przyjmuje dodatkowo mapę `facts` — dziś ładowaną
w `run.ts:88-96`, ale przekazywaną wyłącznie do `buildRankingPrompt` (`run.ts:105`). Po uzgodnieniu
tożsamości wpisów podłoga jest stosowana do każdego z nich; wpis, któremu zmieniła okno, dostaje
uzasadnienie z punktu 2. Następnie tablica jest **stabilnie** sortowana po randze pilności przed
przekazaniem do `persistRanking`, który nadaje `rank_position` jako `index + 1` (`store.ts:124-128`),
więc samo posortowanie tablicy wystarczy i `unique (ranking_id, rank_position)` pozostaje spełnione.

Wpisy dołożone przez `reconcileEntries` dla osób pominiętych przez model (`run.ts:56-66`) mają
`no_rush` i podłoga ich nie dotyczy.

#### 4. Log diagnostyczny

**File**: `src/lib/ranking/run.ts`

**Intent**: Bez tego nie da się odpowiedzieć na następne „to nie działa" inaczej niż zgadywaniem —
dokładnie ta luka, przez którą obecne zgłoszenie wymagało zrzutu ekranu.

**Contract**: Istniejący log `[ranking] job … done` (`run.ts:131`) zyskuje liczbę wpisów, którym
podłoga zmieniła okno. Jedna liczba, ten sam prefiks, bez nowego kanału.

#### 5. Katalog testów jednostkowych

**File**: `vitest.config.ts`

**Intent**: `test.include` (`vitest.config.ts:41`) obejmuje dziś wyłącznie `tests/rls/**`,
`tests/routes/**` i `tests/http/**`. Test czystej funkcji nie należy do żadnej z tych warstw.

**Contract**: Dodanie wzorca `tests/unit/**/*.test.ts`. Zgodne z zasadą „jedna warstwa, jeden katalog"
z komentarza przy `vitest.config.ts:35-40` — jednostki są czwartą warstwą, a nie wyjątkiem.

#### 6. Test podłogi

**File**: `tests/unit/recency-floor.test.ts` (nowy)

**Intent**: Pierwszy test w obszarze Ryzyka #3 z `test-plan.md` („*wrong order, not a failure*"),
dla którego §6.5 jest dziś zaślepką „TBD".

**Contract**: Nazewnictwo `describe`/`it` po angielsku, zgodnie z całą suchą. Obiekty `ContactFacts`
budowane ręcznie — w `tests/` nie ma żadnej fabryki. Bez mocków, bez sieci, bez bazy, bez sterowania
zegarem. Pokrycie: każdy przedział progowy po obu stronach granicy (2/3 i 6/7), okno spokojniejsze od
progu pozostawione bez zmian, oraz każdy warunek wyłączający — brak faktów, `lastHappenedAt === null`,
`failedAttemptsSinceLastHappened > 0`. Dodatkowo: stabilność sortowania, czyli że dwie osoby w tym
samym oknie zachowują kolejność nadaną przez model.

### Success Criteria:

#### Automated Verification:

- Nowy test przechodzi: `npm test tests/unit`
- Cała sucha przechodzi: `npm test`
- Typy przechodzą: `npx astro check`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Osoba o wysokiej wadze oznaczona „rozmawialiśmy" dziś dostaje „Nie ma pośpiechu", a jej uzasadnienie
  mówi o świeżym kontakcie, nie o pilności
- Ta osoba nie stoi na pozycji 1 nad osobami z pilniejszym oknem; kolor numeru pozycji zgadza się
  z kolorem plakietki
- Osoba oznaczona „rozmawialiśmy", a potem „jeszcze nie" **nie** jest wygaszana

**Implementation Note**: Po tej fazie zatrzymaj się i poczekaj na potwierdzenie ręcznej weryfikacji.

---

## Phase 4: Weryfikacja end-to-end wobec wdrożonego Workera

### Overview

Kryterium „świeży kontakt daje ten sam wynik w trzech kolejnych przeliczeniach" wymaga żywego modelu
i prawdziwego środowiska. `astro dev` nie egzekwuje limitów produkcyjnych (`lessons.md`), a testy
jednostkowe nie dotykają modelu.

### Changes Required:

#### 1. Scenariusz stabilności w skrypcie weryfikacyjnym

**File**: `scripts/verify-ranking.ts`

**Intent**: Zakodować kryterium akceptacji jako powtarzalny check, a nie jednorazowe kliknięcie.

**Contract**: Po istniejących asercjach skrypt oznacza kontakt dla pierwszej osoby z rankingu
(`POST /api/contact-events` z `outcome: "happened"`), a następnie trzy razy wymusza przeliczenie
(`POST /api/rankings` z `{ force: true }` — wzorzec jest już w `scripts/verify-ranking.ts:125-127`)
i sprawdza, że **ta konkretna osoba** ma `no_rush` w każdym z trzech wyników.

Asercja celowo dotyczy wyłącznie osoby objętej podłogą — nie pinujemy `temperature`, więc pełna
identyczność trzech przebiegów **nie jest** gwarantowana i asercja na nią byłaby migotliwa.

Wymaga `Content-Type: application/json` na każdym POST (`lessons.md`: origin-check odrzuca inaczej
z 403, które nie wygląda jak błąd auth). Skrypt zapisuje realne zdarzenie na koncie weryfikacyjnym —
to trzeba odnotować w jego nagłówku, tak jak odnotowane są tam już wymagania środowiskowe.

### Success Criteria:

#### Automated Verification:

- Skrypt przechodzi wobec wdrożonej wersji: `npm run verify:ranking -- <preview-url>`
- Lint i typy przechodzą: `npm run lint`, `npx astro check`

#### Manual Verification:

- Przejście ścieżki testera na `/dashboard` wdrożonej wersji: oznaczenie „rozmawialiśmy", potem
  „Przelicz teraz" — plakietka zmienia się na spokojną i **zostaje** spokojna po kolejnym przeliczeniu
- Uzasadnienie nie zawiera już frazy „szacunkowo" dla osoby z zapisanym kontaktem
- `wrangler tail` pokazuje log z liczbą wpisów objętych podłogą (pamiętaj: `observability` synchronizuje
  się dopiero przy `versions deploy`, nie przy samym `versions upload` — `lessons.md`)

---

## Testing Strategy

### Unit Tests

- Każdy przedział progowy po obu stronach granicy: 2 vs 3 dni, 6 vs 7 dni
- Okno spokojniejsze od progu pozostaje nietknięte (podłoga to „nie pilniej niż", nie „ustaw na")
- Każdy warunek wyłączający: brak faktów, brak udanego kontaktu, nieudana próba od ostatniego sukcesu
- Stabilność sortowania: dwie osoby w tym samym oknie zachowują kolejność modelu

### Integration Tests

Brak nowych. Ta zmiana nie dotyka granic dostępu ani RLS, więc warstwy `tests/rls` i `tests/routes`
nie zyskują nowych przypadków.

### Manual Testing Steps

1. Osoba o wadze ≥ 8, bez zapisanych zdarzeń → przeliczenie → zapamiętaj okno i uzasadnienie
2. Oznacz „Tak, rozmawialiśmy" → „Przelicz teraz" → okno musi być „Nie ma pośpiechu", uzasadnienie musi
   mówić o świeżym kontakcie
3. „Przelicz teraz" jeszcze dwa razy → okno się nie zmienia
4. Oznacz „Jeszcze nie" dla tej samej osoby → „Przelicz teraz" → podłoga **nie** działa, pilność wraca
5. Osoba z ustawionym `last_contact_bucket`, bez zdarzeń → uzasadnienie nadal może powołać się na szacunek
6. Ta sama osoba po pierwszym „rozmawialiśmy" → uzasadnienie nie powołuje się już na szacunek

## Performance Considerations

Podłoga i sortowanie działają na tablicy ograniczonej przez `PEOPLE_CAP = 50` (`prompt.ts:24`),
w pamięci, po zwróceniu odpowiedzi przez model — czas pomijalny wobec samego wywołania OpenAI.
Nowa funkcja dat tworzy `Intl.DateTimeFormat` na wywołanie; przy 50 osobach to bez znaczenia, ale
formater warto utworzyć raz na moduł, skoro strefa jest stałą.

## Migration Notes

Bez migracji bazy. Zmiana jest w całości forward-compatible: żadna kolumna nie jest dodawana ani
usuwana, a istniejące wiersze `ranking_entries` pozostają czytelne. Rollback kodu Workera
(`wrangler rollback`) przywraca poprzednie zachowanie bez żadnej niespójności danych, bo wszystkie
zmiany dotyczą sposobu wyliczania nowych rankingów, nie kształtu już zapisanych.

## References

- Research: `context/changes/ranking-recency-floor/research.md`
- Triage całego zgłoszenia: `context/changes/feedback-triage-2026-09-08/triage.md`
- Dowód: `context/changes/feedback-triage-2026-09-08/evidence/dashboard-2026-09-08-2054.jpeg`
- Wzorzec pierwszeństwa faktów nad bucketem: `src/components/people/PersonDetailView/PersonDetailView.tsx:298-302`
- Wzorzec uzasadnienia pisanego kodem: `src/lib/ranking/run.ts:62`
- Nadpisywana zasada: `context/archive/2026-09-02-did-it-happen-feedback-loop/plan.md:130-133`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Prompt — odcięcie bucketu i hierarchia przesłanek

#### Automated

- [x] 1.1 Typy przechodzą: `npx astro check`
- [x] 1.2 Lint przechodzi: `npm run lint`
- [x] 1.3 Build przechodzi: `npm run build`
- [x] 1.4 Istniejąca sucha przechodzi bez regresji: `npm test`

#### Manual

- [x] 1.5 Prompt osoby z udanym kontaktem nie zawiera linii z szacunkiem
- [x] 1.6 Osoba z samymi wpisami „Jeszcze nie" nadal ma w prompcie szacunek
- [x] 1.7 Uzasadnienia nadal rozstrzygają remisy kontekstem z opisów

### Phase 2: Wspólne liczenie dni kalendarzowych

#### Automated

- [ ] 2.1 Typy przechodzą: `npx astro check`
- [ ] 2.2 Lint przechodzi: `npm run lint`
- [ ] 2.3 Build przechodzi: `npm run build`
- [ ] 2.4 Istniejąca sucha przechodzi: `npm test`

#### Manual

- [ ] 2.5 Chip i uzasadnienie zgadzają się co do dnia kontaktu sprzed doby
- [ ] 2.6 „Już potwierdzone dzisiaj" znika po północy czasu polskiego, nie po 24 h
- [ ] 2.7 Historia osoby i karta osoby nadal renderują daty poprawnie

### Phase 3: Podłoga, uzasadnienie i kolejność

#### Automated

- [ ] 3.1 Nowy test przechodzi: `npm test tests/unit`
- [ ] 3.2 Cała sucha przechodzi: `npm test`
- [ ] 3.3 Typy przechodzą: `npx astro check`
- [ ] 3.4 Lint przechodzi: `npm run lint`
- [ ] 3.5 Build przechodzi: `npm run build`

#### Manual

- [ ] 3.6 Osoba o wysokiej wadze z kontaktem dziś dostaje „Nie ma pośpiechu" ze spójnym uzasadnieniem
- [ ] 3.7 Kolor numeru pozycji zgadza się z kolorem plakietki; wygaszony wpis nie stoi na pozycji 1
- [ ] 3.8 Sekwencja „rozmawialiśmy" → „jeszcze nie" nie jest wygaszana

### Phase 4: Weryfikacja end-to-end wobec wdrożonego Workera

#### Automated

- [ ] 4.1 Skrypt przechodzi: `npm run verify:ranking -- <preview-url>`
- [ ] 4.2 Lint i typy przechodzą: `npm run lint`, `npx astro check`

#### Manual

- [ ] 4.3 Ścieżka testera na wdrożonej wersji daje spokojną plakietkę, stabilną między przeliczeniami
- [ ] 4.4 Żadne uzasadnienie osoby z kontaktem nie zawiera frazy „szacunkowo"
- [ ] 4.5 `wrangler tail` pokazuje log z liczbą wpisów objętych podłogą
