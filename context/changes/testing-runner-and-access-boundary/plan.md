# Runner Bootstrap and Access Boundary — Implementation Plan

## Overview

This is `context/foundation/test-plan.md` §3 **Phase 1**: stand up Vitest in a repo that has zero test infrastructure, then prove — against real routes and the real local Supabase stack — that neither a second signed-in user nor an anonymous caller can reach the first user's data. It covers risks **#1** (cross-user read/mutation of people, rankings or contact events) and **#5** (unauthenticated visitor, or a stale/replayed recovery token, reaching relationship data).

The work is deliberately layered. The cheapest layer that gives a real signal wins, per §1 of the test plan: RLS rules are proven against real Postgres, route guards are proven by invoking real handlers, and only the cookie→middleware→guard chain — the one thing neither cheaper layer can exercise — is proven over HTTP.

## Current State Analysis

**Test infrastructure: none.** No `vitest`, no `@vitest/*`, no `@cloudflare/vitest-pool-workers`, no test directory, no `test` npm script. `astro` is 6.3.1 and `vite` is 7.3.3 (pinned by `package.json:71-73` `overrides`).

**The access boundary itself is already two-layer and mostly redundant on purpose.** All five owner-scoped tables (`people`, `profiles`, `rankings`, `ranking_entries`, `contact_events`) have a complete SELECT/INSERT/UPDATE/DELETE RLS policy set keyed on `(select auth.uid()) = owner_id`. Every data-touching API route carries its own `if (!context.locals.user)` guard, and every id-addressed mutation _also_ filters `.eq("owner_id", ownerId)` in the same query. No route anywhere uses a privileged client — every query runs as the calling user under RLS.

**What is unproven** (from `research.md` §5):

| Gap                                                                         | Where                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `rankings` and `ranking_entries` have zero isolation coverage               | `scripts/verify-rls.ts` touches only `people`, `profiles`, `contact_events` |
| Cross-owner INSERT (`WITH CHECK` failing direction) untested on every table | `verify-rls.ts:92-98`, `:151-163`, `:232-244` only insert own rows          |
| Anonymous writes untested on every table                                    | only anonymous SELECT is asserted                                           |
| Route guards, response shapes and 404-not-403 untested                      | no test infrastructure exists                                               |
| Recovery-token branches verified manually only                              | `context/archive/2026-09-04-password-recovery/plan.md:280`, `:332`          |

