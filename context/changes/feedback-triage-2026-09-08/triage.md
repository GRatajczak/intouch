# Triage: feedback testera (FB, 2026-09-08)

Źródło: rozmowa na Messengerze z testerem korzystającym z produkcji, plus zrzut ekranu
z 20:54 — `evidence/dashboard-2026-09-08-2054.jpeg`.

Ten dokument jest **triage'em**, nie wynikiem `/10x-plan` — każda naprawa niżej ma
zaproponowany `change-id` i przechodzi normalną ścieżkę `/10x-new → /10x-research →
/10x-plan → /10x-implement`.

---

## 1. Co zgłosił tester

| # | Cytat | Objaw |
| --- | --- | --- |
| Z-1 | „a tam mailing Ci działa?" | Nie wiadomo, czy maile w ogóle chodzą |
| Z-2 | „nie robiłbym wyloguj na pasku bo za łatwo się wyjebać" | Wylogowanie jednym mis-tapem |
| Z-3 | „jak zaznaczę że kontakt: dziś to wciąż mam że w ciągu miesiąca (tak jakby się nic nie zmieniło)" | Oznaczenie kontaktu nie wpływa na okno czasowe |
| Z-4 | „a jak dasz przelicz teraz? — no właśnie też nic" | Ręczne przeliczenie nie zmienia wyniku |
| Z-5 | „a teraz w ogóle hit, bo mi przestawiło… że w ciągu 2 tyg" → „dałem znowu przelicz — »nie ma pośpiechu«" | Ten sam input, trzy różne odpowiedzi |
| Z-6 | „jakąś inkrementację tam masz chyba bez sprawdzania daty" | Hipoteza testera co do przyczyny |

---

## 2. Dowód ze zrzutu ekranu

