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

- **Context**: Any code needing a Cloudflare _binding_ — KV, D1, R2, Queues, Durable Objects — rather than a plain config value. First arises in `F-02` (`openai-ranking-call-path`), which adds the repo's first binding (`AI_JOBS`).
- **Problem**: The existing "env vars go through `astro:env/server` only" rule reads as a blanket ban on every other access path, but `astro:env/server` cannot express a binding at all — `envField` models only string/number/boolean/enum. Meanwhile `Astro.locals.runtime.env` throws in `@astrojs/cloudflare` v13. Taken together the two rules appear to leave no legal way to read a KV namespace, so an implementer either guesses or stalls.
- **Rule**: Split the two cases. **Config values** (secrets, URLs, flags) come from `astro:env/server` — the original rule stands unchanged for these. **Bindings** come from `import { env } from "cloudflare:workers"`, which the adapter's own removal message names (`dist/utils/handler.js:66-70`) and which is declared and typed in `worker-configuration.d.ts`. Wrap each binding in a small `src/lib/` module (e.g. `ai-jobs.ts`) so exactly one file imports `cloudflare:workers` per binding, mirroring how `src/lib/supabase.ts` contains the Supabase client. `Astro.locals.runtime` and `process.env` remain forbidden for both cases.
- **Applies to**: plan, plan-review, implement, impl-review

## A machine POST to /api/internal/\* must send Content-Type: application/json