**Two harness halves already exist as scripts.** `scripts/verify-rls.ts` is the two-real-user DB harness (service-role for user creation only, then real `signInWithPassword` sessions on anon-key clients). `scripts/verify-openai-call.ts` is the HTTP harness (anonymous-401 checks, sign-in through the app's own route, `getSetCookie()` jar, replay with `Cookie:`). Neither touches `astro:env/server` — which is why the repo has never had to solve the problem Phase 1 must solve.

## Desired End State

`npm test` runs a Vitest suite that fails if any of the following stops being true:

- User B cannot read, update, delete, or forge ownership of user A's rows in any of the five tables — proven at the DB layer with two real users on anon-key clients.
- An anonymous client can neither read nor write any table.
- Every route on the agreed surface rejects an unauthenticated caller with its actual documented response, and a wrong-owner request returns 404 with the mutation not landing — proven by a second, independent read as the victim.
- A request carrying a real session cookie reaches the guard through real middleware; one carrying none does not.
- Our four recovery-token branches behave correctly when `verifyOtp` fails, with no session created and no `updateUser` call.

Verified by: `npm test` green with the local Supabase stack running, and `npm test` green against a dev server for the opt-in HTTP layer.

### Key Discoveries

- **`astro:env/server` is resolvable in tests, but the values are inlined, not lazy.** `node_modules/astro/dist/env/vite-plugin-env.js:83` passes `loadedEnv: isBuild ? null : loadedEnv`; `:152-156` then either inlines the object or emits `_getEnv(key)`. Under any non-build command the values are baked in at transform time, so **`setGetEnv` from `astro/env/setup` is inert** — the obvious escape hatch is a dead end.
- **`.env.test` is the right supply mechanism and needs no `.gitignore` change.** Astro loads via `loadEnv(mode, envDir, "")` (`node_modules/astro/dist/env/env-loader.js:39`), Vitest's default mode is `test`, and `.gitignore:22-24` lists `.env` and `.env.production` literally — `git check-ignore .env.test` reports not-ignored.
- **The Cloudflare adapter externalises `cloudflare:*` inside the config `getViteConfig` produces.** `node_modules/@astrojs/cloudflare/dist/index.js:137-152` injects `@cloudflare/vite-plugin` and a `@astrojs/cloudflare:cf-imports` plugin (`enforce: "pre"`) whose `resolveId` returns `{ id, external: true }` for `/^cloudflare:/`. `src/lib/ai-jobs.ts:4` imports `cloudflare:workers` at module top level, and `src/pages/api/rankings.ts:2` + `src/pages/api/internal/ai-ping.ts:2` both import that module — so two of the eleven routes cannot be imported into a node test until this is settled.
- **Missing env fails silently, not loudly.** Secrets skip validation (`vite-plugin-env.js:106`), so absent values surface as `createClient` returning `null` (`src/lib/supabase.ts:7-9`), which routes translate into 500 (`delete-data.ts:24`) or a redirect (`people.ts:20`). A misconfigured harness looks exactly like a product bug.
- **RLS filters; it does not reject.** A cross-owner UPDATE/DELETE succeeds with zero rows affected; a cross-owner SELECT returns an empty set. Only a missing GRANT yields an error (`42501`). Asserting "an error was thrown" would fail against correct behaviour.
- **Astro's origin check runs before routing.** Per `context/foundation/lessons.md`, an unsafe-method request with a form-like content-type — or none at all — is rejected `403 "Cross-site POST form submissions are forbidden"` unless `Origin` matches, and never reaches the route.
- **Vitest 5.0.0 accepts this repo's Vite.** Peer range is `vite: ^6.4.0 || ^7.0.0 || ^8.0.0`; installed Vite is 7.3.3.

## What We're NOT Doing

- **Not changing any application behaviour.** The two gaps research found — `AiJob` carries no owner field (`src/lib/ai-jobs.ts:10-16`), and the two FK lookups in `POST /api/contact-events` have no redundant owner filter — are pinned as-is and filed as a follow-up. While bootstrapping a runner, a red test must mean "the harness is wrong"; mixing in behaviour changes destroys that signal.
- **Not testing the vendors.** No test asserts that Supabase rejects a replayed token, that `otp_expiry` works, or that Postgres enforces a policy in the abstract. Per test-plan §7, single-use and expiry semantics belong to Supabase; our contract is the four branches around `verifyOtp`.
- **Not gating CI.** Test-plan §5 makes the suite required only after Phase 5. `ci.yml` is untouched.
- **Not testing page routes.** `src/pages/dashboard.astro`, `profile.astro`, `people/index.astro`, `people/[id].astro` all read data directly under middleware protection. Out of scope by the surface agreed during research; named in Phase 5's follow-up so Phase 5 does not assume it was covered.
- **Not proving erasure completeness.** `POST /api/settings/delete-data` gets an access test only ("A's wipe does not reach B"); "no row in any table survives" is Phase 2's risk #2.
- **No e2e/Playwright layer, no visual regression, no Container API rendering.** Test-plan §7 and §4.

## Implementation Approach

Three test layers, each with exactly one prerequisite, so a failure is diagnosable:

| Layer | Directory       | Prerequisite                       | Proves                                                               |
| ----- | --------------- | ---------------------------------- | -------------------------------------------------------------------- |
| RLS   | `tests/rls/`    | local Supabase stack up            | the policies themselves, with two real users                         |
| Route | `tests/routes/` | none (`.env.test` committed)       | guards, owner filters, response shapes, token branches               |
| HTTP  | `tests/http/`   | a running server (`TEST_BASE_URL`) | cookie → middleware → `locals.user` → guard, origin check, redirects |

The RLS layer talks to `@supabase/supabase-js` directly and never touches Astro, so it needs no env plumbing at all. The route layer imports handlers and hands them a synthetic `APIContext`. The HTTP layer extends the `verify-openai-call.ts` pattern to two users and skips cleanly when `TEST_BASE_URL` is unset — **the developer starts the server; the suite never does.**

Phase 1 is deliberately probe-first. Two assumptions cannot be verified until Vitest is installed, and both are load-bearing enough to invalidate the config if wrong. Phase 1 resolves them with throwaway tests before Phase 2 writes anything real.

## Critical Implementation Details

**Env ordering.** Because values are inlined at Vite config-resolution time (`vite-plugin-env.js:83`, `:152-156`), setting `process.env.SUPABASE_URL` inside a test file or a `setupFiles` module is too late to be reliable. `.env.test` is read by `loadEnv` during config resolution, which is why it is the mechanism rather than a runtime assignment. Do not reach for `setGetEnv` — under a non-build command the generated module never calls `_getEnv`.

**`cloudflare:workers` resolution is a Phase 1 decision point, with both branches pre-decided.** If the probe shows the specifier resolves (or can be aliased ahead of `@astrojs/cloudflare:cf-imports`, which is `enforce: "pre"`), add a `test.alias` entry pointing at an in-memory KV stub and cover `/api/rankings` and `/api/internal/ai-ping` at the route layer. If it cannot be aliased cleanly — or if `@cloudflare/vite-plugin` destabilises the run — those two routes move to the HTTP layer only, and Phase 3 notes the exclusion. Do not spend more than one session forcing the alias; the HTTP fallback is a legitimate answer, not a defeat.

**Two-user fixtures must not use the service-role key for assertions.** Follow `scripts/verify-rls.ts:36-75` exactly: service-role creates and deletes the throwaway users; every assertion runs through anon-key clients carrying real JWTs from `signInWithPassword`. Proving a policy with the key that wrote the row is the anti-pattern the test plan names explicitly for risk #1.

**Local auth rate limits bound fixture design.** `supabase/config.toml:189` caps `sign_in_sign_ups` at 30 per 5 minutes per IP. Mint the two sessions once per suite run and share them, rather than signing in per test file.

## Phase 1: Runner Bootstrap (probe-first)

### Overview

Install and configure Vitest, commit the test env, establish the directory layout, and settle the two unverified assumptions with throwaway probes before any real assertion is written.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add Vitest as a devDependency and expose the run command. No CI change.

**Contract**: `vitest@^5` (peer `vite: ^6.4.0 || ^7.0.0 || ^8.0.0`, satisfied by installed 7.3.3). New script `"test": "vitest run"`; a `"test:watch": "vitest"` is optional. Leave `verify:rls` in place — Phase 2 removes it.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Wire Vitest through Astro's own Vite pipeline so `astro:env/server` and the `@/` alias resolve the way they do in the app.

**Contract**: Default-export `getViteConfig({ test: { … } })` from `astro/config`. `test.environment` must be `"node"` (Astro 6 requires it and the whole surface is server-side). Mirror `tsconfig.json`'s `paths` — `@/*` → `./src/*` — in `resolve.alias`, because Vitest does not read tsconfig paths. Declare the three layer directories as the include set so a subset can be run by path.

#### 3. Test environment values

**File**: `.env.test` (new, repo root, committed)

**Intent**: Supply the two required env vars at config-resolution time. Values are local-stack constants — `http://127.0.0.1:54321` and the fixed local anon key — not secrets.

**Contract**: `SUPABASE_URL` and `SUPABASE_KEY` (the only two `optional: false` entries in `astro.config.mjs:32-49`). Include a header comment stating why this file is committed when every other env file is ignored, and that it must never hold a hosted-project key. `git check-ignore` confirms `.gitignore` does not match it, so no `.gitignore` edit is needed.

#### 4. Directory layout

**Files**: `tests/rls/`, `tests/routes/`, `tests/http/`

**Intent**: Establish the layout Phases 2–4 fill and cookbook §6.1–6.3 will describe.

**Contract**: One directory per layer, each corresponding to exactly one prerequisite. Test files are `*.test.ts`. `tsconfig.json:2-12` already includes `**/*`, so no tsconfig change is needed; `eslint.config.js` lints them under `strictTypeChecked` with `projectService: true`, so they must type-check.

#### 5. Probe A — env resolution

**File**: `tests/routes/env-probe.test.ts` (temporary; deleted at the end of this phase)

**Intent**: Settle whether `astro:env/server` resolves under Vitest and whether `.env.test` actually supplies the values. This is the single assumption that would otherwise send the whole phase chasing a phantom config bug.

**Contract**: Import `createClient` from `@/lib/supabase` and assert it returns a non-null client. A `null` return means env did not arrive — that is the silent failure mode described above, and this probe converts it into an explicit one.

#### 6. Probe B — Cloudflare binding resolution

**File**: `tests/routes/cf-probe.test.ts` (temporary; deleted at the end of this phase)

**Intent**: Settle whether a module importing `cloudflare:workers` can be loaded under Vitest, which decides where `/api/rankings` and `/api/internal/ai-ping` get covered.

**Contract**: Import `@/lib/ai-jobs`. If it loads, add a `test.alias` for `cloudflare:workers` pointing at an in-memory KV stub exposing the `AI_JOBS.get/put` surface used by `src/lib/ai-jobs.ts:19-24`, and record that the two job routes belong to the route layer. If it cannot be made to load, record that they belong to the HTTP layer only. Write the outcome into this plan's Phase 3 scope note before starting Phase 3.

### Success Criteria:

#### Automated Verification:

- `npm test` runs and exits 0
- Probe A passes: `createClient` returns a non-null client, proving `astro:env/server` resolved and `.env.test` supplied both values
- Probe B produces a definite outcome (loads, or fails with a recorded reason)
- `npm run lint` passes with the new files present
- `npx astro check` passes
- `npm run build` still passes (config changes did not disturb the app build)

#### Manual Verification:

- The `cloudflare:workers` decision is written into Phase 3's scope note, with the branch taken and why
- `.env.test` contains only local-stack values, and its header comment explains why it is committed
- Both probe files are deleted before Phase 2 starts

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding. Phase 2's shape depends on Probe B's outcome.

---

## Phase 2: RLS Layer

### Overview

Promote every assertion in `scripts/verify-rls.ts` into Vitest, extend it to the two untested tables and the two untested directions, then delete the script.

### Changes Required:

#### 1. Two-user fixture

**File**: `tests/rls/fixture.ts` (new)

**Intent**: Create two throwaway confirmed users and hand back anon-key clients carrying their real sessions, plus a bare anonymous client — the setup every RLS test shares.

**Contract**: Follow `scripts/verify-rls.ts:36-75`. Read `API_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY` from `supabase status -o json`, and keep the `verify-rls.ts:30` guard refusing any non-local URL. Service-role is used **only** for `auth.admin.createUser` and `auth.admin.deleteUser`; all assertions go through anon-key clients. Sessions are minted once per run (rate limit, `supabase/config.toml:189`). Teardown deletes both users and relies on `ON DELETE CASCADE` from `auth.users`. If the stack is unreachable, fail with a message naming `supabase start` rather than a connection error.

#### 2. Ported assertions

**File**: `tests/rls/isolation.test.ts` (new)

**Intent**: Carry over what the script already proves for `people`, `profiles` and `contact_events`, keeping the semantics that make the assertions meaningful.

**Contract**: For each table: own-row insert succeeds; B cannot SELECT A's row; B's UPDATE affects zero rows; B's DELETE affects zero rows **and** A re-reads the row intact (`verify-rls.ts:119-127` — this is O4's "the mutation does not land"); anonymous SELECT returns zero rows. Expect zero-row results, not thrown errors — RLS filters rather than rejects.

