# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Env vars go through astro:env/server only

- **Context**: Any code in this repo (Astro pages, API routes, middleware, lib) that needs a runtime config value.
- **Problem**: `@astrojs/cloudflare` v13 removed `Astro.locals.runtime` — accessing it throws at runtime ("has been removed in Astro v6"). Reaching for `process.env` also silently fails to reflect Cloudflare bindings/secrets.
- **Rule**: Always import env vars from `astro:env/server` (see `src/lib/supabase.ts`). Never use `Astro.locals.runtime` or `process.env` for config in this project.
- **Applies to**: implement, impl-review

## Cloudflare Workers, never Pages

- **Context**: Any deployment, build script, or CI/CD workflow work on this project.
- **Problem**: `@astrojs/cloudflare` v13 dropped Pages support entirely. A `wrangler pages deploy` command or Pages-shaped assumption will not work with this adapter and wastes a deploy cycle discovering that.
- **Rule**: This project deploys as a Cloudflare Worker, never Pages. `wrangler pages deploy` is forbidden in this repo — use `wrangler deploy` / `wrangler versions upload`.
- **Applies to**: plan, implement, impl-review

## astro dev does not enforce Cloudflare's production limits

- **Context**: Any feature that does non-trivial work per request — especially FR-007 (AI hierarchy generation) and FR-008 (reminders) once they land.
- **Problem**: `astro dev` runs on workerd but does not enforce the free-tier production limits (10ms CPU, 50 subrequests/request). A clean, fast local dev run proves nothing about whether the same code will hit those ceilings in production.
- **Rule**: Before shipping a feature that does meaningful per-request work, check it against Cloudflare's actual production limits — don't treat a fast local `astro dev` run as evidence it'll hold up on the Workers free tier.
- **Applies to**: plan, plan-review, implement

## Verify exact config API in node_modules before trusting a plan's syntax

