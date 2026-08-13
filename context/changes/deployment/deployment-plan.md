# Plan integracji Cloudflare + pierwszy deployment — InTouch

## Context

`context/foundation/infrastructure.md` (2026-08-10) wybrał **Cloudflare Workers** jako platformę MVP (5.0/5, runner-up Railway). Repo to świeżo zbootstrapowany `10x-astro-starter` — jeden commit `init`, tylko scaffolding auth (signin/signup/signout + `/dashboard`), zero modelu danych, zero kodu FR-007/FR-008.

**Żadne z zaleceń `infrastructure.md` nie zostało jeszcze zastosowane w repo.** Dodatkowo eksploracja wykryła defekty, których `infrastructure.md` nie zna. Celem jest: doprowadzić obecny stan aplikacji do działającej produkcji na `*.workers.dev`, z powtarzalnym CI/CD i bez pułapek, które ugryzą później.

**Zakres (decyzja użytkownika):** tylko deploy obecnego stanu. Bez custom worker entrypoint, bez Queues/Workflows, bez cron. CI/CD: GitHub Actions + `wrangler-action`. Supabase: projekt cloud już istnieje. Adres: `intouch.<subdomena>.workers.dev`.

---

## Ustalenia z researchu (zweryfikowane, nie z pamięci)

Potwierdzone przeciwko dokumentacji i `node_modules`:


| Fakt                                                                                                               | Źródło                                                  | Konsekwencja                                                                       |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `@astrojs/cloudflare` v13 usunął wsparcie Pages **i** `Astro.locals.runtime`                                       | docs.astro.build                                        | `tech-stack.md` mówi `cloudflare-pages` → do naprawy                               |
| Free plan: **10 ms CPU**, **50 subrequestów**/request, 100k req/dzień                                              | CF limits                                               | nie blokuje obecnego stanu; ryzyko dopiero przy FR-007                             |
| `imageService` default = `'cloudflare-binding'`                                                                    | docs.astro.build                                        | tworzy binding `IMAGES` (lokalny state `.wrangler/state/v3/images` już istnieje)   |
| Astro 6 + adapter v13 **auto-provisionuje KV** na sesje przy deployu                                               | docs.astro.build                                        | nieproszony zasób + szerszy scope tokenu; `session: false` to wyłącza              |
| Workers Builds default deploy command = `wrangler versions upload` dla non-prod, `wrangler deploy` dla prod branch | CF builds docs                                          | nie dotyczy nas — idziemy w GitHub Actions                                         |
| Preview URL = `<VERSION_PREFIX>-<WORKER>.<SUBDOMAIN>.workers.dev`, **publiczny**, od 09.2025 domyślnie opt-in      | CF previews + changelog                                 | `preview_urls` ustawić jawnie                                                      |
| `cloudflare/wrangler-action@v4`, wymaga `apiToken` + `accountId`                                                   | GitHub / CF docs                                        |                                                                                    |
| Queues / Durable Objects (SQLite) / Workflows **są dostępne na free planie**                                       | CF pricing / changelog 2025-04-07                       | dobra wiadomość dla przyszłego FR-007/008 — `infrastructure.md` tego nie odnotował |
| `@supabase/ssr@0.10.3` `setAll(cookies, **headers**)` — drugi argument z `Cache-Control: private, no-store…`       | `node_modules/@supabase/ssr/dist/main/types.d.ts:17-46` | **repo ignoruje ten argument** — patrz Faza 1, punkt bezpieczeństwa                |
| Legacy klucze `anon`/`service_role` deprecated do końca 2026, następcy: `sb_publishable_*` / `sb_secret_*`         | supabase.com/docs                                       | do odnotowania, nie blokuje                                                        |
| `@astrojs/cloudflare/handler` istnieje w exports map (v13.5.0)                                                     | `node_modules/.../package.json`                         | ścieżka na przyszły `scheduled()` handler jest potwierdzona                        |


### Defekty wykryte w repo, których `infrastructure.md` nie zawiera