#### 3. New coverage

**File**: `tests/rls/isolation.test.ts` (same file)

**Intent**: Close the three gaps research identified.

**Contract**: Extend all of the above to `rankings` and `ranking_entries` (note `ranking_entries` needs a parent `rankings` row and a `people` row, per the FKs at `supabase/migrations/20260901120000_create_rankings_tables.sql:52-54`). Add, for all five tables: B attempts an INSERT stamped `owner_id: userA` and it is refused by `WITH CHECK`; the anonymous client attempts INSERT, UPDATE and DELETE and reaches nothing. Prefer one parameterised test per property over five near-identical copies.

#### 4. Retire the script

**Files**: `scripts/verify-rls.ts` (delete), `package.json`

**Intent**: Remove the duplicate now that the suite is authoritative, per test-plan §4 ("the seed to promote, not to keep").

**Contract**: Delete the script and the `verify:rls` npm entry. Do not edit the archived change that references it — that reference is historical and correct for its time.

### Success Criteria:

#### Automated Verification:

- `npm test tests/rls` passes with the local stack running
- Every one of the five tables has assertions for: cross-user SELECT, UPDATE, DELETE, forged-owner INSERT, and anonymous read + write
- Each cross-user mutation test includes an independent victim-side read proving the row is untouched
- `npm run lint` and `npx astro check` pass
- `scripts/verify-rls.ts` no longer exists and `npm run verify:rls` is gone

