# Resend Email Delivery Path — Implementation Plan

## Overview

This implements `F-04` on the roadmap: prove that the Worker can send one real email to a real inbox through **Resend**, from a **Cloudflare Cron Trigger** rather than a request handler, with the send's outcome visible in Workers logs, and checked against Cloudflare's actual production limits rather than only `astro dev`. It is deliberately not a reminder feature: no reminder logic, no decay rules, no ranking data in the email body, no dispatch/chunking for multiple recipients. It is the plumbing `S-04` (decay-driven reminders) will build its real sweep on top of — the same relationship `F-02` has to `S-02`.

## Current State Analysis

`RESEND_API_KEY` already sits in `.dev.vars` and `.env.example`, but is not yet declared in `astro.config.mjs`'s env schema, not yet in `.github/workflows/{ci,deploy}.yml`, and no `resend` package is installed. `wrangler.jsonc` has no `triggers.crons` entry, and `"main"` still points straight at `@astrojs/cloudflare/entrypoints/server`, which exports only `{ fetch: handle }` — nothing in this repo runs on a schedule today. This is also the first code in this repo that will execute with **no authenticated user in scope**: every existing route reads `context.locals.user` from cookies on an inbound request, which a scheduled invocation never has.

`F-02` (`openai-ranking-call-path`) is the direct precedent for this foundation's shape: same "prove the call path, nothing else" scope, same three-location secret pattern (`.dev.vars` → Workers Secrets → GitHub Secrets), same posture of no test framework and no error-tracking vendor (`console.error` + platform logs only).

The design bundle (`.ai/intouch-design-preparation/project/InTouch.dc.html:1047-1176`, section "9 — Mail z przypomnieniem") shows the finished FR-008 reminder email and the FR-009 follow-up email in full — but both are built entirely from dynamic ranking/person data (`S-02`/`S-03` outputs) that doesn't exist in this foundation's scope. What *is* reusable now is the chrome common to both: a 640px outer wrapper around a 600px white card, a header with the two-circle logo mark + `InTouch` wordmark in `Instrument Serif` + a date, and a muted footer band with a one-line disclaimer. Both fonts (`Instrument Serif`, `Plus Jakarta Sans`) are already loaded app-wide via `src/layouts/Layout.astro:32` and tokenized in `src/styles/global.css:64-65`.

### Key Discoveries:

- **`@astrojs/cloudflare/handler` is a public, documented export** (`node_modules/@astrojs/cloudflare/package.json` exports map: `"./handler": "./dist/utils/handler.js"`) that returns the same `handle` function the default entrypoint uses. Astro's own docs show the sanctioned pattern for adding a second Cloudflare export (their example adds `queue`; this plan adds `scheduled` the identical way) — a custom entry file re-exports `{ fetch: handle, scheduled: ... }` and `wrangler.jsonc`'s `"main"` points at that file instead of the adapter's default entrypoint.
- **`triggers.crons` is a non-versioned `wrangler.jsonc` setting**, confirmed via current Cloudflare docs: applying it requires `wrangler triggers deploy` (or a full `wrangler deploy` / `versions deploy`) — `wrangler versions upload` alone does not sync it. This is the same class of gotcha `lessons.md` already documents for `observability`/`logpush`/`tail_consumers`.
- **Resend's `onboarding@resend.dev` test sender can only deliver to the Resend account owner's own verified email** — confirmed via Resend's current docs, which separately warn that address is "strictly intended for testing and not for production use." The unrelated `delivered@resend.dev`-style addresses are fixture *recipients* for simulating webhook events, not real inboxes, and are not what this foundation needs.
- **The Cloudflare dashboard has no confirmed on-demand "fire this cron now" button for a deployed Worker** — only a `Trigger Events` history of the 100 most recent real invocations (up to 30 min lag for a new/renamed Worker), per current Cloudflare docs. `wrangler dev --test-scheduled` (curling `/__scheduled?cron=...`) is real but local-only and proves nothing about production limits.
- `src/lib/openai.ts`'s `createOpenAIClient()` — returning `null` when the key is absent rather than throwing — is the established optional-secret client factory shape (mirrors `src/lib/supabase.ts`); `src/lib/resend.ts` follows it exactly.

