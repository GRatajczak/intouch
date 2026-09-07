---
date: 2026-09-07T14:40:00+02:00
researcher: g.ratajczak97@gmail.com (Claude Code, Opus 5)
git_commit: 06bee18b515a7e4eaaf732e0606e5a5ede507d52
branch: main
repository: intouch
topic: "Test-plan Phase 1 — Vitest runner bootstrap and the access boundary (risks #1 and #5)"
tags: [research, codebase, testing, vitest, rls, access-control, supabase, astro-env, auth]
status: complete
last_updated: 2026-09-07
last_updated_by: g.ratajczak97@gmail.com (Claude Code, Opus 5)
---

# Research: Test-plan Phase 1 — runner bootstrap and access boundary

**Date**: 2026-09-07 14:40 CEST
**Researcher**: g.ratajczak97@gmail.com (Claude Code, Opus 5)
**Git Commit**: `06bee18` (`06bee18b515a7e4eaaf732e0606e5a5ede507d52`)
**Branch**: `main` — level with `origin/main`, so this commit _is_ pushed. References below are still **local paths**, deliberately: the working tree is dirty and `context/foundation/test-plan.md` — the document that drives this phase — is untracked, so a GitHub permalink to it would resolve to nothing.
**Repository**: `intouch`

## Research Question

`context/foundation/test-plan.md` §3 Phase 1 ("Runner bootstrap and access boundary") wants: _Vitest exists and runs, and neither a second user nor an anonymous caller can reach the first user's data through real routes._ It covers risks #1 (a signed-in user reads or mutates another user's people / rankings / contact events) and #5 (an unauthenticated visitor, or a stale/replayed recovery token, reaches relationship data).

Before planning, this research establishes:

1. What the **oracle** is — what the access boundary _should_ do, sourced from the PRD and test plan, not from the implementation.
2. **Where enforcement actually lives** today — DB policy, route guard, or both (the test plan names this as the thing research must ground for risk #1).
3. What is **already proven** by existing verification scripts, and precisely what is **not**.
4. What it physically takes to boot a Vitest runner in an Astro 6 + Cloudflare Workers + `astro:env/server` repo with zero test infrastructure.

**Scope agreed with the user before research began:**

- **Full data surface** — all 11 authenticated API routes, including `/api/profile`, all three `/api/settings/*`, and `/api/internal/ai-ping`. Not just the three tables risk #1 names.
- **Both faces of risk #5** — session absence/expiry _and_ recovery-token replay/expiry.
- **Page-route guards are out of scope** (the user picked the data surface without the page layer). §"Scope boundary" below records what that leaves unexamined.

## Summary

**The boundary is in better shape than the risk map assumes, and the gaps are not where you would look for them.**

Enforcement is genuinely two-layer and mostly redundant on purpose. Every one of the five owner-scoped tables has a complete SELECT/INSERT/UPDATE/DELETE RLS policy set, all keyed on `(select auth.uid()) = owner_id`. Every data-touching API route carries its own `if (!context.locals.user)` guard, and every id-addressed mutation _also_ filters `.eq("owner_id", ownerId)` in the same query — belt-and-braces over RLS, with in-code comments explaining that this yields 404-never-403 so existence never leaks. No route anywhere uses a privileged client; every query runs as the calling user under RLS.

Five things are genuinely unprotected or unproven:

1. **`rankings` and `ranking_entries` have never been isolation-tested.** `scripts/verify-rls.ts` exercises `people`, `profiles` and `contact_events` only. Risk #1 names "people, **rankings** or contact events" verbatim — two of the three named surfaces have policies but zero proof.
2. **Cross-owner INSERT is proven nowhere.** The existing script only ever inserts a user's _own_ row. `WITH CHECK` — the clause that stops user B writing a row stamped `owner_id: userA` — has never been exercised in the failing direction, on any table.
3. **Anonymous _writes_ are proven nowhere.** Only anonymous SELECT is asserted.
4. **`POST /api/contact-events` is the one place where correctness rests purely on RLS**, with no redundant application-layer owner filter — by design, and the code says so, but untested.
5. **`jobId` has no owner binding at all.** `AiJob` carries no owner field, so job ownership is structurally uncheckable. The blast radius is bounded (a stolen jobId yields a status string or an OpenAI error string; the ranking payload is always re-scoped to the caller), but it is the one deliberate hole on the surface.

**The runner is the harder half of this phase, and it has one specific trap.** `getViteConfig` exists and does wire Astro's env plugin, so `astro:env/server` is resolvable in tests. But in non-build mode Astro **inlines** secret values from `loadEnv(mode, root, "")` at transform time rather than reading them lazily — which means `setGetEnv` from `astro/env/setup`, the obvious-looking escape hatch, is bypassed and silently does nothing. Worse, missing env does not fail loudly: `createClient` returns `null`, and routes degrade to 500/redirect. A misconfigured harness would look like a product bug.

The repo already contains **both halves of the harness** as prior art: `scripts/verify-rls.ts` (two real users at the DB layer, anon key + real JWTs) and `scripts/verify-openai-call.ts` (anonymous-vs-authenticated over real HTTP with a cookie jar minted by the app's own sign-in route). Phase 1 is largely a promotion job, not a from-scratch build.

## The Oracle (sourced, not derived from code)

Per the test plan's oracle rule, expected values must come from sources. These are the sources.

| #   | Oracle statement                                                                                                                                                 | Source                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| O1  | Personal data about the user's close ones "is never visible to any other user" — **binary**, GDPR-adjacent                                                       | `context/foundation/prd.md:121-123` (NFR)                           |
| O2  | "An unauthenticated visitor has no access to any relationship data"                                                                                              | `context/foundation/prd.md:167-168` (`## Access Control`, §162-169) |
| O3  | Flat model: every user "can see and manage only their own circle of close ones"; no roles                                                                        | `context/foundation/prd.md:164-167`                                 |
| O4  | Protection for risk #1 is proven when user B's authenticated request for user A's resource "returns not-found/**forbidden**, **and** the mutation does not land" | `context/foundation/test-plan.md` §2 Risk Response, row #1          |
| O5  | Protection for risk #5 is proven when a request "carrying no session, an expired session, or a reused/expired recovery token receives no relationship data"      | `context/foundation/test-plan.md` §2 Risk Response, row #5          |
| O6  | The vendors themselves are **not** tested — "no test asserts that Supabase auth or Postgres works". Our policies and our validation are fully in scope           | `context/foundation/test-plan.md` §7                                |

Two consequences worth stating before any test is written:

- **O4 permits either 404 or 403.** The repo returns 404 and documents why (`src/pages/api/people/[id].ts:74-75`: _"…updates zero rows -- 404, never 403, leaks nothing about existence"_). Asserting 404 is therefore **oracle-consistent, not implementation-mirroring** — the source allows it and the code picked the stricter of the two permitted answers for a stated reason. This distinction matters because "assert 404 because the code returns 404" would be a vibe test; "assert 404 because O4 permits not-found and the repo deliberately chose the non-leaking option" is not.
- **O4's second clause is the one that bites.** "_and the mutation does not land_" means a status-code assertion alone does not discharge risk #1. Every cross-owner mutation test needs a second, independent read — as the victim — proving the row is untouched. `verify-rls.ts` already does exactly this (`scripts/verify-rls.ts:119-127`); the pattern should be preserved when it is promoted.

## Detailed Findings

### 1. DB layer — RLS is complete on all five tables

All five owner-scoped tables have RLS enabled and a **full** CRUD policy set, every policy keyed on `(select auth.uid()) = owner_id`:

| Table             | RLS on | SELECT   | INSERT   | UPDATE   | DELETE                | FK to `auth.users`                                                                                                                   | Migration                                           |
| ----------------- | ------ | -------- | -------- | -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `people`          | `:13`  | `:15-18` | `:20-23` | `:25-29` | `:31-34`              | `on delete cascade` (`:7`)                                                                                                           | `20260824192356_create_people_table.sql`            |
| `profiles`        | `:15`  | `:17-20` | `:22-25` | `:27-31` | added later ↓         | `on delete cascade`, PK doubles as owner (`:8`)                                                                                      | `20260830101704_add_profiles_and_people_fields.sql` |
| `profiles` DELETE | —      | —        | —        | —        | `:7-10` + grant `:12` | —                                                                                                                                    | `20260904221004_add_profiles_delete_policy.sql`     |
| `rankings`        | `:24`  | `:26-45` | ↑        | ↑        | ↑                     | `on delete cascade` (`:13`)                                                                                                          | `20260901120000_create_rankings_tables.sql`         |
| `ranking_entries` | `:68`  | `:70-89` | ↑        | ↑        | ↑                     | `on delete cascade` (`:53`); `owner_id` denormalized so policies need no join (`:1-9`)                                               | `20260901120000_create_rankings_tables.sql`         |
| `contact_events`  | `:32`  | `:34-53` | ↑        | ↑        | ↑                     | `on delete cascade` (`:20`); `ranking_entry_id` is `on delete set null` (`:22`) so history survives a ranking's lifecycle (`:11-16`) | `20260902184909_create_contact_events_table.sql`    |

Two historical grant gaps are closed and worth knowing only because they change the _failure shape_ a test would see:

- `profiles` had **no DELETE policy and no DELETE grant** from 2026-08-30 until `20260904221004`. Because the _grant_ was missing (not merely the policy), a DELETE in that window failed with Postgres `42501` "permission denied" — an error, not a silent zero-row success. The migration comment says it plainly (`20260904221004_add_profiles_delete_policy.sql:1-3`), and `scripts/verify-rls.ts:189-194` encodes the same distinction.
- `people` was created with policies but no explicit GRANT; retrofitted at `20260830101704_add_profiles_and_people_fields.sql:49-50` (comment at `:33-38`).

The general rule a test must encode: **RLS filters, it does not reject.** A cross-owner UPDATE/DELETE returns success with zero rows affected, not an error. A cross-owner SELECT returns an empty set. Only a missing _grant_ produces `42501`. Asserting "an error was thrown" would fail against correct behaviour.

### 2. Route layer — the middleware does not guard `/api/*`

`src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/profile", "/people", "/settings"]`, matched with `startsWith` at `:20`. **`/api` is not in this list.** The middleware's only job for an API request is to populate `context.locals.user` from `supabase.auth.getUser()` (`src/middleware.ts:12-15`); it never gates one.

Every API guard is therefore self-administered per route. All 11 data-touching routes do carry one — verified individually, none missing:

| Route                             | Auth guard                   | Unauth response                         | Route-level owner filter                                                                | Wrong-owner result                   |
| --------------------------------- | ---------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------ |
| `POST /api/people`                | `people.ts:6-9`              | **302 → `/auth/signin`**                | `owner_id` forced server-side via `toRows(…, user.id)` (`validation/person.ts:140-152`) | n/a (create)                         |
| `PATCH /api/people/[id]`          | `[id].ts:16-18`              | 401 `{"error":"Unauthorized"}`          | `.eq("id",…).eq("owner_id",…)` `:79-80`                                                 | 404 `Nie znaleziono osoby` `:88`     |
| `DELETE /api/people/[id]`         | `[id].ts:95-97`              | 401 `Unauthorized`                      | pre-check `:114-115`, delete `:132-133`                                                 | 404 `:122`, `:141`                   |
| `POST /api/contact-events`        | `contact-events.ts:16-18`    | 401 `Unauthorized`                      | insert forces `owner_id` `:65`; **FK checks rely on RLS alone** — see §3                | 404 `:45`, `:58`                     |
| `GET /api/contact-events`         | `contact-events.ts:84-86`    | 401 `Unauthorized`                      | `.eq("owner_id",…).eq("person_id",…)` `:102-103`                                        | empty array                          |
| `PATCH /api/contact-events/[id]`  | `[id].ts:17-19`              | 401 `Unauthorized`                      | `:56-57`                                                                                | 404 `Nie znaleziono zdarzenia` `:65` |
| `DELETE /api/contact-events/[id]` | `[id].ts:74-76`              | 401 `Unauthorized`                      | `:93`                                                                                   | 404 `:101`                           |
| `POST /api/rankings`              | `rankings.ts:21-23`          | 401 `Unauthorized`                      | owner-scoped `loadLatestRanking` `:40`, `readLatestRankingJobId` `:57`                  | n/a                                  |
| `GET /api/rankings`               | `rankings.ts:85-87`          | 401 `Unauthorized`                      | **no owner check on `jobId`** `:94-101`; ranking re-scoped to caller `:111`             | see §4                               |
| `POST /api/profile`               | `profile.ts:17-19`           | 401 `{"error":"Musisz być zalogowany"}` | `toRow(…, user.id)` `:36`                                                               | n/a                                  |
| `POST /api/settings/delete-data`  | `delete-data.ts:16-18`       | 401 `Musisz być zalogowany`             | `.eq("owner_id", user.id)` ×3 `:27`, `:32`, `:37`                                       | n/a                                  |
| `POST /api/settings/email`        | `email.ts:17-19`             | 401 `Musisz być zalogowany`             | acts on session's own auth user `:34`                                                   | n/a                                  |
| `POST /api/settings/password`     | `password.ts:17-19`          | 401 `Musisz być zalogowany`             | re-verifies via `signInWithPassword` `:36-39` then `updateUser` `:44`                   | n/a                                  |
| `POST/GET /api/internal/ai-ping`  | `ai-ping.ts:45-47`, `:68-70` | 401 `Unauthorized`                      | **no owner check on `jobId`** `:77-82`                                                  | see §4                               |

Every client is built by `createClient(context.request.headers, context.cookies, …)` (`src/lib/supabase.ts:6-30`), which is `createServerClient(SUPABASE_URL, SUPABASE_KEY, …)` — the **anon key plus the caller's own session cookie**. There is no service-role client anywhere in `src/`. (Grep confirms the only `SERVICE_ROLE_KEY` references in the repo are `scripts/verify-rls.ts:8`, `:28`, `:36`, and there only for `auth.admin.createUser` / `deleteUser` — never for table access.)

**Three response families a test must not conflate:**

- 401 `{"error":"Unauthorized"}` — people/[id], contact-events (both), rankings, ai-ping
- 401 `{"error":"Musisz być zalogowany"}` — profile, all three settings routes
- **302 redirect, no JSON, no 401** — `POST /api/people` (`people.ts:8`) and `POST /api/auth/reset-password` (`reset-password.ts:6-8`)

The two redirect routes are where the test plan's own anti-pattern for risk #5 applies directly: _"Asserting the redirect and never asserting the API response body."_ For `POST /api/people` there is no body to assert, so O4's "the mutation does not land" clause must be discharged by a separate read.

### 3. The one place protection rests purely on RLS

`POST /api/contact-events` accepts two client-supplied foreign keys, `personId` and `rankingEntryId` (`src/pages/api/contact-events.ts:37`). The code comments explain the problem exactly (`:39-42`):

> `person_id` is not covered by `contact_events`' own RLS -- its `with check` tests `owner_id` only, and Postgres does not apply RLS when validating a foreign key. Verify the person belongs to this caller through the caller's own RLS-scoped client before inserting.

and again for the second FK (`:48-50`). The mitigation is an existence check through the caller's own RLS-scoped client (`:43`, `:52-56`) — but that check carries **no explicit `.eq("owner_id", ownerId)`**. It relies entirely on `people` / `ranking_entries` SELECT RLS making another owner's row invisible, so the lookup returns `null` and the route 404s.

That RLS does exist and is correct (§1). But this is the single route on the whole surface where the application layer provides no redundancy — and `ranking_entries` is one of the two tables `verify-rls.ts` has never touched. The reasoning is sound and documented; it has simply never been executed against a real second user.

### 4. `jobId` carries no owner, structurally

`src/lib/ai-jobs.ts:10-16` — the `AiJob` interface is `{ status, result?, error?, rankingId? }`. **There is no owner field**, so ownership cannot be checked even if a route tried.

Both pollers read a client-supplied `jobId` straight out of KV with no ownership check:

- `src/pages/api/internal/ai-ping.ts:77-82` returns the job record verbatim.
- `src/pages/api/rankings.ts:94-101` returns the raw job (status, or an OpenAI `error` string) when it is not yet `done`.

The mitigation is real but incidental — `rankings.ts:111` calls `loadLatestRanking(supabase, context.locals.user.id)`, so the _ranking payload_ is always the caller's own regardless of whose job was polled. The comment at `:108-110` states this is deliberate: _"RLS is what actually protects this, same posture as ai-ping.ts not verifying jobId ownership."_

Job ids are `crypto.randomUUID()` (`ai-ping.ts:49`, `rankings.ts:65`) — not enumerable in practice. The owner→job pointer key _is_ predictable (`ranking-latest:${ownerId}`, `src/lib/ai-jobs.ts:32-33`), but it is only ever read with the caller's own id (`rankings.ts:57`).

**Net:** a leaked/guessed `jobId` yields a status string and possibly a provider error message — not relationship data. Against O1/O2 this is not a breach of the binary privacy NFR. It is, however, the one place on the surface with no ownership check at all, and the plan should decide consciously whether Phase 1 pins current behaviour or closes it.

### 5. What `scripts/verify-rls.ts` already proves — and what it does not

The existing script is the right shape and uses the right keys: two throwaway users created via service-role admin API (`:47`, `:51`), then **real `signInWithPassword` sign-ins with the anon key** (`:55-60`), sessions attached to two separate anon-key clients (`:63-73`), plus a bare `anonClient` (`:75`). App tables are touched only through the anon-key clients — never the service-role key. This avoids the test plan's stated anti-pattern ("proving the policy with the same key that wrote the row") outright.

| Assertion                                              | `people`      | `profiles`    | `contact_events` | `rankings` | `ranking_entries` |
| ------------------------------------------------------ | ------------- | ------------- | ---------------- | ---------- | ----------------- |
| Own row insert succeeds                                | ✅ `:92-98`   | ✅ `:151-163` | ✅ `:232-244`    | ❌         | ❌                |
| B cannot SELECT A's row                                | ✅ `:107-110` | ✅            | ✅               | ❌         | ❌                |
| B's UPDATE affects 0 rows                              | ✅ `:112-117` | ✅ `:179-187` | ✅ `:264-272`    | ❌         | ❌                |
| B's DELETE affects 0 rows + victim re-reads row intact | ✅ `:119-127` | ✅ `:195-212` | ✅ `:274-291`    | ❌         | ❌                |
| Anonymous SELECT returns 0 rows                        | ✅ `:129-130` | ✅ `:214-217` | ✅ `:293-294`    | ❌         | ❌                |
| **B INSERTs a row stamped `owner_id: A`**              | ❌            | ❌            | ❌               | ❌         | ❌                |
| **Anonymous INSERT / UPDATE / DELETE**                 | ❌            | ❌            | ❌               | ❌         | ❌                |

Cleanup is via `auth.admin.deleteUser` in a `finally` block (`:295-298`), relying on `ON DELETE CASCADE` from `auth.users`.

The two empty rows at the bottom are the substantive finding. `WITH CHECK` on INSERT is exercised only in the succeeding direction on every table — the failing direction, which is the clause that actually stops a forged `owner_id`, has never run. And no anonymous _write_ is attempted anywhere.

### 6. Recovery token — a narrow contract wrapped around a vendor

Flow (`type=recovery`):

`ForgotPasswordForm.tsx:37` → `POST /api/auth/forgot-password` → `supabase.auth.resetPasswordForEmail(email)` with **no options** (`forgot-password.ts:14`) → link shape comes from the mail template `supabase/templates/recovery.html` (`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`, wired at `supabase/config.toml:234-236`) → `GET /auth/confirm` validates `type ∈ {"recovery","email_change"}` (`confirm.ts:4`, `:23`) → `supabase.auth.verifyOtp({ type, token_hash })` (`confirm.ts:36`) → sets cookies, redirects to `/auth/reset-password` (`confirm.ts:7-10`, `:42`) → `POST /api/auth/reset-password` guards on `context.locals.user` (`:5-9`) → `updateUser({password})` (`:20`) → `signOut({ scope: "others" })` (`:25`).

**The ownership split matters more here than anywhere else**, because of O6:

| Concern                                                                                                                                                 | Owner                                                                                                                            | Testable by us?         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Token issuance, single-use enforcement, replay rejection                                                                                                | Supabase GoTrue                                                                                                                  | **No** — O6 excludes it |
| `otp_expiry = 3600` (`supabase/config.toml:216-217`), `jwt_expiry = 3600` (`:158`), refresh rotation + `refresh_token_reuse_interval = 10` (`:164-167`) | Supabase config                                                                                                                  | **No**                  |
| Calling `verifyOtp` exactly once and branching on its error (`confirm.ts:36-40`)                                                                        | Our code                                                                                                                         | **Yes**                 |
| Rejecting a missing/invalid `type` before any exchange (`confirm.ts:4`, `:23`)                                                                          | Our code                                                                                                                         | **Yes**                 |
| Redirect targets on success and failure (`confirm.ts:7-15`, `:39`, `:42`)                                                                               | Our code                                                                                                                         | **Yes**                 |
| Gating `POST /api/auth/reset-password` on a session (`reset-password.ts:5-9`)                                                                           | Our code                                                                                                                         | **Yes**                 |
| `signOut({scope:"others"})` after a password change (`reset-password.ts:25`)                                                                            | Our code                                                                                                                         | **Yes**                 |
| Cookie flags (httpOnly/secure/sameSite)                                                                                                                 | `@supabase/ssr` defaults — **no override anywhere in this repo** (`src/lib/supabase.ts:12-27` implements only `getAll`/`setAll`) | No                      |

`/auth/confirm` is the **only** token-consuming route — grep for `token_hash`, `verifyOtp`, `exchangeCodeForSession` across `src/` returns only `confirm.ts:19`, `:36` and the token-_producing_ `forgot-password.ts:14`. `exchangeCodeForSession` appears nowhere.

On failure the user gets **no session** and a redirect to `/auth/reset-password?error=<Supabase's raw error.message>` (`confirm.ts:38-40`), rendered via `ServerError` with a "request a new link" link (`reset-password.astro:17-29`). The error text is the vendor's, unsanitised and untranslated — a test must not assert its exact string.

Historically this was verified **manually only**. `context/archive/2026-09-04-password-recovery/plan.md:280` lists the manual step _"attempt the same reset link twice; confirm the second attempt shows the expired-link error"_, and `:332` records a checked-off manual box for direct navigation without a token. There is no automated coverage of replay, expiry, or unauthenticated access to the reset flow.

**Practical consequence for the plan:** the testable half of risk #5's token face is small and cheap — three branches in `confirm.ts` plus one guard in `reset-password.ts`. Genuine replay/expiry is the vendor's, and O6 says don't. The honest Phase-1 assertion is _"our code creates no session and hands back no relationship data when `verifyOtp` returns an error"_, with the error injected rather than obtained by waiting an hour for a real token to expire.

### 7. Runner bootstrap — what is actually installed, and the env trap

Installed (verified in `node_modules`, per the standing lesson to check the installed API rather than trust a snippet):

- `astro` **6.3.1**, `vite` **7.3.3** (satisfies `package.json:71-73` `overrides.vite`)
- **No `vitest`, no `@vitest/*`** — zero test runner
- **No `@cloudflare/vitest-pool-workers`**, no workerd test tooling. `node_modules/@cloudflare/` holds only transitive deps of `@astrojs/cloudflare`
- `getViteConfig` **exists**: exports map `"./config" → "./dist/config/entrypoint.js"`, re-export at `node_modules/astro/dist/config/entrypoint.js:5,32`, implementation `node_modules/astro/dist/config/index.js:4-43`. It runs the real pipeline — `resolveConfig` → `createSettings` → `runHookConfigSetup` → `createRoutesList` → `createVite` (`:36-39`) → `runHookConfigDone`
- `astro/container` **exists** (exports map), if a later phase wants `.astro` rendering
- `astro/app` and `astro/env/setup` also exist in the exports map

**`astro:env/server` is resolvable in tests.** `createVite` registers Astro's env plugin — `node_modules/astro/dist/core/create-vite.js:16` imports `astroEnv`, `:160` registers it. Since `getViteConfig` calls that exact `createVite`, the virtual module is in the plugin set.

**The trap.** `node_modules/astro/dist/env/vite-plugin-env.js:83` passes `loadedEnv: isBuild ? null : loadedEnv`, where `isBuild = command === "build"` (`:23`). Then `:152-156`:

```js
if (loadedEnv) {
  server = server.replace("// @@GET_ENV@@", `return (${JSON.stringify(loadedEnv)})[key];`);
} else {
  server = server.replace("// @@GET_ENV@@", "return _getEnv(key);");
}
```

So under a **build**, server secrets are read lazily through `_getEnv` (default `(key) => process.env[key]`, `node_modules/astro/dist/env/runtime.js:4`) and `setGetEnv` works. Under **any non-build command**, the values are **inlined at transform time** from `loadedEnv` and `_getEnv` is never consulted — meaning **`setGetEnv` from `astro/env/setup` silently does nothing**. That is the obvious-looking answer, and it is a dead end in the mode a test runner uses.

Where `loadedEnv` comes from: `node_modules/astro/dist/env/env-loader.js:39` — `loadEnv(mode, config.vite.envDir ?? root, "")`. The prefix is the **empty string**, and Vite's loader copies every `process.env` key whose name starts with a prefix (`node_modules/vite/dist/node/chunks/config.js:9417`) — with `""`, that is all of them. So `process.env` _is_ a valid source, but only as of the moment the virtual module is transformed, not whenever a test happens to set it.

**Second trap, quieter.** Secrets skip validation entirely unless `validateSecrets` is set (`vite-plugin-env.js:106`), so a missing `SUPABASE_URL`/`SUPABASE_KEY` does not fail config resolution. It surfaces as `createClient` returning `null` (`src/lib/supabase.ts:7-9`), which routes translate into a 500 (`delete-data.ts:24`) or a redirect (`people.ts:20`). **A misconfigured harness therefore looks exactly like a product bug**, and the first red test of Phase 1 could easily be chasing a config error.

Env schema (`astro.config.mjs:32-49`) — all five are `context: "server", access: "secret"`; only the first two are required:

```
SUPABASE_URL           optional: false
SUPABASE_KEY           optional: false
OPENAI_API_KEY         optional: true
RESEND_API_KEY         optional: true
RESEND_TEST_RECIPIENT  optional: true
```

There is **no `.env` and no `.dev.vars.example`** in the repo; `.gitignore:22-27` ignores `.env`, `.env.production` and `.dev.vars`. Note that `.dev.vars` is a Cloudflare mechanism Astro's env loader does not read — the local dev values and the values a test would need do not currently live in the same place.

Other runner facts:

- `tsconfig.json:2-12` — `include: ["**/*"]`, so a `*.test.ts` anywhere is already in the TS project; `paths: {"@/*": ["./src/*"]}` exists but **Vitest does not read tsconfig paths**, so the alias must be mirrored in `resolve.alias`.
- `eslint.config.js:12,78-79` — ignores come from `.gitignore` plus `src/db/database.types.ts` and `.ai/**`. A new test file **will** be linted under `strictTypeChecked` with `projectService: true` (`:15`, `:18`).
- CI (`.github/workflows/ci.yml`): checkout → setup-node (`.nvmrc` = 22.14.0, npm cache) → `npm ci` → `npx astro sync` → `npm run lint` → `npm run build`, with the five secrets injected as env on the sync and build steps (`:20-25`, `:28-33`). **No Supabase service, no docker step.** A `npm test` step slots in after lint; it would need the same env, and integration tests would need a Supabase service CI does not currently have. Per test-plan §5 the suite is not a required gate until Phase 5, so this can stay local-only for now.
- Supabase local stack ports (`supabase/config.toml`): API `54321` (`:9-10`), DB `54322` (`:29`), Studio `54323` (`:91`), Inbucket `54324` (`:99`). `site_url = http://localhost:4321` (`:154`).

### 8. Harness constraints the plan must design around

**a. Astro's origin check runs before routing.** Per `context/foundation/lessons.md` ("A machine POST to `/api/internal/*` must send `Content-Type: application/json`"), an unsafe-method request with a form-like content-type — or **none at all** — is rejected `403 "Cross-site POST form submissions are forbidden"` unless `Origin` matches, and never reaches the route. Sorting the surface by body type:

| Body               | Routes                                                                                                                | Harness requirement                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| JSON               | `contact-events` (POST), `contact-events/[id]` (PATCH), `people/[id]` (PATCH), `rankings` (POST), `ai-ping` (POST)    | `Content-Type: application/json` — skips the check                                |
| form-encoded       | `auth/{signin,signup,forgot-password,reset-password}`, `people` (POST), `profile` (POST), `settings/{email,password}` | explicit `Origin: <baseUrl>` header                                               |
| **no body at all** | `POST /api/settings/delete-data` (reads no body — `delete-data.ts:15-44`)                                             | needs an `Origin` header too; a bare POST carries no content-type and is rejected |

An auth-boundary suite that gets a 403 where it expected 401 is being rejected by CSRF middleware, not by the guard under test — and the two look nothing alike. `scripts/verify-openai-call.ts:60-61` and `:78-79` already carry this knowledge in comments.

**b. Supabase local rate limits** (`supabase/config.toml:180-193`) — `sign_in_sign_ups = 30` per 5 min per IP (`:189`) caps how fast a suite can mint sessions; `email_sent = 2` per hour (`:182`) would throttle any test that drives the real forgot-password email path. `enable_confirmations = false` (`:209`) means a fresh user is usable immediately. `verify-rls.ts` sidesteps the signup limit entirely by creating users through the admin API and only signing in through the public endpoint.

**c. Both harness halves already exist in the repo.**

- `scripts/verify-rls.ts` — two real users, anon key + real JWTs, cross-user read _and_ write assertions, victim re-read, cleanup. Gets config by shelling out to `supabase status -o json` (`:11-14`) and hard-guards that the URL is local (`:30`). Touches no `astro:env/server`.
- `scripts/verify-openai-call.ts` — the HTTP half: anonymous POST/GET expecting 401 (`:62-69`), sign-in through the app's own `/api/auth/signin` with `Origin` set (`:75-80`), harvest `getSetCookie()` into a jar (`:88`), replay with `Cookie:` (`:97-99`). Its comment at `:76-77` explains _why_ it mints cookies through the route rather than hand-crafting the chunked `sb-<ref>-auth-token.0/.1` format — an internal detail that shifts between versions. That reasoning transfers directly to Phase 1's two-user harness.
- Note this script **refuses local URLs** (`:41-47`) because its purpose is exercising Cloudflare's production limits. That is a property of _that_ script's goal, not of the technique.

**d. Executing "real routes" — three candidate shapes, none free.** The phase goal says _through real routes_; the repo does not settle which mechanism that means, so this is a live plan decision:

| Shape                                                                                              | Fidelity                                                                                                                                                                                                     | Cost / catch                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import the route handler and call it with a synthetic `APIContext`                                 | Exercises the route's own guard and owner filters. **Skips middleware entirely**, so `locals.user` is stubbed — the very step that turns a cookie into a user is not under test. Also skips the origin check | Cheapest; needs a hand-built context (`cookies`, `params`, `url`, `locals`)                                                                                                                             |
| Instantiate the built app (`dist/server/` exists; `astro/app` is exported) and hand it a `Request` | Runs middleware + routing + origin check for real                                                                                                                                                            | Requires a build step before tests; the build targets the Cloudflare adapter                                                                                                                            |
| HTTP against a running server, as both verify scripts do                                           | Highest — the whole stack                                                                                                                                                                                    | Needs a server. **The user runs the dev server themselves; this session must not start one** — so a harness that silently assumes `localhost:4321` is up will fail confusingly rather than skip cleanly |

A defensible split, for the plan to weigh: shape 1 for the per-route owner-filter matrix (cheap, many cases), plus a small number of shape 2 or 3 cases to prove the middleware→`locals.user`→guard chain end to end. What must not happen is proving _only_ shape 1 and calling risk #5 discharged — stubbing `locals.user = null` proves the `if`, not the boundary.

## Code References

- `src/middleware.ts:4` — `PROTECTED_ROUTES`; `/api` absent
- `src/middleware.ts:12-15` — the only place `locals.user` is populated
- `src/lib/supabase.ts:6-30` — anon key + caller's cookies; `:7-9` returns `null` on missing env
- `src/pages/api/contact-events.ts:39-42`, `:48-50` — the FK-vs-RLS comments; `:43`, `:52-56` the unfiltered lookups
- `src/pages/api/people/[id].ts:74-75`, `:128` — the 404-never-403 rationale
- `src/pages/api/rankings.ts:94-101` — raw job returned with no owner check; `:108-110` the comment admitting it
- `src/lib/ai-jobs.ts:10-16` — `AiJob` has no owner field; `:32-33` `ranking-latest:${ownerId}` pointer key
- `src/pages/auth/confirm.ts:4`, `:23`, `:36-40`, `:42` — the entire testable token contract
- `src/pages/api/auth/reset-password.ts:5-9`, `:25` — session guard and `signOut({scope:"others"})`
- `scripts/verify-rls.ts:55-75` — the correct two-user client setup; `:119-127` the victim re-read pattern
- `scripts/verify-openai-call.ts:62-69`, `:75-88` — anonymous-401 and cookie-jar patterns
- `supabase/migrations/20260901120000_create_rankings_tables.sql:26-45`, `:70-89` — the untested policy sets
- `node_modules/astro/dist/env/vite-plugin-env.js:83`, `:152-156` — the inline-vs-lazy env branch
- `node_modules/astro/dist/env/env-loader.js:39` — `loadEnv(mode, envDir, "")`
- `astro.config.mjs:32-49` — env schema

## Architecture Insights

- **Defence in depth is the house style, and it is documented in the code.** Route-level `.eq("owner_id", …)` is redundant with RLS on purpose; the comments say why (no existence leak) rather than leaving it to be rediscovered. Tests should assert the _outcome_ (404, zero rows affected, victim's row intact), not which layer produced it — otherwise removing either layer leaves the suite green.
- **RLS filters rather than rejects.** The whole suite's expected-value vocabulary is "zero rows / empty set / 404", not "throws". Only a missing GRANT yields an error (`42501`).
- **The one asymmetry:** every id-addressed _mutation_ has belt-and-braces, but the two FK _lookups_ in `POST /api/contact-events` do not — and one of them targets `ranking_entries`, a table with no isolation proof at all. That intersection is the highest-value single test on the surface.
- **Jobs are the seam where the owner model stops.** KV is the only store in the repo with no `owner_id`, and both pollers are honest about it in comments. It is the natural place for a future owner check, and the reason it has not mattered yet is that the payload is always re-fetched under RLS.
- **`astro:env/server` is a genuine testability tax.** Every runtime config value in `src/` goes through a virtual module whose behaviour differs between build and non-build. Both existing verify scripts avoid it entirely — by shelling out to the Supabase CLI or reading `process.env` — which is why the repo has never had to solve this. Phase 1 is the first code that must import `src/lib/supabase.ts` under a runner.

## Historical Context (from prior changes)

- `context/archive/2026-08-23-per-user-data-isolation/plan.md:202` — _"`scripts/verify-rls.ts` is this change's integration test … against a local Postgres instance"_. The harness shape was decided then; `context/foundation/test-plan.md` §4 now calls it _"the seed to promote, not to keep."_
- `context/archive/2026-08-23-per-user-data-isolation/reviews/impl-review.md` (F3) — `ACCEPTED-AS-RULE: "ON DELETE CASCADE on owner_id is a per-table decision, not an inherited default"`, now in `context/foundation/lessons.md`.
- `context/archive/2026-09-04-password-recovery/change.md:31-35` — `signOut({scope:"others"})` works on the regular authenticated client; no service-role needed.
- `context/archive/2026-09-04-password-recovery/change.md:36-40` — `/auth/confirm` was scoped to `type=recovery` (+ `email_change`) deliberately, _not_ built as a general confirmation endpoint.
- `context/archive/2026-09-04-password-recovery/plan.md:12` — before that change there was no token-exchange route anywhere in the codebase; `/auth/confirm` is net-new.
- `context/archive/2026-09-04-password-recovery/plan.md:280`, `:332` — replay and no-token cases were verified **manually**, and the checkbox is the only record. This is precisely the coverage Phase 1 would replace with something durable.
- `context/changes/person-lifecycle-and-erasure/change.md:28` cites `context/changes/per-user-data-isolation/reviews/impl-review.md:50` — a **stale path**; the file now lives under `context/archive/2026-08-23-per-user-data-isolation/`. Minor, but it will misdirect anyone following the reference.

## Scope boundary (set by the user, recorded so the plan does not assume otherwise)

**Page routes are out of scope for this phase.** They are nonetheless a real read path: `src/pages/dashboard.astro`, `src/pages/profile.astro`, `src/pages/people/index.astro:24` and `src/pages/people/[id].astro:23` all query Supabase directly, each scoped by `.eq("owner_id", user.id)`, guarded only by the middleware's `PROTECTED_ROUTES`. `src/pages/people/[id].astro:21` carries the same "foreign or missing id redirect identically" reasoning as the API routes. So risk #1's coverage after Phase 1 will be _API-complete, page-untested_ — worth naming explicitly in the plan rather than discovering at Phase 5.

## Open Questions

1. **Which "real routes" execution shape?** (§8d.) This is the largest single design decision in the phase, and it decides whether the middleware→`locals.user`→guard chain is under test or assumed. Constrained by the standing rule that the user runs the dev server, not the agent.
2. **Does Vitest resolve Vite with `command !== "build"`?** Everything in §7 turns on this. Expected yes (Vitest uses a serve-mode pipeline), which means inlined env and a dead `setGetEnv`. **This is the first thing to verify empirically once Vitest is installed** — one throwaway test that imports `astro:env/server` and logs a value settles it, and getting it wrong sends the whole phase chasing a phantom config bug (§7, second trap).
3. **Does Phase 1 close the gaps it found, or only pin current behaviour?** Specifically: an owner field on `AiJob`, and/or a redundant `.eq("owner_id", …)` on the two FK lookups in `POST /api/contact-events`. Both are small changes. The test plan says research is ground truth when it disagrees with the plan — but turning a test phase into a code-change phase is a scope call for the user, not for the planner.
4. **Where do test env values live?** There is no `.env` and no `.dev.vars.example`; local dev values sit in `.dev.vars`, which Astro's env loader does not read. A committed `.env.test` with local-stack-only values, or exporting into the shell, or generating from `supabase status` the way `verify-rls.ts` does — all viable, all with different CI consequences later (§7).
5. **How much of `/api/settings/*` belongs in Phase 1 versus Phase 2?** `POST /api/settings/delete-data` is on the agreed surface and is the most destructive route in the repo, but its _completeness_ ("no row in any table still references the person") is explicitly Phase 2's risk #2. The natural split is: Phase 1 proves nobody else can invoke it; Phase 2 proves it finishes the job. Worth stating so neither phase assumes the other covered it.
6. **Do the promoted tests replace `scripts/verify-rls.ts`, or sit beside it?** §4 of the test plan says "promote, not keep", but the script is wired as `npm run verify:rls` and is referenced from the archive. Deleting it, keeping it as a smoke check, or leaving it until Phase 5 are all defensible.