#### Manual Verification:

- Temporarily inverting one RLS policy locally makes the corresponding test fail (the suite detects a real regression, not just its own fixtures)
- No assertion path uses the service-role key
- Teardown leaves no throwaway users behind — confirm in Studio at `http://127.0.0.1:54323`

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Route Layer

### Overview

Prove each route's own guard, owner filter, response shape and the recovery-token branches, by invoking real handlers with a synthetic context.

### Changes Required:

#### 1. Synthetic context helper

**File**: `tests/routes/context.ts` (new)

**Intent**: Build the minimal `APIContext` the handlers actually consume, so a test can invoke a real exported handler without a server.

**Contract**: The handlers on this surface use exactly six members: `locals.user`, `request` (headers plus `formData()` or `json()`), `cookies`, `url.searchParams`, `params.id`, and `redirect`. `redirect` must return a real `Response` with a 302 status and a `Location` header, since `POST /api/people` and `POST /api/auth/reset-password` return redirects rather than JSON. The helper takes an optional session so the same route can be driven as user A, user B, or anonymous.

#### 2. Unauthenticated matrix

**File**: `tests/routes/unauthenticated.test.ts` (new)

**Intent**: Prove every route refuses a caller with no session, asserting each route's _actual_ response rather than a uniform expectation.

