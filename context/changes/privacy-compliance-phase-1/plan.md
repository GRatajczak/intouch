# Privacy Compliance Phase 1 Implementation Plan

## Overview

InTouch stores personal data about its users and, more sensitively, about third parties (their family and friends), and sends part of it to OpenAI. The audit that preceded this change (GDPR, ePrivacy/PKE art. 399, EDPB Opinion 28/2024, AI Act art. 50) found five technical gaps that a privacy policy cannot paper over. This change closes them so the policy written in Phase 2 describes behaviour the app really has.

The controller is a private individual, OpenAI stays on the current (non-EU) project, Supabase prod is `eu-west-1`, PostHog is Cloud EU. The privacy policy, the terms of service, the footer links and `terms_accepted_at` are separate changes and are **not** in scope here.

## Current State Analysis

- **OpenAI**: `openai.responses.parse(...)` in `src/lib/ranking/run.ts:260` has no `store` field. Per OpenAI's reference, `store` defaults to `true` and stored responses are kept at least 30 days. The prompt (`src/lib/ranking/prompt.ts:79-83`) already sends age, not the birth date, so data minimisation for the birth date is already done.
- **Analytics consent is opt-out and implicit**: `consentFromOptOut` (`src/lib/analytics/consent.ts:15`) treats a missing row as consent; `profiles.analytics_opt_out` defaults to `false`; `applyConsent` (`src/lib/analytics/browser.ts`) opts an anonymous visitor in. `posthog-js` runs with its default persistence (cookie + localStorage). The banner was deliberately dropped on 2026-09-10 (`context/changes/web-analytics-pageviews/change.md:31`); this change reverses that decision.
- **Server events**: `signup_started` is dispatched in `src/pages/api/auth/signup.ts:30-32` with no consent check, because no `profiles` row exists yet.
- **Account deletion is partial**: `POST /api/settings/delete-data` deletes `people`, `rankings`, `profiles` and signs out, but never removes the `auth.users` row, so the e-mail and password hash survive. All owner tables cascade from `auth.users`, so deleting that one row is sufficient.
- **Admin boundary**: `src/lib/supabase-admin.ts` is import-restricted by ESLint to `src/lib/reminders/**`. The repo's pattern for cross-owner or privileged work is a `SECURITY DEFINER` SQL function with `revoke execute` (`reminder_candidates`, `20260908090338_create_reminder_sends.sql:114+`).
- **No retention** on `rankings`, `reminder_sends`, `contact_events`. `REMINDER_COOLDOWN_DAYS = 3` (`src/lib/reminders/select.ts:19`), so `reminder_sends` older than that has no functional use. No migration uses `pg_cron` yet.
- **No data export** exists.
- Existing tests: `tests/routes/delete-data.test.ts` (assumes the account survives), `tests/routes/erasure.test.ts` (person-level erasure, stays valid), `tests/unit/analytics-consent.test.ts`, `tests/routes/analytics-toggle.test.ts`, `tests/routes/people-analytics-consent.test.ts`, `tests/rls/fixture.ts` (service-role fixture that creates/destroys users).

## Desired End State

- No OpenAI request made by the app is stored by OpenAI (`store: false`), and a test pins it.
- Product analytics (browser and server) run only for a visitor or user who explicitly said yes. No consent is read from absence of a row or absence of a choice. A cookie-banner choice is stored in the browser, carried onto the profile, and changeable in Settings.
- One button, "Usuń konto", removes the account entirely: every owner row, the `auth.users` row, and the person in PostHog (best effort). The user is signed out.
- A signed-in user can download everything the app holds about them as one JSON file.
- `reminder_sends` older than 90 days and `rankings` older than 12 months (never the newest per owner) are purged daily by the database itself.

Verification: `npm test`, `npm run lint`, `npm run build` green; manual walkthrough in the Phase 2, 3 and 4 manual checks.

### Key Discoveries:

- `src/lib/ranking/run.ts:260` — the single OpenAI call site; the BYOK client goes through the same call, so one change covers both keys.
- `src/lib/ranking/prompt.ts:79-83` — already minimised: `Wiek`, not `birth_date`.
- `src/components/analytics/AnalyticsScript.astro` — the SDK is not mounted at all for `consent === "denied"`, because muting does not stop the SDK's own `/flags` and config requests. The same two-gate reasoning must hold for "not yet decided".
- `src/middleware.ts:41-67` — the server-side consent verdict (`granted | denied`, anonymous = undefined → `"unknown"`).
- `supabase/migrations/20260908090338_create_reminder_sends.sql` — template for a `SECURITY DEFINER` function with `set search_path = ''` and explicit `revoke`.
- PostHog's documented REST surface (checked via ctx7): `POST /api/projects/:project_id/persons/bulk_delete` accepts `distinct_ids`, `delete_events`; needs a **personal** API key; private API host is `eu.posthog.com` (the ingest host `eu.i.posthog.com` is not it — see `src/lib/analytics/config.ts`).

## What We're NOT Doing

- Privacy policy, terms of service, footer links, signup checkbox, `terms_accepted_at` (Phases 2 and 3 of the wider programme).
- EU data residency for OpenAI (decision: stay on the current project; the transfer is disclosed in the policy instead).
- A "Moje dane" browsing page, CSV/ZIP export, a deletion grace period.
- Blocking special-category data in free-text fields (goes to the terms of service and a form hint later).
- DPAs with OpenAI/Resend/PostHog/Supabase/Cloudflare — human action in each vendor's dashboard.
- New e2e tests (decision: unit + route tests only; the banner is verified manually).
- Removing the old `analytics_opt_out` column (must wait at least one deploy after nothing reads it, per `CLAUDE.md` rollback rules).

## Implementation Approach

Five independent phases, ordered so the cheapest, highest-leverage fix lands first and the broadest UI change is verified before the destructive operations are built:

1. `store: false`.
2. Opt-in consent (migration, server gate, banner, Settings, signup event).
3. Account deletion (SQL function, route, UI, PostHog erasure).
4. Data export.
5. Retention via `pg_cron`.

Every migration is forward-compatible: new columns/functions only, old column kept and kept consistent so a `wrangler rollback` to older Worker code cannot re-enable tracking.

## Critical Implementation Details

- **State sequencing (consent migration)**: the migration must set `analytics_opt_out = true` for every existing profile *and* add `analytics_consent` as nullable. Old Worker code (after a rollback) reads `analytics_opt_out`; if it stayed `false` it would resume tracking without consent. The Settings toggle therefore writes both columns (`analytics_consent = x`, `analytics_opt_out = !x`) until the old column is dropped in a later change.
- **Timing & lifecycle (anonymous consent → profile)**: a visitor has no `profiles` row until profile completion, and `POST /api/settings/analytics` returns 404 without one (`analytics.ts:79`). So the visitor's choice lives in `localStorage`; once a profile row exists and `analytics_consent` is `null`, the client posts the stored choice (retrying harmlessly on later page loads). The banner for a signed-in user shows only while *both* the column and `localStorage` are undecided.
- **Server events after consent**: `signup_started` fires before any profile or consent record can exist, so it is removed from the signup route (catalog and tests updated). The browser `$pageview` of `/auth/confirm-email` (consent-gated) is the replacement funnel step.
- **PostHog erasure is fail-soft and runs first**: it is called before the SQL deletion so a retry after a PostHog failure is safe (a second `bulk_delete` for an absent person is a no-op), and a PostHog outage never blocks the user's right to erasure. Events captured server-side with `$process_person_profile: false` carry only the pseudonymous user id and are removed by `delete_events` only if PostHog links them to the person; this residual must be stated in the policy.
- **Verify the vendor API shape before coding** (lessons.md: "Verify exact config API…"): confirm the `bulk_delete` body (`ids` is documented as required — pass an empty array alongside `distinct_ids`) against a real request in the `verify:analytics`-style script before wiring it.

## Phase 1: Stop OpenAI from storing requests

### Overview

Make every ranking request ephemeral on OpenAI's side.

### Changes Required:

#### 1. The ranking call

**File**: `src/lib/ranking/run.ts`

**Intent**: Tell OpenAI not to retain the response that contains the user's and third parties' details.

**Contract**: `openai.responses.parse({... store: false ...}, { maxRetries: 0 })` — one extra request field on the single call site; applies to both the app key and BYOK keys.

#### 2. Pin it with a test

**File**: `tests/unit/ranking-store-disabled.test.ts` (new), using `tests/stubs/openai-responses-fetch.ts`

**Intent**: Fail if a future edit drops `store: false`.