## Desired End State

A custom Worker entrypoint exports both `fetch` (Astro, unchanged) and `scheduled`. On its daily Cron Trigger, the Worker calls Resend with a minimal branded HTML email (the design bundle's header/footer chrome, a placeholder body) to a single configured test recipient, and logs the Resend message id or the error via `console.log`/`console.error`. The path has been proven against a real deployed Worker — not `astro dev` — including a real email arriving in a real inbox.

**Verification**: `wrangler secret list` shows `RESEND_API_KEY` and `RESEND_TEST_RECIPIENT` present in production; `wrangler tail` during a real (or temporarily-tightened) cron firing shows a successful Resend call and no uncaught exceptions; the configured recipient's inbox receives the email; the dashboard's `Trigger Events` shows a successful invocation; the final shipped `wrangler.jsonc` carries the daily schedule, not the temporary verification interval.

## What We're NOT Doing

- No reminder content, no decay logic, no ranking data in the email — the body is a fixed placeholder message. That's `S-04`.
- No full email template design (typography system beyond reusing existing tokens, dynamic content slots, per-client HTML testing) — only the header/footer chrome from the design bundle, as a reusable shell. `S-04` fills it with real content.
- No dispatch/chunking/queue scaffolding for multiple recipients — the handler sends exactly one email. `S-04`'s real per-user sweep designs its own chunking against the 10ms CPU cap when it exists.
- No owned-domain verification — sending identity is Resend's `onboarding@resend.dev` test sender, restricted to the account owner's own inbox. A domain swap is a real, separate gap before this app has a second user, tracked as a follow-up rather than solved here.
- No automated end-to-end script that triggers the production cron on demand — no such mechanism is confirmed to exist. Production proof is manual (dashboard + `wrangler tail` + real inbox), same as any other manual-verification step in this repo's plans.
- No Supabase call of any kind inside the scheduled handler — this foundation's send has nothing to do with per-user data, and deliberately stays out of RLS's scope rather than establish a pattern `S-04` might copy carelessly.

## Implementation Approach

Add `RESEND_API_KEY` and `RESEND_TEST_RECIPIENT` through the exact three-location secret pattern already used for `OPENAI_API_KEY`. Wrap Astro's Cloudflare `handle` in a new custom entrypoint (`src/worker.ts`) that also exports `scheduled`, following the pattern Astro's own docs show for adding Cloudflare Worker features beyond `fetch`. Inside `scheduled`, call the official `resend` SDK (documented as supported directly in a Cloudflare Worker) with an HTML body built from a small reusable shell module styled from the design bundle's email chrome. Verify locally via `wrangler dev --test-scheduled` (the user's own terminal, not run by this plan's automation), then in production by temporarily tightening the Cron Trigger interval, applying it with `wrangler triggers deploy`, observing a real firing through the dashboard + `wrangler tail` + the actual inbox, and finally redeploying the real daily schedule.

## Critical Implementation Details

### Custom Worker entrypoint replaces the adapter's default

`wrangler.jsonc`'s `"main"` currently points directly at `@astrojs/cloudflare/entrypoints/server`, which only exports `fetch`. Cloudflare Workers requires every export (`fetch`, `scheduled`, ...) on one default object, so this plan adds `src/worker.ts` importing `handle` from the public `@astrojs/cloudflare/handler` entry, re-exporting `fetch: handle` unchanged plus a new `scheduled` function, and repoints `"main"` at that file. Astro's own upgrade docs show this exact shape (their example adds a `queue` handler the identical way) — this is not a workaround, it's the sanctioned extension point.

### `triggers.crons` needs a real trigger deploy to take effect

Editing `wrangler.jsonc` and running `wrangler versions upload` will **not** apply the new Cron Trigger — non-versioned settings sync only via `wrangler triggers deploy` (or a full `wrangler deploy` / `versions deploy`). Treat a missing `Trigger Events` entry after an upload-only deploy as an unsynced-settings symptom, not a broken handler — same failure shape `lessons.md` already documents for `observability`/`tail_consumers`.

### `--test-scheduled` cannot work in this project — `no_bundle: true` strips its injection point

Discovered empirically during Phase 2 implementation (two dead-end fixes tried and reverted before finding this: `assets.run_worker_first`, and rebuilding to sync `@astrojs/cloudflare`'s redirected `dist/server/wrangler.json` — `wrangler dev`'s own banner shows it reads that generated file, not `wrangler.jsonc`, directly). `wrangler dev --test-scheduled`'s `/__scheduled` interception is not a Miniflare HTTP-layer feature — it's a **build-time middleware wrangler injects while bundling the entrypoint** (`node_modules/wrangler/wrangler-dist/cli.js:136553`, template `middleware-scheduled.ts`), which wraps the exported `fetch` and redirects a `/__scheduled` request to the `scheduled` export. It only gets injected when wrangler performs its own esbuild bundling pass. The generated `dist/server/wrangler.json` carries `"no_bundle": true`, because Astro's Cloudflare adapter does its own bundling via Vite and explicitly tells wrangler not to re-bundle. Wrangler therefore never injects the scheduled-test middleware here, so `/__scheduled` can never reach `scheduled()` in this project — no `wrangler.jsonc`/`assets` config fixes this; it is a structural incompatibility between the Astro adapter's build and `--test-scheduled`. Consequence: Phase 2's local verification cannot exercise the scheduled→Resend path at all; only Phase 3's real production Cron Trigger firing proves that path end-to-end. Phase 2's local check is scoped down to what plain `tsx` *can* verify in isolation — the email shell's markup — via `scripts/render-email-preview.ts`, which imports `renderEmailShell` directly (no Astro/Vite context needed, since that module has no `astro:env/server` dependency) and writes the output to a local HTML file for the user to open in a browser.

### Verification cadence swap sequencing

Phase 3 ships a temporary tight interval (e.g. `*/5 * * * *`) via `wrangler triggers deploy` specifically to get a fast, real production firing to observe. Before this foundation is considered done, `wrangler.jsonc` must be edited back to the real daily schedule (`0 0 * * *`) and re-applied with another `wrangler triggers deploy` — the temporary interval must never be the one left shipped, both because it burns Cloudflare's account-wide 5-Cron-Trigger budget's log volume and because it isn't the schedule FR-008/NFR "at most once per day" actually calls for.

## Phase 1: Secret + env schema plumbing

### Overview

Get `RESEND_API_KEY` and `RESEND_TEST_RECIPIENT` flowing through `astro:env/server`, the same shape as `OPENAI_API_KEY`, without yet touching production.

### Changes Required:

#### 1. Astro env schema

**File**: `astro.config.mjs`

**Intent**: Declare both `RESEND_API_KEY` and `RESEND_TEST_RECIPIENT` as server-only secret env vars, in the same `env.schema` block as the existing entries.

**Contract**: `RESEND_API_KEY: envField.string({ context: "server", access: "secret", optional: true })` and `RESEND_TEST_RECIPIENT: envField.string({ context: "server", access: "secret", optional: true })` — `optional: true` on both, matching `OPENAI_API_KEY`'s rationale: the client factory below returns `null`/no-ops on a missing key rather than throwing, so a missing secret fails this one scheduled send, not the whole Worker.

#### 2. Local secrets

**File**: `.dev.vars` (gitignored), `.env.example`

**Intent**: `RESEND_API_KEY` already exists in `.dev.vars`; add `RESEND_TEST_RECIPIENT` (the user's own address — the only one Resend's test sender can deliver to) as a manual, human-entered value. Add the placeholder to `.env.example` so the schema is self-documenting.

**Contract**: `.dev.vars` gains a `RESEND_TEST_RECIPIENT` line (human step). `.env.example` gains `RESEND_TEST_RECIPIENT=###`.

#### 3. GitHub Secrets entry

**File**: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Intent**: Keep CI's build env in step with the schema, mirroring the existing `OPENAI_API_KEY` entry. Not load-bearing yet — `optional: true` means `npm run build` succeeds without it.

**Contract**: Add `RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}` and `RESEND_TEST_RECIPIENT: ${{ secrets.RESEND_TEST_RECIPIENT }}` to the existing `env:` block under the `npm run build` step in both workflow files. Creating the actual GitHub Secrets is a human step.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Build succeeds locally with both vars present in `.dev.vars`: `npm run build`

#### Manual Verification:

- User has added `RESEND_TEST_RECIPIENT` (their own address) to local `.dev.vars`
- User has added `RESEND_API_KEY` and `RESEND_TEST_RECIPIENT` to the GitHub repo's Actions secrets
- User confirms `npm run dev` boots without a new config-related error

---

## Phase 2: Scheduled send mechanism

### Overview

Add the `resend` package, the client factory, the reusable email shell, the custom Worker entrypoint with a `scheduled` export, and the Cron Trigger config — the core mechanism this foundation exists to prove.

### Changes Required:

#### 1. Resend package + client factory

**File**: `package.json` (dependency), `src/lib/resend.ts` (new)

**Intent**: Add the official `resend` SDK (documented as directly supported in a Cloudflare Worker's `fetch`/`scheduled` handlers), and a client factory mirroring `src/lib/openai.ts`'s shape — returns `null` when `RESEND_API_KEY` is absent.

**Contract**: `npm install resend`. `src/lib/resend.ts` exports `createResendClient()` reading `RESEND_API_KEY` from `astro:env/server`, returning `null` if unset or a configured `Resend` client otherwise.

#### 2. Email shell

**File**: `src/lib/email/shell.ts` (new)

**Intent**: A small function building the reusable HTML chrome from the design bundle's email section (`.ai/intouch-design-preparation/project/InTouch.dc.html:1080-1087` header, `:1141-1144` footer) — the two-circle logo mark, `InTouch` wordmark in `Instrument Serif`, a date, a 600px card, and the muted footer disclaimer band. Takes the proof message as a plain string body slot; carries no dynamic ranking content.

**Contract**: `renderEmailShell({ subject, bodyHtml }: { subject: string; bodyHtml: string }): string` returning a complete HTML document string with inlined styles (email HTML cannot rely on external stylesheets), reusing the exact colors/radii/spacing from the design bundle's email mockup rather than the app's Tailwind tokens (which don't reach inline-styled HTML).

#### 3. Custom Worker entrypoint

**File**: `src/worker.ts` (new), `wrangler.jsonc`

**Intent**: Re-export Astro's `fetch` handler unchanged and add a `scheduled` export that builds the proof email via §2's shell, sends it via §1's client to `RESEND_TEST_RECIPIENT`, and logs the outcome. Point `wrangler.jsonc`'s `"main"` at this new file (see Critical Implementation Details above) and add the daily `triggers.crons` entry.

**Contract**: `src/worker.ts` default-exports `{ fetch: handle, scheduled(controller, env, ctx) { ... } } satisfies ExportedHandler<Env>` (importing `handle` from `@astrojs/cloudflare/handler`). Inside `scheduled`, read `RESEND_API_KEY`/`RESEND_TEST_RECIPIENT` the same way any other server code does (`astro:env/server` is available outside a request too, since it's build-time-injected config, not a binding) and wrap the send in try/catch, logging `console.log("resend: sent", data.id)` on success or `console.error("resend: failed", error)` on failure — no KV/persisted status, matching this repo's "platform logs, no vendor" posture. `wrangler.jsonc` changes: `"main": "./src/worker.ts"` and `"triggers": { "crons": ["0 0 * * *"] }`.

#### 4. Local email preview script

**File**: `scripts/render-email-preview.ts` (new), `package.json` (new script)

**Intent**: Since `--test-scheduled` cannot reach `scheduled()` in this project (see Critical Implementation Details), the only thing locally checkable before Phase 3's production proof is the email markup itself. A standalone `tsx` script imports `renderEmailShell` directly — no Astro/Vite context needed — and writes the rendered HTML to a local file for the user to open in a browser.

**Contract**: `npm run render:email-preview` writes `email-preview.html` (gitignored, scratch output) to the repo root using the same proof-message body `src/worker.ts` sends.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Build succeeds: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- User runs `npm run render:email-preview` and opens `email-preview.html` in a browser
- The rendered chrome (logo mark, `InTouch` wordmark, date, footer disclaimer) visually matches the design bundle's header/footer treatment

---

## Phase 3: Production secret + verification

### Overview

Set the real production secrets (human step), get a fast real production firing via a temporarily-tightened schedule, observe it end-to-end, then finalize to the real daily cadence.

### Changes Required:

#### 1. Production secrets

**Human step, not delegated**: `npx wrangler secret put RESEND_API_KEY` and `npx wrangler secret put RESEND_TEST_RECIPIENT`, then `npx wrangler secret list` to confirm both names are present — matching this repo's existing posture that production secret rotation is a human operation (`CLAUDE.md`).

#### 2. Temporary verification interval

**File**: `wrangler.jsonc`

**Intent**: Temporarily replace the daily schedule with a tight interval so a real production firing can be observed within minutes instead of up to 24h, then apply it with a real trigger deploy (see Critical Implementation Details — `versions upload` alone won't sync it).

**Contract**: `"triggers": { "crons": ["*/5 * * * *"] }`, applied via `npx wrangler triggers deploy` (human-run, alongside a full `npm run deploy` if the Worker code itself also needs to be live).

#### 3. Finalize to daily schedule

**File**: `wrangler.jsonc`

**Intent**: Once the temporary interval's firing has been observed and confirmed (see Manual Verification below), restore the real daily schedule and re-apply it — this is the config state the foundation ships with.

**Contract**: `"triggers": { "crons": ["0 0 * * *"] }`, re-applied via `npx wrangler triggers deploy`.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- `wrangler secret list` shows both `RESEND_API_KEY` and `RESEND_TEST_RECIPIENT` present in production
- During the temporary tight-interval window, the Cloudflare dashboard's `Trigger Events` for this Worker shows a successful invocation
- `wrangler tail` during that same window shows the Resend call completing and logs the success line (message id) with no uncaught exceptions
- The configured recipient's real inbox receives the email
- `wrangler.jsonc` has been restored to the daily schedule and re-applied via `wrangler triggers deploy`; the dashboard's `Trigger Events` (or a subsequent `wrangler tail` session) confirms the deployed schedule is `0 0 * * *`, not the temporary interval

**Implementation Note**: After this phase's automated verification passes, pause here for manual confirmation from the human that every item above — including the final daily-schedule restoration — has been completed before considering this foundation done.

---

## Testing Strategy

### Unit Tests:

- None — this repo has no test framework; verification follows the existing standalone-manual-proof convention (`F-02`'s script-based proof doesn't transfer here, since no production mechanism exists to trigger a deployed Cron Trigger on demand from a script).

### Integration Tests:

- None scripted. The temporary-interval production firing (Phase 3) is this foundation's integration-level proof: a real Cron Trigger, a real Resend call, a real inbox.

### Manual Testing Steps:

1. Locally: `npm run render:email-preview`, open `email-preview.html` in a browser, confirm the chrome matches the design bundle (`--test-scheduled` cannot exercise the actual scheduled→Resend path in this project — see Critical Implementation Details).
2. Deploy the Worker code (`npm run preview:upload` or `npm run deploy`) and set both production secrets.
3. Temporarily set `triggers.crons` to a tight interval, apply with `wrangler triggers deploy`, and watch `wrangler tail` plus the dashboard's `Trigger Events` for the next firing.
4. Confirm the email arrives in the real inbox and its chrome matches the design bundle.
5. Restore the daily schedule, re-apply with `wrangler triggers deploy`, and confirm the dashboard reflects the final schedule.

## Performance Considerations

A single Resend HTTP call costs ~0 CPU-ms (network wait isn't CPU time) and 1 of the 50-subrequest budget per invocation — no chunking concerns for a single-recipient send. This foundation is the first Cron Trigger added for this Cloudflare account on this project; the account-wide 5-Cron-Trigger cap (shared across all projects on the account, per `context/foundation/infrastructure.md`) now has 1 of 5 in use.

## Migration Notes

Not applicable — no Supabase schema changes in this foundation, and the scheduled handler deliberately makes no Supabase call at all.

## References

- Related roadmap item: `context/foundation/roadmap.md` (`F-04: resend-email-delivery-path`)
- Precedent foundation: `context/changes/openai-ranking-call-path/plan.md` (`F-02`) — same shape, same secret pattern, same "prove the call path" scope
- Email chrome source: `.ai/intouch-design-preparation/project/InTouch.dc.html:1047-1176` (design bundle, section 9)
- Existing optional-secret client pattern: `src/lib/openai.ts`
- Existing env schema: `astro.config.mjs`
- Custom Cloudflare Worker entrypoint pattern: Astro's Cloudflare adapter docs (`@astrojs/cloudflare/handler`, verified present in `node_modules/@astrojs/cloudflare/package.json` exports map)
- Non-versioned `wrangler.jsonc` settings gotcha: `context/foundation/lessons.md` ("Cloudflare non-versioned settings sync only on `versions deploy`")
- Account-wide Cron Trigger budget: `context/foundation/infrastructure.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Secret + env schema plumbing

#### Automated

- [x] 1.1 Type check passes: `npx astro check` — c7df7e9
- [x] 1.2 Build succeeds locally with both vars present in `.dev.vars`: `npm run build` — c7df7e9

#### Manual

- [x] 1.3 User has added `RESEND_TEST_RECIPIENT` (their own address) to local `.dev.vars` — c7df7e9
- [x] 1.4 User has added `RESEND_API_KEY` and `RESEND_TEST_RECIPIENT` to the GitHub repo's Actions secrets — c7df7e9
- [x] 1.5 User confirms `npm run dev` boots without a new config-related error — c7df7e9

### Phase 2: Scheduled send mechanism

#### Automated

- [x] 2.1 Type check passes: `npx astro check` — d634d34
- [x] 2.2 Build succeeds: `npm run build` — d634d34
- [x] 2.3 Lint passes: `npm run lint` — d634d34

#### Manual

- [x] 2.4 User runs `npm run render:email-preview` and opens `email-preview.html` in a browser — d634d34
- [x] 2.5 The rendered chrome visually matches the design bundle's header/footer treatment — d634d34

### Phase 3: Production secret + verification

#### Automated

- [x] 3.1 Type check passes: `npx astro check` — b298576
- [x] 3.2 Build succeeds: `npm run build` — b298576

#### Manual

- [x] 3.3 `wrangler secret list` shows both `RESEND_API_KEY` and `RESEND_TEST_RECIPIENT` present in production — b298576
- [x] 3.4 Dashboard's `Trigger Events` shows a successful invocation during the temporary tight-interval window — b298576
- [x] 3.5 `wrangler tail` shows the Resend call completing with a logged success line and no uncaught exceptions — b298576
- [x] 3.6 The configured recipient's real inbox receives the email — b298576
- [x] 3.7 `wrangler.jsonc` restored to the daily schedule and re-applied via `wrangler triggers deploy`; dashboard confirms the final schedule is `0 0 * * *` — b298576