**Contract**: Three response families, and a test asserting the wrong one is a false failure: `{"error":"Unauthorized"}` with 401 for `people/[id]`, `contact-events` (both), `rankings`, `ai-ping`; `{"error":"Musisz być zalogowany"}` with 401 for `profile` and all three `settings/*`; a 302 redirect with no JSON for `POST /api/people` (`people.ts:8`) and `POST /api/auth/reset-password` (`reset-password.ts:6-8`). For the two redirect routes, also assert nothing was written — a redirect alone does not discharge O4.

#### 3. Wrong-owner matrix

**File**: `tests/routes/cross-owner.test.ts` (new)

**Intent**: Prove an authenticated user cannot reach another user's row through any id-addressed route, and that no response distinguishes "absent" from "not yours".

**Contract**: For `PATCH`/`DELETE` on `people/[id]` and `contact-events/[id]`: user B addressing user A's id gets 404 with the route's Polish message, and an independent read as A shows the row unchanged. Assert that a genuinely nonexistent id produces the _identical_ status and body — that equality is the no-existence-leak property (`people/[id].ts:74-75`). For `GET /api/contact-events` with another owner's `personId`, expect an empty array, not an error. For `POST /api/contact-events`, drive both FK paths — a `personId` and a `rankingEntryId` belonging to user A — and expect 404 from B; this is the route where protection rests purely on RLS (`contact-events.ts:39-42`, `:48-50`).

#### 4. Destructive-route blast radius

**File**: `tests/routes/delete-data.test.ts` (new)

**Intent**: Prove the repo's most destructive route is refused when anonymous and owner-scoped when authenticated.

**Contract**: Anonymous call returns 401 `Musisz być zalogowany` and touches nothing. With data seeded for both users, user A's call succeeds and user B's `people`, `rankings` and `profiles` rows all still exist afterwards. Completeness of A's own erasure is explicitly Phase 2 of the _test plan_ (risk #2) and is not asserted here.

#### 5. Recovery-token branches

**File**: `tests/routes/recovery-token.test.ts` (new)

**Intent**: Replace the manual-only checkbox left by the password-recovery change with automated coverage of the four things our code owns.

**Contract**: Four assertions against `src/pages/auth/confirm.ts` and `src/pages/api/auth/reset-password.ts` — a missing `token_hash` or a `type` outside `ALLOWED_TYPES` redirects to `/auth/signin` without any exchange attempt (`confirm.ts:4`, `:23`); a failing `verifyOtp` creates no session and redirects to `/auth/reset-password?error=…` (`confirm.ts:38-40`); a successful exchange redirects to the mapped `next` (`confirm.ts:7-10`, `:42`); and `POST /api/auth/reset-password` with no session redirects without calling `updateUser` (`reset-password.ts:5-9`). The Supabase error is **injected**, never obtained — assert on our branch, not on the vendor's message text, which is unsanitised and version-dependent.

#### 6. Scope note from Phase 1

**Intent**: Record where the two job routes are covered.

**Contract**: If Probe B succeeded, `/api/rankings` and `/api/internal/ai-ping` are included in the unauthenticated matrix with `cloudflare:workers` aliased to the KV stub. If it did not, they are excluded here and covered in Phase 4 only, and this file carries a comment naming the reason.

**Resolved (Phase 1, Probe B): succeeded — both job routes belong to the route layer.** `tests/routes/cf-probe.test.ts` imported `@/lib/ai-jobs`, round-tripped a job through the binding, and imported both `@/pages/api/rankings` and `@/pages/api/internal/ai-ping` as modules exporting a `POST` function. So Phase 3 covers them here, and Phase 4 §4 ("Job routes, if deferred") does not apply.

The branch was taken, but **not by the route the plan predicted**. Aliasing ahead of `@astrojs/cloudflare:cf-imports` was never the obstacle: `@cloudflare/vite-plugin` — which the adapter injects bound to the `ssr` Vite environment (`node_modules/@astrojs/cloudflare/dist/index.js:136-140`) — refuses to start at all when a Worker environment carries `resolve.external`, which Vitest always sets on `ssr` to externalise node builtins. Vitest therefore died during _config resolution_, before any test file was read, with `"The following environment options are incompatible with the Cloudflare Vite plugin"`. Nothing about `cloudflare:workers` itself was involved.

The fix is in `vitest.config.ts`: strip every adapter-injected Vite plugin (`vite-plugin-cloudflare*`, `@astrojs/cloudflare:*`, `virtual:astro-cloudflare:*`) from the config `getViteConfig` returns, keeping Astro's own — notably `astro:vite-plugin-env`, which is the only reason `getViteConfig` is used. Stripping the adapter also removes the external-marking of `cloudflare:*`, which is what lets the `resolve.alias` entry pointing at `tests/stubs/cloudflare-workers.ts` take effect. Tests run in node, not workerd; Workers-runtime behaviour is proven by deploying, not by this suite.

### Success Criteria:

#### Automated Verification:

- `npm test tests/routes` passes
- Every route on the agreed surface has an unauthenticated assertion matching its real response family
- Every id-addressed route has a wrong-owner assertion plus a victim-side read
- The "nonexistent id" and "someone else's id" responses are asserted equal
- Both FK paths in `POST /api/contact-events` are covered
- The four recovery-token branches pass with the vendor error injected and no live Supabase auth call
- `npm run lint` and `npx astro check` pass

#### Manual Verification:

- Temporarily removing one route's `if (!context.locals.user)` guard makes exactly that route's test fail
- Temporarily removing one `.eq("owner_id", …)` filter does **not** silently stay green — if it does, the test is proving RLS rather than the route, and needs the DB layer bypassed or the assertion re-aimed
- No test asserts on a Supabase-authored error string

**Implementation Note**: Pause for manual confirmation before Phase 4. The second manual item is the most valuable check in the plan — it is the difference between testing the boundary and testing one of its two layers twice.

---

## Phase 4: HTTP Layer (opt-in)

### Overview

Prove the one thing neither cheaper layer can: that a real session cookie becomes `locals.user` through real middleware, and that the guards sit behind Astro's origin check as deployed.

### Changes Required:

#### 1. Two-user HTTP fixture

**File**: `tests/http/fixture.ts` (new)

**Intent**: Mint two real session cookie jars by signing in through the app's own route, the way `verify-openai-call.ts` already does for one user.

**Contract**: Follow `scripts/verify-openai-call.ts:75-88`. POST form-encoded credentials to `/api/auth/signin` with `redirect: "manual"` and an explicit `Origin` header, then harvest `getSetCookie()` into a jar. Do **not** hand-craft the chunked `sb-<ref>-auth-token.0/.1` cookie format — the comment at `verify-openai-call.ts:76-77` explains that it is an internal detail that shifts between versions. Read the base URL from `TEST_BASE_URL`; when unset, skip the whole layer rather than failing, so `npm test` stays green for a developer with no server running.

#### 2. Auth-chain assertions

**File**: `tests/http/access-boundary.test.ts` (new)

**Intent**: Prove the cookie→middleware→`locals.user`→guard chain end to end, which is exactly the assumption risk #5 names as the thing to challenge.

**Contract**: For a representative route from each response family: no cookie → the route's real unauthenticated response; user B's cookie against user A's resource → 404 with the row intact; user A's own cookie → success. Also assert middleware coverage honestly — `src/middleware.ts:4` does **not** list `/api`, so this test proves the per-route guards work _behind_ real middleware, not that middleware gates them.

#### 3. Origin-check behaviour

**File**: `tests/http/origin-check.test.ts` (new)

**Intent**: Pin the CSRF behaviour that makes an auth failure and a rejection look nothing alike, so a future contributor's 403 is diagnosable.

**Contract**: A JSON-bodied POST with `Content-Type: application/json` reaches the route and is judged on auth. A form-encoded or bodiless POST without a matching `Origin` is rejected with 403 before routing — including `POST /api/settings/delete-data`, which reads no body at all (`delete-data.ts:15-44`) and therefore sends no content-type. This encodes `context/foundation/lessons.md`'s rule as an executable check.

#### 4. Job routes, if deferred

**File**: `tests/http/access-boundary.test.ts` (same file)

**Intent**: Cover `/api/rankings` and `/api/internal/ai-ping` here if Probe B ruled them out of the route layer.

**Contract**: Unauthenticated GET and POST return 401 for both, as `verify-openai-call.ts:62-69` already demonstrates. Do not assert job ownership — it is a known, filed gap, and pinning current behaviour means a leaked `jobId` returning a status is the documented expectation, not a bug the test hides.

### Success Criteria:

#### Automated Verification:

- With `TEST_BASE_URL` set and a server running, `npm test tests/http` passes
- With `TEST_BASE_URL` unset, `npm test` still exits 0 and reports the HTTP layer as skipped — not failed
- Both cookie jars are minted through `/api/auth/signin`, with no hand-crafted cookie names anywhere in the suite
- The origin-check test covers all three body kinds: JSON, form-encoded, and bodiless

#### Manual Verification:

- Run the layer against the dev server you start yourself and confirm the skip/run switch behaves both ways
- Confirm the skip message names `TEST_BASE_URL` clearly enough that someone who has never read this plan knows what to do
- Sanity-check that a deliberately wrong `TEST_BASE_URL` fails loudly rather than silently skipping

**Implementation Note**: The suite must never start a server. Pause for manual confirmation before Phase 5.

---

## Phase 5: Cookbook and Sync

### Overview

Write down what the phase taught, so Phases 2–5 of the test plan copy a pattern instead of re-deriving one, and record the two gaps that were deliberately left open.