- **Context**: Any implementation step that follows a written plan's exact code snippet for a third-party library or framework config (adapters, integrations, CLI flags).
- **Problem**: During the Cloudflare deploy, a plan called for `session: false` in `astro.config.mjs` to disable KV auto-provisioning. No such option exists in Astro's `SessionConfig` type or the `@astrojs/cloudflare` `Options` type — the plan's intent was right, the exact syntax was invented. Caught only by reading `node_modules/@astrojs/cloudflare/dist/index.js` and `node_modules/astro/dist/core/session/types.d.ts` directly.
- **Rule**: When a plan specifies exact config syntax for a library, verify the option actually exists in the installed version (check `node_modules` types/source, not just the plan's prose) before applying it — a plan can be right about intent and wrong about API surface.
- **Applies to**: plan-review, implement, impl-review

## ON DELETE CASCADE on owner_id is a per-table decision, not an inherited default

- **Context**: `supabase/migrations/20260824192356_create_people_table.sql` (`owner_id` FK) — any future user-owned table copying the F-01 RLS pattern (`S-01`, `S-02`, `S-03`, `S-05`).
- **Problem**: `owner_id`'s `ON DELETE CASCADE` is correct for `people` and relied on by `scripts/verify-rls.ts`'s cleanup, but because this migration is the template every future table copies, cascade-delete-on-account-removal could get inherited silently without anyone deciding it's right for that table too.
- **Rule**: Before adding `ON DELETE CASCADE` to a new `owner_id` FK, explicitly decide cascade-delete vs. soft-delete/anonymize for that table — don't inherit it from `people` by default.
- **Applies to**: plan, implement

## New React components live in a folder with a separate types file and barrel index

- **Context**: Any new React component created under `src/components/` (or similar) in this project.
- **Problem**: Flat single-file components (e.g. `TextField.tsx`) mix prop-type declarations with rendering logic, which gets harder to scan and reuse as components grow.
- **Rule**: Organize every new component as `ComponentName/` containing `ComponentName.tsx` (rendering logic, imports its props type via `import type { ... } from "./types"`), `types.ts` (prop/type interfaces), and `index.ts` (a barrel re-export — e.g. `export { ComponentName } from "./ComponentName"; export type { ComponentNameProps } from "./types";`, or `export { default } from "./ComponentName";` for a default export). Consumers keep importing from the folder path (e.g. `@/components/forms/TextField`), which resolves to `index.ts`, so no consumer import needs to change.
- **Applies to**: implement

## Page filenames and routes are English; only the UI copy is Polish

- **Context**: Any new file under `src/pages/` — and therefore any new URL, since Astro derives routes from filenames.
- **Problem**: The product's UI language is Polish, which makes it tempting to name the file after the label the user sees. `design-alignment-pass` shipped `src/pages/ustawienia.astro` → `/ustawienia` that way, mixing languages across the route table (`/dashboard`, `/people`, `/profile`, `/ustawienia`) and putting Polish into `PROTECTED_ROUTES`, nav hrefs, and every future link to that page.
- **Rule**: Name page files (and the routes they produce) in English — `settings.astro` → `/settings`. Keep Polish for user-facing copy only: nav labels, headings, button text. The nav config is the seam that holds both (`NAV_ITEMS` in `src/lib/nav-items.ts`: English `href`, Polish `label`).
- **Applies to**: plan, implement, impl-review

## Mirror every roadmap status flip onto its Linear issue

- **Context**: Any `/10x-implement` or `/10x-archive` run on a change whose `change-id` matches a `Change ID` in `context/foundation/roadmap.md`.
- **Problem**: The skills flip `roadmap.md` (`ready` → `in-progress` on entry, → `done` on archive) but know nothing about Linear, so the workspace silently drifts: `F-05` shipped with its `GRA-18` issue still sitting in Backlog. Anyone reading Linear gets a stale picture of what's built, and the drift is invisible from inside the repo.
- **Rule**: Whenever a roadmap item's status changes, update its Linear issue in the same run — don't wait to be asked. Find it by title prefix (`[<roadmap-id>] …`, e.g. `[F-05]`) in team `GRatajczak`, project `InTouch MVP v1`. Map `in-progress` → **In Progress** and `done` → **Done**; leave it **In Progress** while manual verification is still outstanding, since automated checks passing is not the same as the slice being closed. On close, also post a comment carrying: per-phase commit SHAs, every divergence from the plan with its reason, and the manual-verification items still open. If the implementation changed something the issue's description asserts (a route, a field, a scope boundary), patch the description too — a stale description outlives the comment thread.
- **Applies to**: implement, archive

## Config comes from astro:env/server; Cloudflare bindings come from cloudflare:workers

- **Context**: Any code needing a Cloudflare *binding* — KV, D1, R2, Queues, Durable Objects — rather than a plain config value. First arises in `F-02` (`openai-ranking-call-path`), which adds the repo's first binding (`AI_JOBS`).
- **Problem**: The existing "env vars go through `astro:env/server` only" rule reads as a blanket ban on every other access path, but `astro:env/server` cannot express a binding at all — `envField` models only string/number/boolean/enum. Meanwhile `Astro.locals.runtime.env` throws in `@astrojs/cloudflare` v13. Taken together the two rules appear to leave no legal way to read a KV namespace, so an implementer either guesses or stalls.
- **Rule**: Split the two cases. **Config values** (secrets, URLs, flags) come from `astro:env/server` — the original rule stands unchanged for these. **Bindings** come from `import { env } from "cloudflare:workers"`, which the adapter's own removal message names (`dist/utils/handler.js:66-70`) and which is declared and typed in `worker-configuration.d.ts`. Wrap each binding in a small `src/lib/` module (e.g. `ai-jobs.ts`) so exactly one file imports `cloudflare:workers` per binding, mirroring how `src/lib/supabase.ts` contains the Supabase client. `Astro.locals.runtime` and `process.env` remain forbidden for both cases.
- **Applies to**: plan, plan-review, implement, impl-review

## A machine POST to /api/internal/* must send Content-Type: application/json

- **Context**: Any non-browser caller of an `/api/internal/*` route — a verification script, a scheduled handler, another Worker. First arises in `F-02` (`scripts/verify-openai-call.ts`), and `S-02` will hit it the moment it triggers ranking from anything but a browser.
- **Problem**: Astro runs an origin-check middleware *before* routing (`node_modules/astro/dist/core/app/middlewares.js`). It rejects any unsafe-method request that carries **no** `content-type`, or a form-like one (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`), unless `Origin` matches the request URL's origin. The response is `403 "Cross-site POST form submissions are forbidden"` — which never reaches the route, so an auth bug and a CSRF rejection look nothing alike, and the message points at form submissions when the caller sent no form. A browser is unaffected: same-origin `fetch` sends `Origin` automatically. So this only ever breaks the machine caller, and only outside the browser where nobody was testing.
- **Rule**: Every non-browser caller of a JSON route in this repo sends `Content-Type: application/json` — a non-form content-type skips the origin check entirely. When the request genuinely must be form-encoded (posting to `/api/auth/signin` to mint a session, as the verification scripts do), send an explicit `Origin: <base-url>` header instead. `GET`/`HEAD`/`OPTIONS` are exempt and need neither.
- **Applies to**: plan, implement, impl-review

## Cloudflare non-versioned settings sync only on `versions deploy`

- **Context**: Debugging a deployed Worker via `wrangler tail`, especially against a `versions upload` preview URL. Arises in `F-02` and will again in `F-04`, whose scheduled handler runs with no user in scope and can only be observed through platform logs.
- **Problem**: `observability`, `logpush` and `tail_consumers` in `wrangler.jsonc` are *non-versioned* settings. `wrangler versions upload` does not apply them — it prints a note saying so, which is easy to skim past. Until some `wrangler versions deploy` syncs them, `wrangler tail` connects happily (`Successfully created tail` / `Connected to <worker>, waiting for logs...`) and then streams **nothing at all**, for preview and production traffic alike. Silence that looks identical to a broken sandbox, a wrong `--version-id`, or code that simply never ran — four attempts were spent on wrong hypotheses before the deploy output revealed the cause.
- **Rule**: Treat a silent `wrangler tail` as an unsynced-settings symptom first, not as missing traffic. Check whether any `versions deploy` has run since `observability` was added; if not, that is the cause. Corollary for planning: a verification step that depends on reading `wrangler tail` cannot be satisfied by a `versions upload` preview alone — either budget a real deploy, or make the assertion self-evidencing (`F-02`'s script proved non-blocking from its own timing: response at 241ms, first poll still `pending`, job settled at 4599ms).
- **Applies to**: plan, plan-review, implement

## In `.astro`, style link-buttons with `buttonVariants()`, never `<Button asChild>`

- **Context**: Any `.astro` file rendering a link that should look like a button — landing CTAs, auth-screen actions, empty-state prompts. Arises in `S-06` (`landing-page`); `S-07` and `S-08` both add auth screens with link-buttons and will hit it.
- **Problem**: `<Button asChild><a href="…">Text</a></Button>` is the correct shadcn pattern in React and looks correct in `.astro`, but silently renders an unstyled link. `@astrojs/react` passes slot children through `StaticHtml` (`node_modules/@astrojs/react/dist/static-html.js`), which wraps them in an `<astro-slot>` / `<astro-static-slot>` element via `dangerouslySetInnerHTML`. Radix's `Slot` therefore receives *that wrapper* as its only child and merges the button's `className` onto it — an unknown, `display: inline` element — while the inner `<a>` gets nothing. The whole page's CTAs render as plain link text. **Every automated check passes while this is broken**: `astro check` sees valid types, ESLint is clean, `npm run build` succeeds, and the utilities are even present in the generated CSS (they are emitted from the source scan, just applied to the wrong element). `S-06` shipped three phases this way; it surfaced only when a human looked at the page and said the buttons did not stand out.
- **Rule**: In `.astro`, apply `buttonVariants({ variant, size })` directly to a native `<a>` — `class={buttonVariants({ size: "xl" })}`, or `class={cn(buttonVariants({ … }), "extra-classes")}` when overriding (use `cn` so tailwind-merge resolves conflicts like `bg-background` vs `bg-secondary`). Reserve `<Button asChild>` for `.tsx` files, where the child really is a React element. Corollary for verification: a phase whose success criteria are only `astro check` / lint / build cannot prove a component *renders* correctly — any phase producing visible UI needs a human look, and "the automated checks passed" is not evidence it works.
- **Applies to**: plan, implement, impl-review
