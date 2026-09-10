---
change_id: e2e-browser-layer
title: Wąska warstwa E2E (Playwright) dla ryzyk #4 i #5
status: archived
created: 2026-09-10
updated: 2026-09-10
archived_at: 2026-09-10T09:37:45Z
---

## Notes

Pierwsza warstwa testów przeglądarkowych w tym projekcie. Powstaje jako realizacja
lekcji M3L4 (`Testy E2E: Playwright, MCP i multimodalne scenariusze`) i prowadzona
jest skillem `/10x-e2e`: PLAN → GENERATE → REVIEW → VERIFY, jedno ryzyko na raz.

**Zakres jest celowo wąski — dwa ryzyka, dwa testy.** `test-plan.md` §1 zasada 1
(cost × signal) obowiązuje dalej: E2E jest najwolniejszą i najbardziej kruchą
warstwą, więc trafiają tu wyłącznie ryzyka, których tańszy test nie udowodni.

- **Ryzyko #4** (odroczony job rankingu nigdy nie osiąga stanu terminalnego, widok
  odpytuje w nieskończoność). Pętla pollingu żyje wyłącznie w wyrenderowanym UI —
  `HierarchyView.tsx` odpytuje `/api/rankings?jobId=` z przeglądarki, `MAX_POLL_ATTEMPTS`
  i przejście do `status: "failed"` nie istnieją poza zamontowanym komponentem.
  Żaden test integracyjny na trasach tego nie widzi.
- **Ryzyko #5** (niezalogowany odwiedzający sięga po dane relacyjne). Pełny łańcuch
  cookie → `src/middleware.ts` → redirect, plus kontrola pozytywna: realna sesja
  przeżywa prawdziwe przeładowanie strony SSR. To jest dokładnie ten przypadek,
  który §7 test-planu wskazywał jako powód do ponownej oceny wykluczenia E2E
  („a cookie/session crossing the Workers boundary is the likeliest candidate").

**Poza zakresem, świadomie:**

- Ryzyko #3 (malformowana odpowiedź AI renderowana jako autorytatywna hierarchia).
  Wywołanie modelu jest serwerowe, więc `page.route()` go nie przechwyci; mock
  musiałby siedzieć na tym samym `/api/rankings`, co dubluje test ryzyka #4.
  Zostaje na warstwie kontraktowej — `test-plan.md` §3 Faza 3.
- Ryzyka #1, #2, #6, #7 — dowodzone taniej na warstwie integracyjnej, bez przeglądarki.
- Regresja wizualna i tryb wizyjny (`--caps=vision`). §7 test-planu wyklucza je
  osobno i ta zmiana tego nie rusza.

**Stan wyjściowy (rozpoznanie 2026-09-10):** brak `@playwright/test`, brak
`playwright.config.*`, brak `tests/e2e/`. Globalny `playwright-cli` jest zainstalowany
(zadanie z lekcji). Lokalny stack Supabase odpowiada, dev server na 4321 działa.
Skill `/10x-e2e` z założenia **nie** stawia infrastruktury — to robi Faza 1 tego planu.

**Konwencja serwera, przeniesiona z `tests/http`:** suite nigdy nie startuje serwera.
Dev server uruchamia człowiek, adres wchodzi przez `E2E_BASE_URL`. Powód jest ten sam
co w §6.1 test-planu i dodatkowo praktyczny: `astro dev` to zadanie użytkownika,
nie agenta.


## Status 2026-09-10

All four phases complete. Every Progress row is closed.

Green: `npm run test:e2e` runs seven tests (setup, seed, two Risk #4 tests, two
Risk #5 tests, teardown) and passes twice in a row. `npm test`, `npm run lint`,
`npx astro check` and `npm run build` all pass alongside it.

All three deliberate breaks were run and all three turned their spec red:
the `failed` branch and the attempts bound in `HierarchyView` for Risk #4, and
`/dashboard` leaving `PROTECTED_ROUTES` for Risk #5. Every break is reverted and
none was committed. The Risk #5 break needed a dev server restart on either side
of it, because `src/middleware.ts` does not hot-reload — its first run reported a
false all-clear, which is now written into `E2E_RULES.md` and test-plan §6.7.

Committed as `067f526` (the layer) and `a23c1ed` (commit SHAs written back into
Progress). Implementation review run 2026-09-10 -- see
`reviews/impl-review.md`; verdict NEEDS ATTENTION, three warnings fixed, one
(F1, user-leak-on-partial-seed) deliberately skipped.