### Changes Required:

#### 1. Cookbook sections

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the four "TBD — see §3 Phase 1" placeholders with the patterns this change established.

**Contract**: §6.1 gets the runner: where tests live, the three-layer split and what each layer's prerequisite is, the run command, and the `.env.test` mechanism with the reason `setGetEnv` is not it. §6.2 gets the two-real-user harness: service-role for creation only, anon-key clients for every assertion, the victim-side re-read, and the expect-zero-rows-not-errors rule. §6.3 gets the request triad and the three response families, plus the origin-check requirement for non-browser callers. §6.6 gets a 2–3 line note on the surprise — that `astro:env/server` inlines rather than resolves lazily under a test runner.

#### 2. Rollout status

**File**: `context/foundation/test-plan.md`

**Intent**: Move §3 Phase 1's Status from `change opened` to reflect completion, and record the §4 stack row now that the runner exists.

**Contract**: §3 Phase 1 Status advances; §4's "unit + integration" row changes from "none yet — see Phase 1" to the installed Vitest version. Update the §8 freshness ledger date.

#### 3. File the deferred gaps

**File**: new change folder via `/10x-new`

**Intent**: Make sure the two known gaps outlive this conversation.

**Contract**: One change covering: an owner field on `AiJob` with a tolerated-missing-field read path for in-flight jobs (`src/lib/ai-jobs.ts:10-16`), and a redundant `.eq("owner_id", …)` on the two FK lookups in `POST /api/contact-events` (`contact-events.ts:43`, `:52-56`). The notes should carry the reason both were deferred — neither breaches the binary privacy NFR, and mixing behaviour changes into a runner bootstrap destroys the meaning of a red test. Also note that page routes remain untested, so a later phase does not assume otherwise.

#### 4. Change and plan sync

**Files**: `context/changes/testing-runner-and-access-boundary/change.md`, this plan

**Intent**: Close out the change record.

**Contract**: `change.md` status advances and `updated` is set. This plan's `## Progress` section carries commit SHAs for every landed step. There is no roadmap item with this Change ID — the phase originates in the test plan, not the roadmap — so no roadmap sync applies.

### Success Criteria:

#### Automated Verification:

- No "TBD — see §3 Phase 1" placeholder remains in `context/foundation/test-plan.md`
- `npm test` passes from a clean checkout with the local stack running
- `npm run lint`, `npx astro check` and `npm run build` all pass

#### Manual Verification:

- A reader who was not part of this work can add a new access-boundary test using §6.2/§6.3 alone, without reading this plan
- The follow-up change folder exists and names both gaps plus the page-route exclusion
- §4's Vitest row records the actual installed version

---

## Testing Strategy

This plan's deliverable _is_ tests, so the strategy is about what the suite must prove rather than how it will be tested.

### Unit / route-layer tests:

- Every route's unauthenticated response, per its real family — not a uniform 401 assumption
- Every id-addressed route's wrong-owner response, with "absent" and "not yours" asserted equal
- Both FK paths in `POST /api/contact-events`
- The four recovery-token branches, vendor error injected

### Integration tests:

- Five tables × {cross-user SELECT, UPDATE, DELETE, forged-owner INSERT, anonymous read, anonymous write}
- Every cross-user mutation paired with a victim-side read
- Cross-user survival of `POST /api/settings/delete-data`
- Opt-in: the cookie→middleware→guard chain and the origin check over real HTTP

### Edge cases explicitly covered:

- Zero rows affected rather than a thrown error (RLS filters, it does not reject)
- 302-redirect routes where there is no JSON body to assert
- A bodiless POST hitting the origin check before routing
- The two job routes, whose module graph reaches `cloudflare:workers`

### Manual Testing Steps:

1. Invert one RLS policy locally; confirm exactly the matching RLS test fails.
2. Remove one route's auth guard; confirm exactly that route's test fails.
3. Remove one route's `.eq("owner_id", …)`; confirm the suite does not stay silently green — if it does, that test is proving RLS, not the route.
4. Run `npm test` with the stack down and with `TEST_BASE_URL` unset; confirm the failure messages name `supabase start` and `TEST_BASE_URL` respectively.

## Performance Considerations

The RLS layer creates and deletes two real users per run. `supabase/config.toml:189` caps `sign_in_sign_ups` at 30 per 5 minutes per IP, so sessions are minted once per suite run and shared across files. Avoid per-test signup — a suite that signs in per test file will start failing on the rate limit as later rollout phases add files. Nothing in this phase drives the real email path, so `email_sent = 2/hour` (`config.toml:182`) is not a constraint.

## Migration Notes

No schema changes and no data migration. The only removal is `scripts/verify-rls.ts` and its npm entry (Phase 2), replaced by strictly greater coverage in `tests/rls/`. The archived change that references the script by name is left untouched — that reference is historical.