1. `**.github/workflows/ci.yml` triggeruje na `master`, a branch to `main`** → CI dziś **nigdy się nie uruchamia**. Zielone repo jest złudzeniem.
2. **Brak jakiegokolwiek workflow deployu** i brak skryptu `deploy` w `package.json`.
3. `**src/lib/supabase.ts:17` — `setAll(cookiesToSet)` pomija argument `headers`.** Biblioteka przekazuje tam nagłówki anty-cache dokładnie po to, by CDN nie zbuforował odpowiedzi z `Set-Cookie` zawierającym token sesji. Cloudflare **jest** CDN-em. To jedyna zmiana w kodzie aplikacji w tym planie i jest uzasadniona wyłącznie tym, że wchodzimy za CDN.
4. `**src/lib/config-status.ts` liczy braki configu w module scope, a `Layout.astro` renderuje baner „Supabase nie jest skonfigurowany"** — przy `envField(..., optional: true)` deploy bez sekretów **przechodzi**, a produkcja pokazuje polski baner błędu zamiast twardo paść.
5. **Brak `.dev.vars`** (README każe go stworzyć) → lokalny dev nie ma configu.
6. `**site` nieustawione**, a `sitemap()` jest w integrations → integracja jest no-opem.
7. `wrangler.jsonc` ma `not_found_handling: "404-page"` — do zweryfikowania na preview, czy nie przechwytuje dynamicznych tras SSR (dokumentacja CF jest w tej kwestii niejednoznaczna, więc **testujemy zamiast zgadywać**).

---

## Fazy

### ☐ Faza 0 — Pre-flight (read-only, bez zmian)

- [x] `npm ci && npx astro sync && npm run build` — potwierdź, że build przechodzi na czystym stanie
- [x] `npx wrangler --version` — potwierdź 4.90.x
- [x] Zapisz baseline: `git status` czysty poza znanymi untracked plikami z `context/`

---

### ☐ Faza 1 — Naprawa kontraktów i konfiguracji repo

Zmiany niezależne od produkcyjnego URL-a.

**Kontrakty:**

