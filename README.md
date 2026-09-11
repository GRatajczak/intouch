# InTouch

![](./public/template.png)

InTouch to webowa aplikacja, ktora pomaga podtrzymywac relacje z bliskimi.
Zamiast klasycznych przypomnien "na date", aplikacja buduje kolejnosc kontaktu
na bazie kontekstu relacji i przypomina, kiedy dana relacja zaczyna cichnac.

## Produkt i kontekst

- Vision i wymagania produktu: `context/foundation/prd.md`
- Dobor stacku: `context/foundation/tech-stack.md`
- Roadmapa wdrozenia: `context/foundation/roadmap.md`
- Material design (ekrany desktop + mobile): `InTouch.dc.html` (plik z przygotowania designu)

MVP (wg PRD) obejmuje:

- logowanie i konto uzytkownika
- onboarding z profilem "o mnie"
- dodawanie bliskich osob (osoba lub grupa), opis + waga relacji 1-5
- AI-owa hierarchie "z kim teraz warto sie skontaktowac" z uzasadnieniem
- przypomnienia i petle feedbacku ("czy kontakt sie udal?")

## Stack techniczny

- `Astro 6` + `React 19` + `TypeScript 5`
- `Tailwind CSS 4` + `shadcn/ui` + `Radix UI`
- `Supabase` (auth i backend)
- `Cloudflare Workers` (runtime produkcyjny)
- `GitHub Actions` (CI/CD)

## Wymagania lokalne

- `Node.js` zgodny z `.nvmrc`
- `npm`
- opcjonalnie `Docker` (jesli uruchamiasz lokalny Supabase)

## Szybki start

1. Instalacja zaleznosci:

```bash
npm install
```

2. Ustaw zmienne srodowiskowe:

```bash
cp .env.example .env
cp .env.example .dev.vars
```

3. Uzupelnij co najmniej:

```bash
SUPABASE_URL=...
SUPABASE_KEY=...
```

4. Uruchom lokalnie:

```bash
npm run dev
```

## Skrypty

- `npm run dev` - lokalny development
- `npm run build` - build produkcyjny Astro
- `npm run preview` - podglad buildu lokalnie
- `npm run lint` - linting
- `npm run lint:fix` - automatyczne poprawki ESLint
- `npm run format` - formatowanie Prettierem
- `npm run deploy` - `astro build && wrangler deploy`
- `npm run preview:upload` - `astro build && wrangler versions upload` (preview bez ruchu produkcyjnego)
- `npm run cf-typegen` - odswiezenie typow Workera

## Supabase (lokalnie)

Jezeli chcesz odpalic lokalny stack Supabase:

```bash
npx supabase init
npx supabase start
```

Po starcie przepisz `SUPABASE_URL` i `SUPABASE_KEY` z outputu CLI do `.env` i
`.dev.vars`.

## Deploy (Cloudflare Workers)

Projekt deployuje sie jako **Cloudflare Worker** (nie Cloudflare Pages).

- Produkcja: `npm run deploy`
- Preview wersji: `npm run preview:upload`
- Produkcyjny URL: `https://get-in-touch.pl` (custom domain; `https://intouch.g-ratajczak97.workers.dev` nadal odpowiada, ale `rel=canonical` i `site` w `astro.config.mjs` wskazują na domenę)

Do produkcji ustaw sekrety Workera:

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_KEY
# S-17 (BYOK): klucz szyfrujący zapisane klucze OpenAI użytkowników, wartość
# z `openssl rand -base64 32` (base64, 32 losowe bajty). Podawaj przez printf,
# nie interaktywnie -- zob. context/deployment/deploy-plan.md.
printf '%s' "$(openssl rand -base64 32)" | wrangler secret put OPENAI_KEY_ENCRYPTION_KEY
```

> Ta lista jest już niepełna względem ośmiu sekretów faktycznie używanych
> (`OPENAI_API_KEY`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
> `REMINDER_FROM`, `APP_BASE_URL`, `POSTHOG_API_KEY` też trzeba ustawić) —
> pełne dopełnienie zostaje poza zakresem tej zmiany, `OPENAI_KEY_ENCRYPTION_KEY`
> dopisany tu celowo jako jedyny nowy sekret S-17.

## CI/CD

Workflowy w `.github/workflows/`:

- `ci.yml` - `npm ci`, `astro sync`, `lint`, `build` na `push`/`pull_request` do `main`
- `deploy.yml`:
  - PR do `main`: upload preview (`wrangler versions upload`)
  - push do `main`: deploy produkcyjny (`wrangler deploy`)

Wymagane GitHub Secrets:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `OPENAI_KEY_ENCRYPTION_KEY` (S-17, ta sama wartość co w Workers Secrets)

## Struktura repo

```text
.
├── src/                    # aplikacja Astro/React
├── public/                 # statyczne assety
├── context/                # dokumentacja produktowa i roadmapa
├── .github/workflows/      # CI/CD
├── wrangler.jsonc          # konfiguracja Workera
└── README.md
```
