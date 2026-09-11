## Cloudflare: Workers, nie Pages

`@astrojs/cloudflare` v13 usunął wsparcie dla Cloudflare Pages i `Astro.locals.runtime`. Ten projekt deployuje się jako **Cloudflare Worker**, nie Pages.

- `wrangler pages deploy` jest zakazane w tym repo — użyj `npm run deploy` (= `astro build && wrangler deploy`) albo `npm run preview:upload` (= `astro build && wrangler versions upload`) dla wersji bez ruchu produkcyjnego.
- Dostęp do zmiennych środowiskowych wyłącznie przez `astro:env/server` (patrz `src/lib/supabase.ts`). Nigdy `Astro.locals.runtime` (nie istnieje w v13) ani `process.env`.
- `wrangler.jsonc` → `"name": "intouch"` determinuje subdomenę `*.workers.dev`; produkcyjny URL to `https://get-in-touch.pl` (custom domain). Subdomena `https://intouch.g-ratajczak97.workers.dev` wciąż odpowiada — kanoniczna domena jest ustawiona jednym miejscem, `site` w `astro.config.mjs`, z którego layout wylicza `rel=canonical`, `og:url` i sitemapę. Nie wpisuj domeny na sztywno nigdzie indziej.
- **Jeden udokumentowany wyjątek:** sekret `APP_BASE_URL` powiela wartość `site`, bo `src/worker.ts` jest bundlowany przez wranglera (`wrangler.jsonc` → `main`), a nie przez Astro — `astro:config/*` nie jest tam pewne, podczas gdy `astro:env/server` jest ścieżką udowodnioną na produkcji przez F-04. Czyta go wyłącznie `src/lib/reminders/run-sweep.ts`, żeby zbudować linki w mailach przypominających. **Zmieniając `site`, zmień też ten sekret** (Workers Secrets + GitHub Secrets) — nic tego nie sprawdza automatycznie, a rozjazd daje maile z linkami pod zły host przy wszystkich testach na zielono.

## Rollback

`wrangler rollback <VERSION_ID>` cofa **tylko kod Workera** — nie cofa bound resources (KV, D1, R2, Durable Objects) ani migracji Supabase. Jeśli produkcja zostanie cofnięta do starszej wersji kodu, baza zostaje na najnowszym schemacie.

Konsekwencja: migracje Supabase muszą być **wyłącznie forward-compatible**:
- nową kolumnę dodawaj i wypełniaj domyślną wartością zanim kod zacznie jej wymagać
- starą kolumnę usuwaj dopiero co najmniej jeden deploy po tym, jak żaden kod przestał jej używać

`supabase/migrations/` jeszcze nie istnieje, ale ta zasada obowiązuje od pierwszej migracji.

## Sekrety

Sekrety żyją w trzech miejscach:

- `.dev.vars` (gitignored) — lokalny dev
- Workers Secrets (`wrangler secret put`) — **źródło prawdy dla produkcji**
- GitHub Secrets — CI/CD (`wrangler-action`)

Ustawianie/rotacja sekretów produkcyjnych to operacja człowieka, nie agenta.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