- [ ] `context/foundation/tech-stack.md` → `deployment_target: cloudflare-workers` (było `cloudflare-pages`; ryzyko #1 z `infrastructure.md`)
- [ ] `CLAUDE.md` → dopisz sekcję „Cloudflare: Workers, nie Pages": adapter v13 nie wspiera Pages; `wrangler pages deploy` jest zakazane; dostęp do env wyłącznie przez `astro:env/server` (nie `Astro.locals.runtime`, nie `process.env`)

**Tożsamość projektu:**

- [ ] `wrangler.jsonc` → `"name": "intouch"` (determinuje subdomenę `*.workers.dev`)
- [ ] `package.json` → `"name": "intouch"`

**Konfiguracja adaptera — `astro.config.mjs`:**

- [ ] `adapter: cloudflare({ imageService: 'compile' })` — PRD ma „brak zdjęć" w non-goals; domyślny `cloudflare-binding` tworzy binding `IMAGES` i twardy klif 5 000 transformacji/mies. (błąd 9422)
- [ ] `session: false` — nic nie używa sesji Astro (auth idzie przez ciasteczka Supabase). Bez tego `wrangler deploy` auto-provisionuje namespace KV, co w nieinteraktywnym CI jest niepotrzebnym ryzykiem i wymusza szerszy scope tokenu. Powrót to jedna linia, gdyby sesje były kiedyś potrzebne.

`**wrangler.jsonc` — reszta:**

- [ ] Dodaj `"workers_dev": true` i `"preview_urls": true` jawnie (od 09.2025 preview URL-e są opt-in; `preview_urls` domyślnie podąża za `workers_dev`, ale poleganie na tym jest kruche)
- [ ] Zostaw `observability.enabled: true`, `compatibility_date: "2026-05-08"`, `compatibility_flags: ["nodejs_compat"]` — poprawne

**Skrypty — `package.json`:**

- [ ] `"deploy": "astro build && wrangler deploy"`
- [ ] `"preview:upload": "astro build && wrangler versions upload"`
- [ ] `"cf-typegen": "wrangler types"`

**Bezpieczeństwo (jedyna zmiana w kodzie aplikacji):**

- [ ] `src/lib/supabase.ts` → `setAll(cookiesToSet, headers)`: obok `cookies.set(...)` przepisz `headers` na odpowiedź. Bez tego odpowiedź z `Set-Cookie` niosącym token sesji nie ma `Cache-Control: private, no-store` i może zostać zbuforowana przez CDN → sesja jednego użytkownika trafia do innego. Ryzyko materializuje się dopiero za Cloudflare, więc należy do tego planu.
  - Uwaga implementacyjna: w Astro `setAll` nie ma bezpośredniego dostępu do obiektu `Response`. Najprostsze poprawne rozwiązanie: zebrać `headers` do zmiennej w `createClient` i nałożyć je w `src/middleware.ts` na `response` zwracany z `next()`. Alternatywnie — bezwarunkowo ustawić te trzy nagłówki dla tras uwierzytelnionych.

**Lokalny dev:**

- [ ] Stwórz `.dev.vars` (gitignorowany — potwierdzone w `.gitignore`) z `SUPABASE_URL` i `SUPABASE_KEY` z istniejącego projektu Supabase
- [ ] `npm run dev` → potwierdź brak banera „Supabase nie jest skonfigurowany" i działający signin

Pliki: `context/foundation/tech-stack.md`, `CLAUDE.md`, `wrangler.jsonc`, `astro.config.mjs`, `package.json`, `src/lib/supabase.ts`, `src/middleware.ts`, `.dev.vars` (nowy)

---

### ☐ Faza 2 — Konto Cloudflare, token, sekrety (kroki człowieka — nie delegować)

Zgodnie z granicą uprawnień z `infrastructure.md`: `wrangler secret put` i promocja na produkcję to operacje ludzkie.

- [ ] `npx wrangler login` — uwierzytelnienie lokalne (OAuth)
- [ ] `npx wrangler whoami` — zanotuj **Account ID** i **subdomenę `*.workers.dev`**; od tej chwili produkcyjny URL to `https://intouch.<subdomena>.workers.dev`
- [ ] Utwórz API token w dashboardzie: szablon **„Edit Cloudflare Workers"**, ograniczony do tego jednego konta, **bez DNS, bez billingu, bez zone-wide**
  - Znany gotcha: mieszanie OAuth (`wrangler login`) lokalnie i tokenu w CI dla tego samego Workera bywa źródłem dziwnych błędów uprawnień — jeśli deploy z CI zacznie się sypać na permissions, to pierwszy podejrzany
- [ ] Dodaj do GitHub Secrets repo `GRatajczak/intouch`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_KEY`
- [ ] Ustaw sekrety produkcyjne Workera (ręcznie, jednorazowo):
  ```bash
  npx wrangler secret put SUPABASE_URL
  npx wrangler secret put SUPABASE_KEY
  ```
- [ ] `npx wrangler secret list` → potwierdź obecność **nazw** (wartości są write-only i nigdy się nie wyświetlą)
- [ ] Zapisz w `CLAUDE.md`: sekrety żyją w trzech miejscach (`.dev.vars` / Workers Secrets / GitHub Secrets); **Workers Secrets to źródło prawdy dla produkcji**

---

### ☐ Faza 3 — Konfiguracja zależna od produkcyjnego URL-a

To jest właściwa integracja zewnętrzna — pominięcie jej sprawia, że rejestracja i potwierdzanie e-maila działają lokalnie, a na produkcji nie.

- [ ] `astro.config.mjs` → `site: "https://intouch.<subdomena>.workers.dev"` (odblokowuje `sitemap()`, dziś no-op)
- [ ] **Supabase Dashboard → Authentication → URL Configuration:**
  - [ ] `Site URL` = `https://intouch.<subdomena>.workers.dev`
  - [ ] `Redirect URLs` = ten sam adres + `https://*-intouch.<subdomena>.workers.dev/`** dla preview URL-i (wzorzec z wersjonowanym prefiksem) + `http://localhost:4321/**` dla dev
- [ ] Sprawdź w Supabase, czy potwierdzanie e-maila jest włączone. `src/pages/auth/confirm-email.astro:4` używa `import.meta.env.DEV` do auto-potwierdzania — **na produkcji ta ścieżka jest nieaktywna**, więc link z maila musi realnie działać, inaczej nikt nie założy konta
- [ ] Odnotuj (bez zmiany): projekt używa legacy klucza `anon` jako `SUPABASE_KEY`. Migracja na `sb_publishable_`* jest do zrobienia przed końcem 2026 — poza zakresem tego deployu

---

### ☐ Faza 4 — Pierwszy deploy: preview przed promocją

Nigdy nie `deploy` na ślepo. Najpierw wersja bez ruchu produkcyjnego.

- [ ] `npm run build` — czysty build lokalnie
- [ ] `npx wrangler versions upload` → zwraca preview URL, **nie dotyka aktywnego deploymentu**
- [ ] **Zanim ktokolwiek dostanie preview URL:** włącz Cloudflare Access na preview URL-ach (dashboard → Settings → Domains & Routes → jednym kliknięciem; od 12.2025 jedna współdzielona polityka „Cloudflare Workers Preview URLs" na całe konto). Preview URL-e są publiczne, a InTouch renderuje dane osobowe osób trzecich
- [ ] Smoke test na preview URL:
  - [ ] `/` renderuje się, **brak** banera „Supabase nie jest skonfigurowany"
  - [ ] `/dashboard` bez sesji → redirect na `/auth/signin` (middleware działa)
  - [ ] pełny signup → mail → potwierdzenie → signin → `/dashboard` (weryfikuje Fazę 3)
  - [ ] `POST /api/auth/signin` zwraca sensowną odpowiedź (route SSR w `src/pages/api/`)
  - [ ] `**/nieistniejaca-sciezka` zwraca 404 z Workera, a nie statyczny plik zamiast SSR** — to weryfikacja `not_found_handling: "404-page"`; jeśli dynamiczne trasy przestają być wywoływane, zmień na `"none"` i powtórz upload
- [ ] Dopiero po zielonym smoke teście — promocja (krok człowieka):
  ```bash
  npx wrangler deploy
  npx wrangler deployments list --json   # potwierdź, że nowa wersja jest Active
  ```

---

### ☐ Faza 5 — CI/CD na GitHub Actions

- [ ] **Napraw `.github/workflows/ci.yml`: `branches: [master]` → `[main]`.** To jednolinijkowa zmiana, która włącza CI po raz pierwszy — spodziewaj się, że pierwszy przebieg coś wykaże (lint/build nigdy nie były weryfikowane w CI)
- [ ] Wyrównaj Node: `.nvmrc` pinuje `22.14.0`, CI używa `node-version: 22` — użyj `node-version-file: .nvmrc`
- [ ] Nowy workflow `.github/workflows/deploy.yml`:
  - **PR → `main`**: `npm ci` → `astro sync` → `lint` → `build` → `wrangler-action@v4` z `command: versions upload` (preview, zero wpływu na produkcję)
  - **push → `main`**: te same kroki → `command: deploy`
  - `with: apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`, `accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`
  - `wranglerVersion` pominąć — action bierze wersję z `package.json`
  - **Nie używaj inputu `secrets:`** w `wrangler-action`. Wypychałby sekrety Workera przy każdym przebiegu, co łamie zasadę „`secret put` jest operacją człowieka" z `infrastructure.md`. Sekrety ustawione raz w Fazie 2 zostają
  - `concurrency: group: deploy-main, cancel-in-progress: false` — żeby dwa merge'e nie promowały wersji równolegle
- [ ] Zweryfikuj po pierwszym merge'u: `npx wrangler deployments list` pokazuje **nową aktywną** wersję (nie tylko uploadowaną — to dokładnie pułapka, w którą wpada domyślna konfiguracja Workers Builds; my jej unikamy, ustawiając komendę jawnie)

---

### ☐ Faza 6 — Weryfikacja end-to-end i ćwiczenie rollbacku

- [ ] `npx wrangler tail --format json` w jednym terminalu, uderz w produkcyjny URL w drugim → potwierdź, że zdarzenia dochodzą (observability jest już włączone w `wrangler.jsonc`)
- [ ] `npx wrangler tail --status error` → w normalnym ruchu pusto
- [ ] **Ćwiczenie rollbacku, dopóki nie ma prawdziwych danych** — to najtańszy moment:
  ```bash
  npx wrangler deployments list --json
  npx wrangler rollback <VERSION_ID> --message "rollback drill"
  ```
  potwierdź, że produkcja wróciła, po czym promuj z powrotem najnowszą wersję
- [ ] Zanotuj ograniczenie w `CLAUDE.md`: rollback cofa **tylko kod Workera**. Migracje Supabase nie cofają się razem z nim → zasada „migracje wyłącznie forward-compatible" (kolumny dodawaj przed użyciem, usuwaj co najmniej jeden deploy po ostatnim użyciu). Dziś to teoria — `supabase/migrations/` nie istnieje — ale reguła musi być zapisana zanim powstanie pierwsza migracja

---

### ☐ Faza 7 — Domknięcie: twarde awarie zamiast cichej degradacji

Dopiero **po** potwierdzeniu, że sekrety produkcyjne działają.

- [ ] `astro.config.mjs` → `SUPABASE_URL` i `SUPABASE_KEY` z `optional: true` na `optional: false`. Dziś brakujący sekret produkcyjny daje polski baner błędu na działającej stronie; po zmianie daje jawny błąd. Kolejność jest istotna — odwrotnie wywali produkcję
- [ ] `npx wrangler types` → wygeneruj `worker-configuration.d.ts` i zacommituj (dziś nie istnieje; daje typy `Env` pod przyszły `scheduled()`/bindings)
- [ ] `context/deployment/deploy-plan.md` — zapisz zatwierdzony plan jako ślad audytowy (ścieżka oczekiwana przez łańcuch z `CLAUDE.md`)
- [ ] `context/foundation/lessons.md` przez `/10x-lesson` — plik jest odwoływany przez `infrastructure.md`, ale **nie istnieje**. Zapisz co najmniej: (a) `astro:env/server` jako jedyna droga do env, nigdy `Astro.locals.runtime`; (b) Workers, nigdy Pages; (c) `astro dev` biegnie w workerd, ale **nie** egzekwuje limitu 10 ms CPU ani 50 subrequestów — lokalne przejście nie dowodzi niczego o produkcji

---

## Świadomie poza zakresem (i dlaczego)

Zgodnie z wyborem „tylko deploy obecnego stanu". Odnotowane, bo Faza 1 podejmuje decyzje, które te rzeczy odblokowują lub blokują:

- **Cron trigger dla FR-008 i async generacja AI dla FR-007.** Wymagają własnego entrypointu (`"main": "./src/worker.ts"` + `import { handle } from '@astrojs/cloudflare/handler'` — export potwierdzony w `node_modules`), bo `main` wskazuje dziś wprost na entrypoint adaptera i nie ma gdzie dopisać `scheduled()`. Dobra wiadomość z researchu, której `infrastructure.md` nie zawiera: **Queues, Durable Objects (SQLite) i Workflows są dostępne na free planie**, więc NFR „generowanie hierarchii nigdy nie blokuje użytkownika" jest osiągalne bez przechodzenia na plan płatny. Limity free: Queues 10k operacji/dzień, retencja 24 h.
- **Keep-alive przeciw pauzowaniu Supabase.** Free tier pauzuje projekt po 7 dniach niskiej aktywności → ciche 500-tki. Mitygacja to cron, a cronu w tym zakresie nie ma. **Do czasu Fazy „cron" ryzyko jest realne i nieobsłużone** — przy przerwie dłuższej niż tydzień produkcja padnie bez ostrzeżenia.
- **Limity 10 ms CPU / 50 subrequestów.** Obecna aplikacja robi jedno `supabase.auth.getUser()` na request — mieści się. Ryzyko pojawia się dopiero z serializacją hierarchii i zapytaniami per-osoba.
- **Migracja na klucze `sb_publishable_*`**, model danych i migracje Supabase, własna domena, Docker, architektura multi-region.

---

## Weryfikacja (kryteria ukończenia)

1. `https://intouch.<subdomena>.workers.dev` odpowiada, bez banera braku configu
2. Pełna ścieżka signup → potwierdzenie e-maila → signin → `/dashboard` działa **na produkcyjnym URL-u**, nie tylko lokalnie
3. `npx wrangler deployments list --json` pokazuje jedną aktywną wersję odpowiadającą HEAD `main`
4. Merge do `main` automatycznie promuje nową wersję; PR tworzy preview URL i **nie** rusza produkcji
5. `npx wrangler tail` streamuje zdarzenia z produkcji
6. Rollback przećwiczony i udokumentowany
7. `wrangler secret list` pokazuje `SUPABASE_URL` i `SUPABASE_KEY`
8. Preview URL-e są za Cloudflare Access