## References

- Research: `context/changes/testing-runner-and-access-boundary/research.md`
- Test plan: `context/foundation/test-plan.md` §1–§5 (strategy), §6 (cookbook to fill), §7 (exclusions)
- Lessons: `context/foundation/lessons.md` — the origin-check rule and the "verify config API in node_modules" rule both apply directly
- DB harness prior art: `scripts/verify-rls.ts:36-75`, `:119-127`
- HTTP harness prior art: `scripts/verify-openai-call.ts:62-69`, `:75-88`
- Env mechanism: `node_modules/astro/dist/env/vite-plugin-env.js:83`, `:152-156`; `node_modules/astro/dist/env/env-loader.js:39`
- Cloudflare externalisation: `node_modules/@astrojs/cloudflare/dist/index.js:137-152`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner Bootstrap (probe-first)

#### Automated

- [x] 1.1 `npm test` runs and exits 0
- [x] 1.2 Probe A passes: `createClient` returns non-null, proving `astro:env/server` resolved and `.env.test` supplied both values
- [x] 1.3 Probe B produces a definite outcome (loads, or fails with a recorded reason)
- [x] 1.4 `npm run lint` passes with the new files present
- [x] 1.5 `npx astro check` passes
- [x] 1.6 `npm run build` still passes

#### Manual

- [x] 1.7 The `cloudflare:workers` decision is written into Phase 3's scope note, with the branch taken and why
- [x] 1.8 `.env.test` contains only local-stack values, with a header comment explaining why it is committed
- [ ] 1.9 Both probe files are deleted before Phase 2 starts

### Phase 2: RLS Layer

#### Automated

- [ ] 2.1 `npm test tests/rls` passes with the local stack running
- [ ] 2.2 All five tables have cross-user SELECT, UPDATE, DELETE, forged-owner INSERT, and anonymous read + write assertions
- [ ] 2.3 Each cross-user mutation test includes an independent victim-side read
- [ ] 2.4 `npm run lint` and `npx astro check` pass
- [ ] 2.5 `scripts/verify-rls.ts` no longer exists and `npm run verify:rls` is gone

#### Manual

- [ ] 2.6 Inverting one RLS policy locally makes the corresponding test fail
- [ ] 2.7 No assertion path uses the service-role key
- [ ] 2.8 Teardown leaves no throwaway users behind

### Phase 3: Route Layer

#### Automated

- [ ] 3.1 `npm test tests/routes` passes
- [ ] 3.2 Every route has an unauthenticated assertion matching its real response family
- [ ] 3.3 Every id-addressed route has a wrong-owner assertion plus a victim-side read
- [ ] 3.4 "Nonexistent id" and "someone else's id" responses are asserted equal
- [ ] 3.5 Both FK paths in `POST /api/contact-events` are covered
- [ ] 3.6 The four recovery-token branches pass with the vendor error injected and no live auth call
- [ ] 3.7 `npm run lint` and `npx astro check` pass

#### Manual

- [ ] 3.8 Removing one route's auth guard makes exactly that route's test fail
- [ ] 3.9 Removing one `.eq("owner_id", …)` does not leave the suite silently green
- [ ] 3.10 No test asserts on a Supabase-authored error string

### Phase 4: HTTP Layer (opt-in)

#### Automated

- [ ] 4.1 With `TEST_BASE_URL` set and a server running, `npm test tests/http` passes
- [ ] 4.2 With `TEST_BASE_URL` unset, `npm test` exits 0 and reports the layer as skipped, not failed
- [ ] 4.3 Both cookie jars are minted through `/api/auth/signin`, with no hand-crafted cookie names
- [ ] 4.4 The origin-check test covers JSON, form-encoded and bodiless requests

#### Manual

- [ ] 4.5 Run the layer against a dev server you start yourself; confirm the skip/run switch both ways
- [ ] 4.6 The skip message names `TEST_BASE_URL` clearly enough to act on
- [ ] 4.7 A deliberately wrong `TEST_BASE_URL` fails loudly rather than skipping

### Phase 5: Cookbook and Sync

#### Automated

- [ ] 5.1 No "TBD — see §3 Phase 1" placeholder remains in `context/foundation/test-plan.md`
- [ ] 5.2 `npm test` passes from a clean checkout with the local stack running
- [ ] 5.3 `npm run lint`, `npx astro check` and `npm run build` all pass

#### Manual

- [ ] 5.4 A reader can add a new access-boundary test using §6.2/§6.3 alone
- [ ] 5.5 The follow-up change folder exists and names both gaps plus the page-route exclusion
- [ ] 5.6 §4's Vitest row records the actual installed version