- **Context**: Any non-browser caller of an `/api/internal/*` route — a verification script, a scheduled handler, another Worker. First arises in `F-02` (`scripts/verify-openai-call.ts`), and `S-02` will hit it the moment it triggers ranking from anything but a browser.
- **Problem**: Astro runs an origin-check middleware _before_ routing (`node_modules/astro/dist/core/app/middlewares.js`). It rejects any unsafe-method request that carries **no** `content-type`, or a form-like one (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`), unless `Origin` matches the request URL's origin. The response is `403 "Cross-site POST form submissions are forbidden"` — which never reaches the route, so an auth bug and a CSRF rejection look nothing alike, and the message points at form submissions when the caller sent no form. A browser is unaffected: same-origin `fetch` sends `Origin` automatically. So this only ever breaks the machine caller, and only outside the browser where nobody was testing.
- **Rule**: Every non-browser caller of a JSON route in this repo sends `Content-Type: application/json` — a non-form content-type skips the origin check entirely. When the request genuinely must be form-encoded (posting to `/api/auth/signin` to mint a session, as the verification scripts do), send an explicit `Origin: <base-url>` header instead. `GET`/`HEAD`/`OPTIONS` are exempt and need neither.
- **Applies to**: plan, implement, impl-review

## Cloudflare non-versioned settings sync only on `versions deploy`

- **Context**: Debugging a deployed Worker via `wrangler tail`, especially against a `versions upload` preview URL. Arises in `F-02` and will again in `F-04`, whose scheduled handler runs with no user in scope and can only be observed through platform logs.
- **Problem**: `observability`, `logpush` and `tail_consumers` in `wrangler.jsonc` are _non-versioned_ settings. `wrangler versions upload` does not apply them — it prints a note saying so, which is easy to skim past. Until some `wrangler versions deploy` syncs them, `wrangler tail` connects happily (`Successfully created tail` / `Connected to <worker>, waiting for logs...`) and then streams **nothing at all**, for preview and production traffic alike. Silence that looks identical to a broken sandbox, a wrong `--version-id`, or code that simply never ran — four attempts were spent on wrong hypotheses before the deploy output revealed the cause.
- **Rule**: Treat a silent `wrangler tail` as an unsynced-settings symptom first, not as missing traffic. Check whether any `versions deploy` has run since `observability` was added; if not, that is the cause. Corollary for planning: a verification step that depends on reading `wrangler tail` cannot be satisfied by a `versions upload` preview alone — either budget a real deploy, or make the assertion self-evidencing (`F-02`'s script proved non-blocking from its own timing: response at 241ms, first poll still `pending`, job settled at 4599ms).
- **Applies to**: plan, plan-review, implement

## Resend's onboarding@resend.dev sender is a placeholder, not final config

- **Context**: `src/worker.ts:24` — any code sending email via Resend before a verified sending domain exists.
- **Problem**: The `from` address is hardcoded as `InTouch <onboarding@resend.dev>`, Resend's test-only sender restricted to the account owner's own inbox. Correct for `F-04`'s proof-of-delivery scope, but `S-04`'s real reminder sweep will need to send to arbitrary user inboxes, which `onboarding@resend.dev` cannot do.
- **Rule**: Before `S-04` ships, verify a real sending domain in Resend and move `from` to config/env rather than a hardcoded literal.
- **Applies to**: plan, implement

## In `.astro`, style link-buttons with `buttonVariants()`, never `<Button asChild>`

- **Context**: Any `.astro` file rendering a link that should look like a button — landing CTAs, auth-screen actions, empty-state prompts. Arises in `S-06` (`landing-page`); `S-07` and `S-08` both add auth screens with link-buttons and will hit it.
- **Problem**: `<Button asChild><a href="…">Text</a></Button>` is the correct shadcn pattern in React and looks correct in `.astro`, but silently renders an unstyled link. `@astrojs/react` passes slot children through `StaticHtml` (`node_modules/@astrojs/react/dist/static-html.js`), which wraps them in an `<astro-slot>` / `<astro-static-slot>` element via `dangerouslySetInnerHTML`. Radix's `Slot` therefore receives _that wrapper_ as its only child and merges the button's `className` onto it — an unknown, `display: inline` element — while the inner `<a>` gets nothing. The whole page's CTAs render as plain link text. **Every automated check passes while this is broken**: `astro check` sees valid types, ESLint is clean, `npm run build` succeeds, and the utilities are even present in the generated CSS (they are emitted from the source scan, just applied to the wrong element). `S-06` shipped three phases this way; it surfaced only when a human looked at the page and said the buttons did not stand out.
- **Rule**: In `.astro`, apply `buttonVariants({ variant, size })` directly to a native `<a>` — `class={buttonVariants({ size: "xl" })}`, or `class={cn(buttonVariants({ … }), "extra-classes")}` when overriding (use `cn` so tailwind-merge resolves conflicts like `bg-background` vs `bg-secondary`). Reserve `<Button asChild>` for `.tsx` files, where the child really is a React element. Corollary for verification: a phase whose success criteria are only `astro check` / lint / build cannot prove a component _renders_ correctly — any phase producing visible UI needs a human look, and "the automated checks passed" is not evidence it works.
- **Applies to**: plan, implement, impl-review

## Bindings and config in `src/worker.ts` come from wrangler's world, not Astro's

- **Context**: Any code reachable from `src/worker.ts` — the Cron `scheduled` handler and everything it imports. First arises in `S-04` (`decay-driven-reminders`), whose sweep needed the app's canonical origin to build links in reminder emails.
- **Problem**: `wrangler.jsonc`'s `main` points at `src/worker.ts`, so wrangler/esbuild bundles it — Astro's Vite pipeline never sees it. `astro:env/server` happens to work there (F-04 proved it in production), which makes it tempting to assume every `astro:*` virtual module does. `astro:config/client` does not: it resolves to `undefined` under vitest and could not be shown to work in the built Worker either. A wrong guess here fails only in production — as emails whose links point at the wrong host — with every local check green.
- **Rule**: In `src/worker.ts` and anything it imports, read config through `astro:env/server` only. Never reach for `astro:config/server` or `astro:config/client` there. When a value lives in `astro.config.mjs` (like `site`) and the Worker needs it, mirror it into a secret and record the duplication where the original rule is stated — see the `APP_BASE_URL` exception in `CLAUDE.md`.
- **Applies to**: plan, plan-review, implement, impl-review

## A Cron Trigger change is eventually consistent, not immediate

- **Context**: Any production verification that temporarily tightens `triggers.crons` in `wrangler.jsonc` to observe a scheduled run without waiting for its real slot — the technique F-04 established and S-04 reused.
- **Problem**: During `S-04`'s verification the daily `0 6 * * *` was restored and deployed at ~10:17 UTC, yet an invocation from the previous `*/2` schedule still fired at 10:20:23 — and that invocation is the one that sent the reminder being looked for. `wrangler tail` had been stopped by then, so the send was invisible, and the missing log line was read as "nothing happened". That cost three wrong hypotheses in a row (opt-out, a broken toggle, a route silently no-opping) before a `reminder_sends` query showed the send had succeeded all along. The user said "it arrived" and was disbelieved.
- **Rule**: Treat a Cron Trigger schedule change as eventually consistent — allow several minutes after restoring a schedule before concluding the old one is gone, and keep `wrangler tail` running across the whole window. When a scheduled run's effect is in doubt, check the durable record (a table row, the provider's dashboard) before the log: absence from a log you started late proves nothing.
- **Applies to**: implement, impl-review

## A browser needs a runtime secret rendered into the page, not a client env var

- **Context**: Any value a client bundle needs that also lives in Workers Secrets — a vendor's public project token, a public API key, an origin. First arises in `web-analytics-pageviews`, where `posthog-js` needs `POSTHOG_API_KEY` in the browser.
- **Problem**: Astro's `astro:env` has a `context: "client"` mode, and reaching for it looks like the obvious answer. But client-context variables are **inlined at build time**, while Workers Secrets are a runtime concept. Registering the token that way moves the source of truth out of Workers Secrets — the documented one for this repo — into GitHub Secrets, and turns every rotation into a rebuild and redeploy. Nothing warns you: it builds, it works, and the cost only shows up the first time somebody rotates a key and the deployed app keeps using the old one.
- **Rule**: Keep the value a **server** secret in `astro:env/server`, read it in an `.astro` component, and render it into the response as a `data-` attribute that a bundled `<script>` reads back. One secret, one place, rotatable without a build. Reserve `context: "client"` for values that are genuinely build-time constants. Corollary: check whether the value is actually secret — a vendor's _public_ project token ships in the page of every site using that vendor, so putting it in the DOM costs nothing, and the whole question is about rotation, not exposure.
- **Applies to**: plan, implement, impl-review

## A URL is a payload — sanitize it before it reaches a third party

- **Context**: Anything that forwards a URL, path, or referrer out of the app: an analytics SDK, an error reporter, a support widget, a webhook, a log shipper. First arises in `web-analytics-pageviews`, where `posthog-js` writes `$current_url` itself.
- **Problem**: This repo puts identifiers and secrets in URLs, and every one of them is somewhere nobody thinks to look. `/people/[id]` puts a `person_id` in the path — the one identifier `src/lib/analytics/events.ts` forbids outright, because it joins straight back to a name and a description. `src/pages/auth/confirm.ts` reads a single-use `token_hash` from the query string. Five separate pages render `?error=<supabase message>`. A closed union over event properties, however carefully built, guarantees nothing about these: the SDK writes them off `window.location`, not through our code. So the repo's strongest privacy mechanism has a blind spot exactly where the URL is.
- **Rule**: Before any URL leaves the app, run it through a pure sanitizer with an **allow-list** query policy — a deny-list is a promise to have anticipated every parameter the app will ever put in a URL, and the two that mattered here were found by reading routes, not by anticipating them. Mask id-shaped path segments, drop the fragment, and fail closed on anything that does not parse or is not `http(s)` (a `data:` URL parses fine and hides its payload in the path). Keep the sanitizer importing nothing so it is safe in a client bundle and testable as a table. Corollary for review: when a vendor SDK writes properties itself, ask which hook runs last before the wire — that hook, not the call site, is where the guarantee has to live.
- **Applies to**: plan, plan-review, implement, impl-review

## A stale `node_modules/.vite` cache breaks `useFormStatus` SSR without touching app code

- **Context**: Debugging a local-only E2E failure on any page rendering a `client:load` island that calls `useFormStatus` from `react-dom` — currently `src/components/auth/SubmitButton.tsx`, used by every auth form and `PersonForm`. Surfaced 2026-09-10 on `tests/e2e/auth.setup.ts`: `getByRole('heading', { name: 'Zaloguj się' })` timed out on `/auth/signin`.
- **Problem**: The route returned `200 OK` but the SSR stream truncated mid-render — cut off right after `AnalyticsScript`'s output, before `<slot />` content, no closing `</body></html>`. Wrapping the `useFormStatus()` call in a temporary try/catch (reverted after, `git diff` clean) surfaced the real error: `TypeError: Cannot read properties of null (reading 'useHostTransitionStatus')`. `node_modules/.vite/deps_ssr/_metadata.json` showed `react-dom` and `react-dom/server` (→ `server.edge.js`, since the `workerd` export condition is active under `@astrojs/cloudflare`) as two separate esbuild entry points in the SSR dep-optimizer cache; once that cache goes stale relative to current `node_modules` (here, right after `npm install` for an unrelated feature — new `src/lib/crypto/` + a Supabase migration landed just before), the two copies stop sharing React's dispatcher singleton, so `useFormStatus` reads a null dispatcher and throws — silently, since Astro's dev SSR just ends the chunked response instead of surfacing a 500. CI stayed green throughout: `.github/workflows/ci.yml` runs `npm ci` + `npm run dev` fresh every time, so it never inherits a stale cache the way a long-lived local `astro dev` process does.
- **Rule**: If a local-only E2E failure shows a route 200-ing but the page's expected content never arrives (heading/element timeout despite a successful navigation), and especially if it started right after a dependency-touching change on a long-running dev server, suspect a stale Vite SSR dep cache before assuming a real app regression. Fix: stop the dev server, `rm -rf node_modules/.vite`, restart `npm run dev`. Clearing the cache is safe (regenerable build artifact); restarting the dev server itself stays the developer's own action, per this repo's "the app's own dev server is the developer's to run" convention (`playwright.config.ts`).
- **Applies to**: implement, impl-review

## A stored secret's decrypt failure and its provider's rejection are different faults, and must fail differently

- **Context**: Any feature that encrypts a user-submitted credential at rest and later uses it against a third-party API. First arises in `S-17` (`byok-openai-key`), the repo's first cryptographic secret and its first user-submitted credential storage — a user's own OpenAI key, held on `profiles.openai_api_key_ciphertext`.
- **Problem**: Two failure modes look similar from inside the code that calls the key (both end in "the OpenAI call didn't happen") but have opposite correct responses. A **decryption failure** — `OPENAI_KEY_ENCRYPTION_KEY` rotated, or a `wrangler rollback` that reintroduces code expecting an older envelope version — is the app's own fault: the user did nothing wrong, and their ciphertext, though unreadable *right now*, may become readable again if the secret is restored. A **provider rejection** (`AuthenticationError`, `RateLimitError`) is the user's key genuinely being bad. Collapsing the two into one behaviour is a real cost-control hole: if a decrypt failure fell back to failing the run instead of the app key, a routine secret rotation would silently move every BYOK user onto the free tier's daily cap with no explanation. If a provider rejection instead fell back to the app key silently, a deliberately bad or stolen key would produce an unlimited free tier billed to the app — exactly the spend control `S-17` exists to protect (see the amended FR-001 rationale).
- **Rule**: Design the two paths asymmetrically and say so where the code branches. A decryption failure falls back silently to the app key and its normal limits, and the UI that shows the credential's status (here, `/settings`) says the stored value is unreadable and asks for it again — it never claims the key still works. A provider rejection fails the operation outright, with no fallback to another credential, and names *which* rejection it was (auth vs. quota) without ever echoing the secret itself. The versioned envelope (`v1:<iv>:<ciphertext>`) is what keeps a future key rotation from needing a data migration — write the version prefix from the first commit, even though only one version exists yet, because a rolled-back Worker can reintroduce old code against a newer envelope with no warning at deploy time.
- **Applies to**: plan, implement, impl-review