Zrzut z 20:54 pokazuje jedną kartę („Janusz", Znajomy/Znajoma, waga 4/10) i rozstrzyga
to, czego z samego tekstu rozstrzygnąć się nie dało.

**Karta zawiera dwa sprzeczne zdania o tej samej osobie, trzy linijki od siebie:**

| Element karty | Treść | Skąd pochodzi |
| --- | --- | --- |
| Uzasadnienie „DLACZEGO TERAZ" | „ostatni kontakt był **szacunkowo 2–6 miesięcy temu**" | proza modelu, zamrożona w `ranking_entries.reason` |
| Chip pod spodem | „Ostatni kontakt **dziś**" | `ContactChips.tsx:40-45`, liczony na żywo z `ContactFacts` |

Sformułowanie **„szacunkowo 2–6 miesięcy temu"** to dosłowne echo linii, którą składa
`prompt.ts:149`:

```
  Ostatni kontakt (szacunkowo): ${LAST_CONTACT_BUCKET_LABELS[bucket]}
```

gdzie `LAST_CONTACT_BUCKET_LABELS.two_to_six_months` = `"2–6 miesięcy temu"`. Model nie
wymyślił tej daty — **zacytował nieaktualne pole `last_contact_bucket`**. Przyczyna (a)
z sekcji 3 przestaje być hipotezą.

**Rozstrzygnięta niejednoznaczność:** plakietka na karcie to „W ciągu miesiąca" =
`TIME_WINDOW_LABELS.this_month`. Tester mówił więc o **oknie czasowym**, nie o polu
„ostatni kontakt". To ten enum trzeba naprawić.

**Skala problemu jest większa, niż wygląda:** baner mówi „na podstawie **1 osoby**". Przy
jednej osobie kolejność nie niesie żadnej informacji — cała wartość produktu na tym
ekranie siedzi w oknie czasowym i uzasadnieniu, czyli dokładnie w tym, co jest zepsute.

**Konkretny przypadek testowy, wprost ze zrzutu:** waga 4/10, relacja „Znajomy/Znajoma",
kontakt dziś, brak nieudanych prób → produkt zwrócił `this_month` („W ciągu miesiąca")
i prozę „warto odezwać się w najbliższym czasie". Poprawna odpowiedź to `no_rush`.

**Baner przeczy sam sobie:** „Kolejność odświeżona dziś o 20:53" i jednocześnie „Twoje
odpowiedzi trafią do kolejności przy następnym przeliczeniu". Drugi komunikat pochodzi
z `dashboard.astro:36-41` (istnieje `contact_event` z `created_at` późniejszym niż
`ranking.created_at`) — czyli w momencie zrzutu ranking był już znany jako nieaktualny,
a mimo to prezentowany jako świeży, bez żadnego oznaczenia na samej karcie.

**Z-2 potwierdzone wizualnie:** dolny pasek ma pięć pozycji — cztery z `NAV_ITEMS` plus
„Wyloguj" o identycznej ikonie i typografii, tuż obok „Ustawienia".

---

## 3. Diagnoza

### Z-6 najpierw: hipoteza testera jest nietrafiona

W kodzie **nie ma żadnej inkrementacji okna czasowego**. `timeWindow` nie jest nigdzie
przesuwany, liczony ani kumulowany — jest w całości wybierany przez model
(`src/lib/ranking/run.ts:107-111`) i zapisywany bez zmian. Objaw z Z-5 to wariancja LLM
przy braku twardej reguły, nie licznik. Zapisuję to, żeby nikt nie szukał nieistniejącego
inkrementu.

### Z-3 — trzy niezależne przyczyny

**(a) Prompt dostaje dwa sprzeczne fakty o tej samej osobie. — POTWIERDZONE zrzutem**

`prompt.ts:147-150` dokleja `person.last_contact_bucket`. To pole zapisują **wyłącznie**
formularze osoby (`PersonForm.tsx:363`, `PersonEditForm.tsx:240`) i **nigdy** nie jest
aktualizowane przy zapisie `contact_event` — sprawdzone, poza tymi dwoma miejscami nie ma
żadnego zapisu. Kilka linii niżej (`prompt.ts:110-127`) ta sama osoba dostaje blok
`Historia kontaktu: - Dni od ostatniego udanego kontaktu: 0`.

Model widzi naraz nieaktualny szacunek sprzed miesięcy i prawdę o zerze dni — i, jak
pokazuje zrzut, **wybiera szacunek**.

**(b) Prompt każe rankować przede wszystkim wagą.**

`prompt.ts:59`: „opierając się **przede wszystkim na wadze relacji**". Świeżość kontaktu
pojawia się dopiero w `prompt.ts:64` jako miękkie „MUSI obniżać pilność", konkurujące
z wcześniejszym twardym „przede wszystkim".

**(c) Brak deterministycznej podłogi po stronie kodu.**

`reconcileEntries` (`run.ts:37-70`) waliduje **wyłącznie** `personId` — odrzuca
halucynowane id i dokleja pominięte osoby. `timeWindow` przechodzi z modelu prosto do
bazy, bez żadnej konfrontacji z `daysSinceLastHappened`. W `openai.responses.parse`
(`run.ts:107-111`) nie jest pinowany żaden parametr sterujący losowością. (Korekta po researchu F-1:
`seed` nie istnieje w Responses API — tylko `temperature`/`top_p`/`reasoning.effort`.) To bezpośrednia
przyczyna Z-5: nic w systemie nie gwarantuje, że ten sam input da ten sam wynik.

### Z-4 — przycisk działa, wynik nie

Ścieżka jest poprawna: `handleManualRefresh` → `dispatchRefresh(true)`
(`HierarchyView.tsx:190-193`) → `POST /api/rankings {force:true}` → short-circuit
`fresh` pominięty (`rankings.ts:39-44`) → nowy job. Przeliczenie **faktycznie się
wykonuje**; identyczny wynik to skutek (a)/(b)/(c), nie zepsutego przycisku.

Problem wtórny: **nie mamy dowodu z bazy**. Nigdzie nie zapisujemy, jakie fakty model
widział w danym przebiegu. Zrzut ekranu wystarczył tym razem, bo model przypadkiem
zacytował swoje źródło — na to nie można liczyć przy następnym zgłoszeniu.

### Z-2 — wylogowanie jako piąta zakładka

`src/components/layout/BottomNav.astro:37-43`: `<form method="POST"
action="/api/auth/signout">` renderowany jako piąty kafelek, `flex-1`, ten sam rozmiar
ikony i typografia co zakładki nawigacji, bez potwierdzenia. Komentarz w kodzie sam
przyznaje, że nie ma go w mocku i został dodany, bo `AppSidebar` jest `hidden lg:flex`.

### Z-1 — mailingu produktowego nie ma

`src/worker.ts:10-40` — handler `scheduled` wysyła **jedną stałą wiadomość-dowód**
(„InTouch — sprawdzenie ścieżki dostarczania") na `RESEND_TEST_RECIPIENT`, z nadawcy
`onboarding@resend.dev` (piaskownica Resend — dostarcza wyłącznie na adres właściciela
konta Resend). To zakres `F-04` (dowód ścieżki), nie `S-04`.

`S-04: Decay-driven reminders` ma w `context/foundation/roadmap.md` status **blocked**,
a blokerem jest jedna decyzja produktowa: reguła kadencji („raz dziennie" to sufit z NFR,
nie trigger). Odpowiedź dla testera: nie, i nie miało działać.

### Z-7 — znalezione przy okazji, niezgłoszone

- **Ranking nie jest unieważniany po oznaczeniu kontaktu.** `applyFactsUpdate`
  (`HierarchyView.tsx:66-75`) ustawia tylko lokalny `pendingAnswers`. `isStale` to sztywne
  24 h (`store.ts:7`), więc auto-refresh nie odpali.
- **`daysSinceLastHappened` liczy dni z różnicy milisekund**, nie z dni kalendarzowych
  (`facts.ts:24-25`). Kontakt wczoraj o 23:00 odczytany dziś o 8:00 = `0 dni`. Przy regule
  progowej z F-1 zaczyna to mieć znaczenie. `ContactChips.formatRelativeDate` ma tu inną
  logikę niż `facts.ts` (porównuje `toDateString()`), więc chip i prompt mogą się rozjechać
  o jeden dzień.
- **Nie da się wpisać daty zdarzenia.** `createContactEventSchema`
  (`validation/contact-event.ts:14-19`) nie ma pola daty, a `occurred_at` ma
  `default now()`. Można zapisać tylko „zdarzyło się teraz".

---

## 4. Plan naprawy

### P0 — kasuje zgłoszony objaw

**F-1 · `ranking-recency-floor`** — okno czasowe przestaje być loterią

1. W `prompt.ts` **nie wysyłaj `last_contact_bucket`, gdy osoba ma blok „Historia
   kontaktu"**. Bucket zostaje tym, czym miał być: seedem do pierwszego rankingu, zanim
   pojawi się jakiekolwiek zdarzenie. To ta sama zasada pominięcia-zamiast-domyślnej-
   wartości, którą plik już stosuje dla rytmu i faktów. **To jest naprawa, którą zrzut
   ekranu wskazuje palcem.**
2. Odwróć hierarchię przesłanek w `buildSystemMessage`: świeżość kontaktu jest **pierwszym**
   kryterium pilności, waga rozstrzyga **w obrębie** tego samego poziomu. Usuń „przede
   wszystkim na wadze relacji" — to zdanie aktywnie walczy z pętlą feedbacku z `S-03`.
3. Dodaj w `run.ts` **deterministyczną podłogę** po odpowiedzi modelu: jeśli
   `daysSinceLastHappened <= N` i `failedAttemptsSinceLastHappened === 0`, `timeWindow`
   nie może być pilniejszy niż ustalony próg. Progi jako nazwane stałe, jedna tabela
   `dni → najpilniejsze dozwolone okno`. To jedyna zmiana, która czyni zachowanie
   **powtarzalnym** — reszta tylko poprawia szanse.
4. Ujednolić liczenie dni: `facts.ts` i `ContactChips` mają dziś dwie różne definicje
   „dziś". Jedna funkcja, dni kalendarzowe, strefa udokumentowana.

*Kryteria akceptacji:*
- Przypadek ze zrzutu: waga 4, kontakt dziś, brak nieudanych prób → `no_rush`
  w **każdym** z trzech kolejnych przeliczeń.
- Żadne uzasadnienie nie zawiera frazy „szacunkowo", gdy osoba ma zapisane zdarzenie.
- Test jednostkowy podłogi (bez wołania modelu); obecne testy w `tests/` zostają zielone.

**F-2 · `signout-placement`** — wylogowanie przestaje być pułapką

- Usuń kafelek wylogowania z `BottomNav.astro`; pasek wraca do czterech pozycji z
  `NAV_ITEMS`.
- Przenieś wylogowanie do `/settings` (już jest w nawigacji) jako osobną sekcję.
- Rozważ `alert-dialog.tsx` na potwierdzenie — komponent jest w repo i już używany
  w `DeleteDataSection`.

*Kryterium akceptacji:* na szerokości mobilnej wylogowanie jest osiągalne wyłącznie
z `/settings`, a `AppSidebar` (desktop) zachowuje się jak dotąd.

**F-3 · `stale-reason-marking`** — karta przestaje kłamać

Nowe, wprost ze zrzutu: `ContactChips` renderuje **na żywo** z `ContactFacts`, a
`entry.reason` to **zamrożona** proza z ostatniego rankingu. Gdy `hasPendingAnswers` jest
prawdą, te dwa elementy stoją obok siebie i mogą się wykluczać — i tak właśnie było.

- Gdy dla osoby istnieje zdarzenie nowsze niż `ranking.created_at`, oznacz jej
  uzasadnienie jako nieaktualne (wyszarzenie + etykieta w rodzaju „sprzed Twojej
  ostatniej odpowiedzi"), zamiast prezentować je jako bieżące.
- Popraw baner: „Kolejność odświeżona" i „Twoje odpowiedzi trafią do kolejności przy
  następnym przeliczeniu" nie mogą stać obok siebie jako równorzędne zdania.

*Kryterium akceptacji:* nie istnieje stan UI, w którym chip „Ostatni kontakt dziś"
i proza o kontakcie sprzed miesięcy są renderowane jako tak samo aktualne.

### P1 — żeby następny raport dało się zdiagnozować

**F-4 · `ranking-observability`** — zapisz, co model widział

- Snapshot faktów per wpis w `ranking_entries` (`days_since_last_happened`,
  `failed_attempts_since_last_happened`) — migracja **forward-compatible**: nowe kolumny
  nullable, wypełniane przy zapisie, czytane dopiero po deployu (zasada z `CLAUDE.md`).
- Log `[ranking]` z liczbą osób, dla których blok „Historia kontaktu" trafił do promptu.

*Kryterium akceptacji:* po kolejnym „to nie działa" odpowiadam z bazy, czy model dostał
świeży fakt, czy go zignorował — bez polegania na tym, że przypadkiem zacytuje źródło.

**F-5 · `ranking-invalidation-on-mark`** — oznaczenie kontaktu unieważnia kolejność

- Zapis `contact_event` oznacza bieżący ranking jako nieaktualny, więc następne wejście
  na `/dashboard` odpala auto-refresh, nie czekając na 24 h z `STALE_AFTER_MS`.
- Baner mówi wprost, kiedy nastąpi przeliczenie.

### P2 — dług i decyzja produktowa

**F-6 · `contact-event-backdating`** — data zdarzenia w formularzu (domyślnie dziś),
walidowana jako nie-z-przyszłości. Bez tego „rozmawialiśmy we wtorek" nie ma reprezentacji.

**F-7 · `S-04` odblokowanie** — to nie bug fix, tylko slice z roadmapy zablokowany na
Twojej decyzji: **reguła kadencji** (co wyzwala maila, nie jak często wolno) oraz
**zawartość jednej wiadomości** (jedna osoba / top kilka / cała hierarchia). Do czasu
podjęcia tej decyzji UI nie powinno w żadnym miejscu sugerować, że maile chodzą.

---

## 5. Kolejność

```
F-1 ─┐
     ├─ (równolegle, rozłączne plikowo)
F-2 ─┘
      ↓
F-3 ── F-4 ── F-5        (F-4 przed F-5: bez telemetrii nie zweryfikujesz F-5)
      ↓
F-6
      ↓
F-7  ← wymaga Twojej decyzji, nie kodu
```

`F-1` (`src/lib/ranking/*`) i `F-2` (`src/components/layout/*`) nie dotykają tych samych
plików — nadają się na dwa równoległe przebiegi agenta. `F-3` dotyka
`HierarchyCard`/`RefreshBanner`, więc wchodzi po `F-2`.

## 6. Poza zakresem

- Zmiana modelu (`RANKING_MODEL = "gpt-5.4-mini"`) — najpierw podłoga i prompt; wymiana
  modelu przed nimi zamaskuje przyczynę zamiast ją usunąć. Zrzut pokazuje zresztą, że
  model zachował się racjonalnie wobec danych, które dostał.
- Znany wyścig KV opisany w `rankings.ts:46-56` — świadomie zaakceptowany, bez związku
  z tymi zgłoszeniami.
- Domknięcie `S-05` (`person-lifecycle-and-erasure`, `in-progress`) — osobny wątek.