**Contract**: the request body captured by the stub contains `"store": false` for both key sources (app key and user key).

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npm test -- ranking-store-disabled`
- Whole suite passes: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- `npm run verify:ai-call` still completes against the real API.

**Implementation Note**: pause for manual confirmation before Phase 2.

---

## Phase 2: Opt-in analytics consent

### Overview

Replace implicit consent with an explicit, three-state choice, collected through a banner, mirrored on the profile and editable in Settings. Nothing loads or is sent before "yes".

### Changes Required:

#### 1. Consent column and backfill

**File**: `supabase/migrations/<timestamp>_add_profiles_analytics_consent.sql` (new)

**Intent**: Distinguish "never asked" from "refused", and make a rollback safe.

**Contract**: `alter table public.profiles add column analytics_consent boolean` (nullable, no default; `null` = undecided); `update public.profiles set analytics_opt_out = true`; column comment states the semantics. No RLS/GRANT change (table-level grant already covers new columns, same reasoning as `20260908121419`). Regenerate types: `npm run db:types`.

#### 2. Consent semantics

**Files**: `src/lib/analytics/consent.ts`, `src/middleware.ts`, `src/lib/ranking/run.ts` (consent call), `src/pages/api/people.ts`, `src/pages/api/profile.ts` (their consent reads)

**Intent**: Only `analytics_consent === true` means "send". Absence, `null`, a missing row and a read error all mean "do not send".

**Contract**: `consentFromProfile(analytics_consent: boolean | null | undefined): boolean` replaces `consentFromOptOut`; `hasAnalyticsConsent` and every `consentFromOptOut(profile.analytics_opt_out)` call site switch to it. Middleware verdict becomes `granted | denied | unknown` where a signed-in user with a `null` column resolves to `unknown` (banner), not `granted`.

#### 3. Settings toggle writes both columns

**Files**: `src/pages/api/settings/analytics.ts`, `src/pages/settings.astro`, `src/components/settings/AnalyticsSection/*`

**Intent**: Keep the Settings switch the single place to change one's mind, and keep the legacy column consistent for rollback.

**Contract**: the route writes `{ analytics_consent: enabled, analytics_opt_out: !enabled }`; response `{ enabled }` unchanged. The switch's initial state is `analytics_consent === true`; copy updated to say analytics are off until the user turns them on.

#### 4. Banner and gated SDK load

**Files**: `src/components/analytics/ConsentBanner/{ConsentBanner.tsx,types.ts,index.ts}` (new, per the component-folder lesson), `src/components/analytics/AnalyticsScript.astro`, `src/components/analytics/AnalyticsRuntime.astro`, `src/lib/analytics/browser.ts`, `src/layouts/Layout.astro`

**Intent**: Ask once, remember the answer, and never load `posthog-js` before a "yes".

**Contract**: `localStorage` key holds `granted | denied`; a lightweight loader reads it and only then dynamically imports `startAnalytics`. `consent: "unknown"` no longer mounts the SDK; `applyConsent` opts in only for `"granted"`. The banner offers equal-weight "Akceptuję" / "Odrzucam", is shown for `unknown` verdicts without a stored choice, and on choice (a) writes `localStorage`, (b) if a profile row exists posts to `/api/settings/analytics`. A client step posts a stored choice onto a profile whose column is still `null`.

#### 5. Remove the pre-consent server event

**Files**: `src/pages/api/auth/signup.ts`, `src/lib/analytics/events.ts`, `context/foundation/event-catalog.md`, `tests/unit/analytics-capture.test.ts` (and any test referencing `signup_started`)

**Intent**: No server event may fire before a consent record can exist.

**Contract**: delete the `dispatch(... "signup_started")` call and the event type; update the catalog to name `$pageview` on `/auth/confirm-email` as the funnel's first step.

#### 6. Record the reversed decision

**File**: `context/changes/privacy-compliance-phase-1/change.md` (Notes) — one line that the 2026-09-10 "no banner" decision is superseded, so the next reader of `browser.ts` is not misled; update the stale comment in `browser.ts:applyConsent` and `Layout.astro:66`.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local DB: `npx supabase db reset`
- Types regenerated with no diff afterwards: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Unit tests: `consentFromProfile` truth table (`true`/`false`/`null`/`undefined`), SDK not mounted for `unknown`/`denied` — `npm test -- analytics`
- Route tests: Settings toggle writes both columns; `people-analytics-consent` and `analytics-toggle` tests updated and green — `npm test`
- Type check and lint: `npx astro check && npm run lint`

#### Manual Verification:

- First visit in a clean browser shows the banner; the Network tab shows **no** request to `eu.i.posthog.com` and no PostHog cookie/localStorage entry before "Akceptuję".
- After "Odrzucam", reload: still no PostHog traffic and no banner.
- After "Akceptuję", pageviews appear in PostHog with sanitised URLs (existing guarantees unchanged).
- Sign up → complete profile with a stored choice: the profile's `analytics_consent` matches it; Settings shows the same state.
- An existing account (pre-migration) behaves as undecided/off until it chooses.

**Implementation Note**: pause for manual confirmation before Phase 3.

---

## Phase 3: Real account deletion

### Overview

Replace "delete my data, keep the account" with "delete my account", removing the `auth.users` row, all owner data, and the PostHog person.

### Changes Required:

#### 1. Privileged deletion as a SQL function

**File**: `supabase/migrations/<timestamp>_create_delete_my_account.sql` (new)

**Intent**: Delete the caller's own `auth.users` row without ever putting the service-role client in a request path.

**Contract**: `public.delete_my_account() returns void`, `language sql security definer set search_path = ''`, body deletes from `auth.users` where `id = (select auth.uid())`; `revoke execute ... from public, anon`; `grant execute ... to authenticated`. Cascades remove `profiles`, `people`, `rankings`, `ranking_entries`, `contact_events`, `reminder_sends`. A comment records that this was chosen over widening the ESLint admin allowlist and that the ESLint rule is intentionally unchanged.

#### 2. PostHog erasure helper

**Files**: `src/lib/analytics/erase.ts` (new), `astro.config.mjs` (declare `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` as optional `context: "server", access: "secret"` fields next to `POSTHOG_API_KEY`), `src/env.d.ts` if needed

**Intent**: Erase the user's PostHog person and events; never block deletion on PostHog.

**Contract**: `eraseAnalyticsSubject(distinctId: string): Promise<void>` — returns silently when either secret is missing; otherwise `POST https://eu.posthog.com/api/projects/<id>/persons/bulk_delete` with `{ ids: [], distinct_ids: [distinctId], delete_events: true }`; never throws, logs `[analytics] ...` on non-2xx or fetch failure (same convention as `capture.ts`).

#### 3. The route

**Files**: `src/pages/api/settings/delete-account.ts` (new), remove `src/pages/api/settings/delete-data.ts`

**Intent**: One endpoint that performs the whole erasure in a retry-safe order.

**Contract**: `POST`, 401 when `locals.user` is null; order: `eraseAnalyticsSubject(user.id)` → `supabase.rpc("delete_my_account")` (cookie-bound client, RLS-scoped by `auth.uid()`) → best-effort `supabase.auth.signOut()` ignoring the "user not found" error → `{ success: true }` with the auth cookie headers applied. An RPC error returns 500 and leaves everything in place.

#### 4. The UI

**Files**: `src/components/settings/DeleteAccountSection/{DeleteAccountSection.tsx,types.ts,index.ts}` (replaces `DeleteDataSection`), `src/pages/settings.astro`

**Intent**: One honest destructive control.

**Contract**: button and dialog copy say the account itself is deleted and cannot be restored; success redirects to `/?notice=Twoje konto zostało usunięte`.

#### 5. Tests

**Files**: `tests/routes/delete-account.test.ts` (replaces `delete-data.test.ts`), `tests/unit/analytics-erase.test.ts`

**Intent**: Keep the owner-boundary guarantees the old file proved, and prove the account really goes.

**Contract**: with the RLS fixture — caller B's session with `locals.user` = A deletes only B's `auth.users` row and rows (A untouched), anonymous gets 401, after the call B cannot sign in, and `delete_my_account` is not callable by `anon`. Unit: `eraseAnalyticsSubject` is a no-op without secrets, builds the expected request, swallows failures.

### Success Criteria:

#### Automated Verification:

- Migration applies: `npx supabase db reset`
- Route + RLS tests pass (including cross-owner isolation): `npm test -- delete-account`
- Erase helper unit tests pass: `npm test -- analytics-erase`
- Full suite, types, lint, build: `npm test && npx astro check && npm run lint && npm run build`

#### Manual Verification:

- (Human) set `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` as Workers Secrets and GitHub Secrets; per `CLAUDE.md` this is not an agent operation.
- Delete a throwaway account in a dev/preview build: redirected out, signing in again with the old credentials fails, the user is absent in Supabase Auth, and the person is absent in PostHog.
- With the PostHog secrets removed, deletion still succeeds and logs a skipped erasure.

**Implementation Note**: pause for manual confirmation before Phase 4.

---

## Phase 4: Data export

### Overview

Give a signed-in user a machine-readable copy of everything stored about them (art. 15 and 20).

### Changes Required:

#### 1. Export route

**File**: `src/pages/api/settings/export.ts` (new)

**Intent**: Return one JSON document the user can save.

**Contract**: `POST`, 401 without a user; uses the cookie-bound client (RLS scopes every read). Body: `{ exportedAt, account: { email }, profile, people, rankings: [{..., entries}], contactEvents, reminderSends }` with explicit column lists; **excludes** `openai_api_key_ciphertext`, `openai_api_key_hint` and `openai_api_key_failure_reason` and exposes only `hasOwnOpenAiKey: boolean`. Headers: `Content-Type: application/json`, `Content-Disposition: attachment; filename="intouch-export-<date>.json"`, `Cache-Control: no-store`.

#### 2. Settings control

**Files**: `src/components/settings/ExportDataSection/{ExportDataSection.tsx,types.ts,index.ts}` (new), `src/pages/settings.astro`

**Intent**: A "Pobierz moje dane" button next to the deletion control.

**Contract**: fetches the route and saves the response as a file via a Blob URL; shows an error toast on failure.

#### 3. Tests

**File**: `tests/routes/export.test.ts` (new)

**Intent**: Prove completeness and the owner boundary.

**Contract**: with the RLS fixture — export for B contains B's rows from every table and none of A's; the response contains no key-ciphertext fields; anonymous gets 401.

### Success Criteria:

#### Automated Verification:

- Route tests pass: `npm test -- export`
- Full suite, types, lint: `npm test && npx astro check && npm run lint`

#### Manual Verification:

- Download from Settings; the file opens as valid JSON and contains the account's people, rankings, contact events and reminder sends.
- A user with a saved OpenAI key sees `hasOwnOpenAiKey: true` and no key material.

**Implementation Note**: pause for manual confirmation before Phase 5.

---

## Phase 5: Retention

### Overview

Purge data that has no remaining purpose, inside the database, with no Worker or service-role code.

### Changes Required:

#### 1. Purge function and schedule

**File**: `supabase/migrations/<timestamp>_add_retention_purge.sql` (new)

**Intent**: Enforce the retention periods decided for this change.

**Contract**: `create extension if not exists pg_cron`; `public.purge_expired_records() returns void`, `security definer`, `set search_path = ''`, `revoke execute` from `public, anon, authenticated`; it deletes `reminder_sends` where `sent_at < now() - interval '90 days'`, and `rankings` older than 12 months **except** each owner's newest ranking (`ranking_entries` cascade; `contact_events.ranking_entry_id` is `on delete set null`, so history survives). `contact_events` is deliberately not purged (user history that feeds the ranking; removed with the account) — recorded in a comment. `cron.schedule('purge-expired-records', '0 3 * * *', 'select public.purge_expired_records()')`.

#### 2. Test the function

**File**: `tests/rls/retention-purge.test.ts` (new), using `tests/rls/fixture.ts`

**Intent**: Pin the exact boundaries.

**Contract**: rows 89/90/91 days old for `reminder_sends`; a ranking older than 12 months is kept when it is the owner's only/newest one and deleted when a newer one exists; `contact_events` untouched; the function is not executable by `authenticated`.

### Success Criteria:

#### Automated Verification:

- Migration applies: `npx supabase db reset`
- Boundary tests pass: `npm test -- retention-purge`
- Full suite: `npm test`

#### Manual Verification:

- (Human) confirm `pg_cron` is available on the `InTouchProd` project (Dashboard → Database → Extensions) before applying the migration to production; if not, enable it first.
- After deploy, `select * from cron.job` lists the job and `cron.job_run_details` shows a successful first run.

---

## Testing Strategy

### Unit Tests:

- `store: false` present for app key and BYOK key
- consent truth table; SDK not mounted for `unknown`/`denied`
- `eraseAnalyticsSubject`: no-op without secrets, request shape, never throws

### Integration Tests (route + RLS fixture):

- account deletion: owner boundary, account really removed, `anon` cannot call the function
- export: completeness, no foreign rows, no key material
- retention: 89/90/91-day and newest-ranking boundaries

### Manual Testing Steps:

1. Banner: clean browser → no PostHog traffic until "Akceptuję"; "Odrzucam" persists.
2. Existing account is off until it opts in.
3. Delete a throwaway account end to end, then try to sign in.
4. Export and inspect the JSON.

## Performance Considerations

Deletion adds up to two outbound requests (PostHog) before one RPC — network wait, not CPU, so the Workers free-tier CPU limit noted in `lessons.md` is not at risk. Export reads six tables per request for one user, bounded by the existing 50-person cap and small per-user volumes. The purge runs inside Postgres at 03:00 UTC.

## Migration Notes

All three migrations are additive (new nullable column, two new functions, one cron job). The old `analytics_opt_out` column stays populated and is written alongside the new one; drop it in a later change, at least one deploy after no code reads it. `wrangler rollback` leaves the schema as is: old code reads `analytics_opt_out = true` and tracks nobody.

## References

- Audit and decisions: this conversation (GDPR/ePrivacy/AI Act research, 2026-10-06)
- OpenAI `store` default: https://developers.openai.com/api/reference/resources/responses/methods/create
- Superseded decision: `context/changes/web-analytics-pageviews/change.md:31`
- Pattern for privileged SQL: `supabase/migrations/20260908090338_create_reminder_sends.sql`
- Lessons applied: env via `astro:env/server`; `ON DELETE CASCADE` decided per table; component folders; verify vendor API shape; Workers CPU limits

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Stop OpenAI from storing requests

#### Automated

- [x] 1.1 Unit test passes: `npm test -- ranking-store-disabled`
- [x] 1.2 Whole suite passes: `npm test`
- [x] 1.3 Lint passes: `npm run lint`

#### Manual

- [x] 1.4 `npm run verify:ai-call` still completes against the real API

### Phase 2: Opt-in analytics consent

#### Automated

- [ ] 2.1 Migration applies on a fresh local DB: `npx supabase db reset`
- [ ] 2.2 Types regenerated with no diff afterwards: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- [ ] 2.3 Unit tests for consent truth table and SDK mounting: `npm test -- analytics`
- [ ] 2.4 Route tests (toggle writes both columns, consent gates) pass: `npm test`
- [ ] 2.5 Type check and lint: `npx astro check && npm run lint`

#### Manual

- [ ] 2.6 Clean browser: banner shown, no PostHog request/cookie/localStorage before "Akceptuję"
- [ ] 2.7 After "Odrzucam", reload: no PostHog traffic and no banner
- [ ] 2.8 After "Akceptuję", pageviews arrive in PostHog with sanitised URLs
- [ ] 2.9 Sign up and complete profile: `analytics_consent` matches the stored choice; Settings agrees
- [ ] 2.10 A pre-migration account behaves as off until it chooses

### Phase 3: Real account deletion

#### Automated

- [ ] 3.1 Migration applies: `npx supabase db reset`
- [ ] 3.2 Route and RLS tests pass: `npm test -- delete-account`
- [ ] 3.3 Erase helper unit tests pass: `npm test -- analytics-erase`
- [ ] 3.4 Full suite, types, lint, build: `npm test && npx astro check && npm run lint && npm run build`

#### Manual

- [ ] 3.5 (Human) PostHog secrets set in Workers Secrets and GitHub Secrets
- [ ] 3.6 Deleting a throwaway account removes it from Auth and PostHog, and old credentials no longer work
- [ ] 3.7 With PostHog secrets absent, deletion still succeeds and logs a skipped erasure

### Phase 4: Data export

#### Automated

- [ ] 4.1 Route tests pass: `npm test -- export`
- [ ] 4.2 Full suite, types, lint: `npm test && npx astro check && npm run lint`

#### Manual

- [ ] 4.3 Downloaded file is valid JSON with all of the account's data
- [ ] 4.4 A user with a saved OpenAI key sees `hasOwnOpenAiKey: true` and no key material

### Phase 5: Retention

#### Automated

- [ ] 5.1 Migration applies: `npx supabase db reset`
- [ ] 5.2 Boundary tests pass: `npm test -- retention-purge`
- [ ] 5.3 Full suite: `npm test`

#### Manual

- [ ] 5.4 (Human) `pg_cron` available on `InTouchProd` before applying the migration
- [ ] 5.5 After deploy, `cron.job` lists the job and `cron.job_run_details` shows a successful run
