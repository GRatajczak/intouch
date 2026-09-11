# Bring-your-own OpenAI key + a daily cap on manual recomputes — Implementation Plan

## Overview

A user pastes their own OpenAI API key into `/settings`. It is stored as AES-GCM ciphertext
on their `profiles` row and used for every model call made on their behalf, in the request
path and in the cron sweep alike. A user without a key keeps the free tier: the automatic
24-hour refresh stays unlimited, and the manual "Przelicz teraz" button is allowed once per
calendar day in `Europe/Warsaw`.

This unparks **"User-supplied OpenAI API key (bring your own key)"** from
`context/foundation/roadmap.md` §Parked → Other, as slice **S-17**.

## Current State Analysis

- `src/lib/openai.ts:4` is a seven-line factory with no parameters. It reads a module-level
  `OPENAI_API_KEY` that Astro's env plugin inlines at transform time, so there is no
  per-request key anywhere in the system.
- Exactly two callers reach it: `runRanking` (`src/lib/ranking/run.ts:138`) and `runPing`
  (`src/pages/api/internal/ai-ping.ts:23`). Two dispatchers feed the first: the request route
  (`src/pages/api/rankings.ts:69`) and the cron sweep's injected `refreshRanking`
  (`src/lib/reminders/run-sweep.ts:44`).
- `POST /api/rankings` already distinguishes the two triggers: `force: true` from the button,
  `force` absent from the stale-on-mount effect (`src/pages/api/rankings.ts:31-39`,
  `src/components/hierarchy/HierarchyView/HierarchyView.tsx:196-201`). Without `force`, a
  ranking younger than `STALE_AFTER_MS` short-circuits with `{ jobId: null, reason: "fresh" }`.
- `POST /api/settings/delete-data` erases `people`, `rankings` and `profiles` by hand, with no
  registry behind it. A column on `profiles` is therefore erased for free; a new table would
  not be, and would inherit the hole `reminder_sends` already sits in.
- KV is unusable for a quota. `src/pages/api/rankings.ts:50-56` records that KV has no
  compare-and-swap, and reads are stale for up to 60 seconds, so a counter would fail open.
- The app has one notion of a day: `APP_TIME_ZONE = "Europe/Warsaw"` (`src/lib/dates.ts:14`),
  mirrored in SQL by `reminder_candidates`.
- There is no cryptography anywhere in this repo, no masked-secret UI, and no sanctioned way
  to stub OpenAI in tests. All three are established by this change.

Full grounding: `context/changes/byok-openai-key/research.md`.

## Desired End State

A signed-in user opens `/settings`, sees a "Klucz OpenAI" section, pastes a key, and gets a
success toast plus a masked confirmation such as `sk-…4f2a`. From that moment every ranking
computed for them, including the one behind their reminder emails, is billed to their key, and
"Przelicz teraz" has no cap.

A user with no key clicks "Przelicz teraz" a second time on the same day and gets a calm
message telling them the daily recompute is used up and that adding their own key removes the
limit. Their automatic daily refresh is untouched. Removing a stored key from `/settings`
puts them back on the free tier immediately.

Verified by: the automated criteria in each phase, plus a manual pass adding a real key,
watching `wrangler tail` show the run, and confirming the second same-day manual recompute
is refused for a key-less account.

### Key Discoveries

- `runRanking` already loads the whole profile row (`src/lib/ranking/run.ts:143`,
  `select("*")`), so the ciphertext arrives with no extra round trip. The client is currently
  built *before* that load, which is the one ordering that has to change.
- `SweepDeps.refreshRanking` (`src/lib/reminders/sweep.ts:28`) is an injection seam, so the
  cron path adopts per-owner keys by changing only the wiring in `run-sweep.ts:44`. The
  sweep's decision logic is untouched.
- `POST /api/rankings` already returns a `reason` discriminator, so the refusal fits the
  existing wire contract as `{ jobId: null, reason: "daily_limit" }` rather than a new shape.
- `openai@7.8.0` exports `AuthenticationError` (401) and `RateLimitError` (429) as distinct
  classes, and the client accepts a `fetch` option, which is what makes a network-edge test
  stub possible.
- `eslint.config.js:104-115` confines `@/lib/supabase-admin` to `src/lib/reminders/**`, so the
  key loader must take a client as an argument rather than building one.

## What We're NOT Doing

- **No rotation tooling.** The ciphertext carries a `v1:` prefix so a future rotation is
  possible without a format migration, but no re-encryption script, no dual-key read path, and
  no rotation runbook ship here.
- **No key for `/api/internal/ai-ping`.** It is a diagnostic route with no owner in scope
  (`src/pages/api/internal/ai-ping.ts:20`); it stays on the app key deliberately.
- **No cap on the automatic refresh.** `STALE_AFTER_MS` keeps its own rolling 24-hour clock and
  is not counted.
- **No billing, no usage metering, no spend display.** The counter answers one question: has
  this owner spent today's manual recompute.
- **No new analytics event.** F-06's funnel keeps its five events.
- **No fallback to the app key when a user's key is rejected.** That is the whole point of
  the gate; see Critical Implementation Details.
- **No second key provider and no per-provider table.** Columns on `profiles`, not a new table.

## Implementation Approach

Three seams, in dependency order.

**Storage.** Nullable, additive columns on `profiles`, following
`supabase/migrations/20260908121419_add_profiles_analytics_opt_out.sql` exactly. Ciphertext,
a plaintext four-character hint for the mask, and the claim date. A separate `src/lib/crypto/`
module owns AES-GCM through WebCrypto, returning null when its secret is absent, mirroring
every other factory in `src/lib/`.

**Threading.** `createOpenAIClient` gains an optional key argument. A small loader turns a
profile row into either the owner's decrypted key or a signal to use the app key. `runRanking`
resolves the key from the row it already loads; `run-sweep.ts` does the same through the
admin client it already holds.

**Gating.** The route claims the day with a single guarded `UPDATE … RETURNING` against the
owner's own RLS-scoped client. The row lock is the compare-and-swap the repo said KV lacks,
and the date comes from `src/lib/dates.ts`, so there is still exactly one notion of a day.

## Critical Implementation Details

**Ordering inside `runRanking`.** The client is built at `run.ts:138`, before the profile is
loaded at `:143`. That order has to invert: load the profile first, resolve the key from it,
then build the client. The existing "No profile found for this account" throw at `:150` must
keep firing before any OpenAI call is attempted.

**The two failure directions are deliberately asymmetric.** A *decryption* failure is our
fault, so the run silently falls back to the app key and the free tier, and the settings page
shows the key as unreadable. A *rejection by OpenAI* is the user's key being bad, so the run
fails outright with no fallback. Collapsing these into one behaviour would turn a deliberately
bad key into an unlimited free tier billed to the app, which is the exact cost control the
roadmap's parked entry and the PRD's FR-001 rationale exist to protect.

**Claim after the in-flight guard, before dispatch.** `src/pages/api/rankings.ts:57-63`
returns an already-running job's id instead of starting a second run. Claiming the day before
that check would let a double click burn the free run for a job that was never dispatched.

**Never log or echo the key.** `runRanking`'s catch writes `err.message` into the KV job and
into `console.error` (`run.ts:191-194`), and that string reaches the browser through
`GET /api/rankings`. The OpenAI SDK does not put the key in its error messages, but any
message this change constructs must not either, and the settings route must never return the
plaintext or the ciphertext in a response body.

---

## Phase 1: Schema and the crypto seam

### Overview

The columns and the encryption module land with nothing reading them yet, so the phase is
independently deployable and fully unit-testable.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_add_profiles_openai_key.sql`

**Intent**: Give `profiles` somewhere to hold a user's encrypted key, the mask hint the
settings page renders without decrypting, and the day the free recompute was last claimed.

**Contract**: Three nullable columns on `public.profiles`:
`openai_api_key_ciphertext text`, `openai_api_key_hint text`, `free_recompute_claimed_on date`.
All nullable with no default, so the migration is additive and a rolled-back Worker leaves them
unread. `comment on column` for each, stating what it holds, who writes it and who reads it.
Header comment must state forward-compatibility per CLAUDE.md §Rollback and record that no RLS
or GRANT change is needed, because policies on `profiles` are row-level and the table-level
grant from `20260830101704_add_profiles_and_people_fields.sql:39-40` covers new columns. The
hint column must carry a comment saying it is deliberately plaintext and deliberately only the
last four characters.

#### 2. Regenerated types

**File**: `src/db/database.types.ts`

**Intent**: Keep the generated types in step with the schema.

**Contract**: Output of `npm run db:types` against the local stack. No hand edits.

#### 3. The encryption secret

**File**: `astro.config.mjs`

**Intent**: Register the key-encryption secret alongside the other optional secrets.

**Contract**: `OPENAI_KEY_ENCRYPTION_KEY: envField.string({ context: "server", access: "secret", optional: true })`, with a comment matching the house pattern at `:36-40`: optional so a
missing secret disables one feature rather than failing the Worker. The comment must also state
the expected value shape, a base64-encoded 32-byte random value, and that it is deliberately
**not** registered in `src/lib/config-status.ts` for the reason recorded at
`src/lib/analytics/config.ts:31-36`.

#### 4. Secret plumbing

**Files**: `.env.example`, `.dev.vars`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Intent**: Make the new secret available everywhere the existing eight already are.

**Contract**: One line in `.env.example` and `.dev.vars`; four additions across the two
workflows, at the `astro sync` and `build` steps in each (`ci.yml:23,34`, `deploy.yml:27,38`).
Workers Secrets and GitHub Secrets are human steps, listed under Manual Verification.

#### 5. The crypto module

**File**: `src/lib/crypto/api-key.ts`

**Intent**: Encrypt and decrypt a user-supplied credential with AES-GCM through WebCrypto, in
a versioned envelope so the encryption key can be rotated later without a format migration.

**Contract**: Two functions returning promises. `encryptApiKey(plaintext: string): Promise<string | null>` returns the stored envelope, or null when the secret is absent.
`decryptApiKey(envelope: string): Promise<string | null>` returns the plaintext, or null when
the secret is absent, when the envelope's version is unknown, or when decryption fails for any
reason. Neither throws, mirroring the null-returning factories in `src/lib/`.

Envelope format, which other phases depend on: `v1:<base64url iv>:<base64url ciphertext>`, a
fresh 12-byte random IV per encryption. The secret is base64-decoded to 32 raw bytes and
imported with `crypto.subtle.importKey("raw", …, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])`. A malformed secret is treated as an absent one.

#### 6. Unit tests

**File**: `tests/unit/api-key-crypto.test.ts`

**Intent**: Pin the envelope contract and every non-throwing failure path.

**Contract**: Round-trip returns the original plaintext; two encryptions of the same input
differ, proving the IV is per-call; a mangled envelope, an unknown version prefix, and a
ciphertext encrypted under a different key each return null rather than throwing. The test key
comes from `.env.test`, never from a hosted project.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against the local stack: `npx supabase db reset`
- Generated types include the three new columns: `npm run db:types` leaves a non-empty diff on first run and a clean tree on the second
- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- `npx wrangler secret put OPENAI_KEY_ENCRYPTION_KEY` run against production with a value from `openssl rand -base64 32`, piped via `printf` rather than pasted interactively, per `context/deployment/deploy-plan.md:39-40`
- The same value added to GitHub Secrets
- `npx wrangler secret list` shows the name present

**Implementation Note**: pause here for manual confirmation before Phase 2.

---

## Phase 2: The owner's key reaches the model

### Overview

Both dispatchers resolve a per-owner key and pass it down. BYOK works end to end after this
phase; there is still no way to enter a key and no limit.

### Changes Required:

#### 1. The client factory

**File**: `src/lib/openai.ts`

**Intent**: Let a caller supply a key while keeping today's behaviour for callers that do not.

**Contract**: `createOpenAIClient(apiKey?: string)` returns a client built from `apiKey` when
one is given, otherwise from `OPENAI_API_KEY`, otherwise null. The existing two-line body's
null contract is unchanged.

#### 2. The key resolver

**File**: `src/lib/openai-key.ts`

**Intent**: Turn a loaded profile row into a decision about whose key pays, without importing
a Supabase client of its own.

**Contract**: `resolveOwnerKey(profile: Pick<Tables<"profiles">, "openai_api_key_ciphertext">): Promise<OwnerKey>` where
`OwnerKey` is `{ source: "user"; apiKey: string } | { source: "app" } | { source: "app"; unreadable: true }`.
No ciphertext means `app`. Ciphertext that decrypts means `user`. Ciphertext that fails to
decrypt means `app` with `unreadable` set, which is what Phase 3's settings page surfaces. A
second export, `hasUsableOwnerKey`, is what Phase 4's gate calls.

#### 3. Ranking run

**File**: `src/lib/ranking/run.ts`

**Intent**: Bill the run to the owner's key when they have one, and fail loudly rather than
silently falling back when OpenAI rejects it.

**Contract**: Move the profile load above the client construction, resolve the key from the
loaded row, and pass it to `createOpenAIClient`. Classify the failure in the existing catch:
an `AuthenticationError` or `RateLimitError` raised while `source === "user"` writes a job
error naming which of the two it was, in Polish, and never quotes the key. The
`"OPENAI_API_KEY is not configured"` throw stays for the app-key path. The completion log line
gains the key source so `wrangler tail` shows whose key paid.

#### 4. Cron wiring

**File**: `src/lib/reminders/run-sweep.ts`

**Intent**: Give the sweep the same behaviour without touching its decision logic.

**Contract**: Unchanged signature. `refreshRanking` still delegates to `runRanking`, which now
resolves the key from the profile row it loads through the admin client it is already handed.
No new import of `supabase-admin` anywhere, and no change to `src/lib/reminders/sweep.ts`.

#### 5. Tests

**File**: `tests/unit/ranking-key-source.test.ts`

**Intent**: Prove the branch we take on each failure, without asserting on a vendor string.

**Contract**: A stub `fetch` handed to the OpenAI client returns a 401 body, then a 429 body,
then a success body. Assertions: a user-key 401 produces a failed job whose error names the
rejected key rather than a quota; a user-key 429 names the quota; neither triggers a second
call, proving no fallback; an owner with no ciphertext calls with the app key. This file is the
network-edge stubbing precedent the test plan's Phase 3 was going to set, and a header comment
must say so.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- No new import of `@/lib/supabase-admin` outside `src/lib/reminders/**`: `npm run lint` (enforced by `eslint.config.js:104-115`)

#### Manual Verification:

- With a row's ciphertext set by hand to a real key encrypted locally, a recompute succeeds and `wrangler tail` shows the run attributed to the user key
- With that ciphertext replaced by an encrypted but invalid key, the job reaches `failed` and the dashboard shows the failure banner rather than a silently app-billed success

**Implementation Note**: pause here for manual confirmation before Phase 3.

---

## Phase 3: The settings section

### Overview

The user can add, replace and remove a key. This lands before the limit so that at no commit
boundary does a cap exist without an escape from it.

### Changes Required:

#### 1. Validation schema

**File**: `src/lib/validation/settings.ts`

**Intent**: Validate the submitted key's shape before spending a network call on it.

**Contract**: `openAiKeySchema` on a JSON body `{ apiKey: string }`, trimmed, non-empty,
prefixed `sk-`, with a plausible minimum length and a Polish message per issue, following
`remindersToggleSchema` at `:46-50`.

#### 2. The route

**File**: `src/pages/api/settings/openai-key.ts`

**Intent**: Store an encrypted key, or remove a stored one.

**Contract**: `POST` saves; `DELETE` clears. Both follow `src/pages/api/settings/reminders.ts`
exactly: auth guard before any client work, 401 `{ error: "Musisz być zalogowany" }`, JSON body
in try/catch, Zod `safeParse`, the cookie-bound client from `@/lib/supabase`, an explicit
`.eq("owner_id", user.id)`, and `.select().maybeSingle()` so a zero-row update answers 404
rather than 200.

`POST` additionally validates the key against OpenAI with one `client.models.list()` call
before writing. An `AuthenticationError` answers 400 with a message saying OpenAI rejected the
key; any other failure answers 502 with a message saying the key could not be verified right
now. On success it writes ciphertext plus the last four characters as the hint and returns
`{ hint }` — never the key, never the ciphertext. When `encryptApiKey` returns null, meaning the
secret is missing, the route answers 503 and writes nothing.

`DELETE` nulls both columns and returns `{ hint: null }`.

#### 3. The section component

**Files**: `src/components/settings/ApiKeySection/{ApiKeySection.tsx,types.ts,index.ts}`

**Intent**: One card that states the deal, shows what is stored, and lets the user replace or
remove it.

**Contract**: Default export, props `{ hint: string | null; unreadable: boolean }`, barrel and
types file per `context/foundation/lessons.md`. Follows `RemindersSection`'s save conventions:
re-entrancy guard, the shared error-unwrapping block, `showToast` on both outcomes, `disabled`
while saving. The input copies `src/components/auth/FormField.tsx` because it is the only field
with an `endContent` slot, paired with `PasswordToggle` as at
`PasswordChangeForm.tsx:82-101`, plus `autoComplete="off"`.

With no key stored it renders the input and a line saying the free tier allows one manual
recompute per day. With a key stored it renders `sk-…<hint>` and a remove button. When
`unreadable` is true it says the stored key can no longer be read and asks for it again. Remove
uses the `AlertDialog` shape from `DeleteDataSection`, including the documented trap: the
confirm control is a plain `Button`, never `AlertDialogAction`, so a failed request does not
dismiss the dialog.

#### 4. Page wiring

**File**: `src/pages/settings.astro`

**Intent**: Render the section with server-loaded state.

**Contract**: Extend the existing single profile query at `:24-31` to also select
`openai_api_key_ciphertext, openai_api_key_hint`; derive `hint` and `unreadable` from them via
`resolveOwnerKey`; render a new `<section>` titled "Klucz OpenAI" between "Przypomnienia" and
"Prywatność", matching the surrounding card markup.

#### 5. Route tests

**File**: `tests/routes/openai-key.test.ts`

**Intent**: The cookbook triad, with the mismatch instrument.

**Contract**: Anonymous caller gets 401 with no client built; a malformed body gets 400 and
leaves the stored value untouched; a valid save writes ciphertext that decrypts back to the
submitted key and a hint equal to its last four characters; a missing profile row gets 404, not
200; a cross-owner call with A's client and B's `locals.user` writes nothing to either row.
OpenAI validation is stubbed at the network edge, reusing Phase 2's helper. The cross-owner
test must be verified by deleting the route's owner filter and confirming it goes red.

**File**: `tests/routes/unauthenticated.test.ts`

**Contract**: Register both new handlers in the hand-maintained list at `:20-31`.

### Success Criteria:

#### Automated Verification:

- Route tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- The cross-owner test goes red when the route's `.eq("owner_id", …)` is deleted

#### Manual Verification:

- Pasting a real key shows a success toast and the masked value; reloading `/settings` still shows it
- Pasting a syntactically valid but wrong key shows the rejection message and stores nothing
- Removing the key returns the section to its empty state
- The section reads correctly on a narrow viewport

**Implementation Note**: pause here for manual confirmation before Phase 4.

---

## Phase 4: The daily gate

### Overview

Manual recompute becomes once-per-calendar-day for owners without a usable key.

### Changes Required:

#### 1. The day helper

**File**: `src/lib/dates.ts`

**Intent**: Give the claim a calendar date in the app's one time zone, reusing the formatter
that already exists there.

**Contract**: `appCalendarDate(at: Date = new Date()): string` returning `YYYY-MM-DD` in
`APP_TIME_ZONE`, built on the existing `en-CA` formatter at `:16-24`. A comment must tie it to
the same rule `reminder_candidates` encodes in SQL, and note that this is a different clock
from `STALE_AFTER_MS` on purpose.

#### 2. The claim

**File**: `src/lib/ranking/free-tier.ts`

**Intent**: Spend today's free recompute atomically, or report that it is already spent.

**Contract**: `claimFreeRecompute(supabase, ownerId): Promise<"claimed" | "spent" | "no-profile">`.
One guarded statement: update `profiles` setting `free_recompute_claimed_on` to today's app
calendar date where the owner matches and the stored date is null or earlier than today,
returning the row. A returned row means claimed; no row with an existing profile means spent.
The row lock is what makes this a real compare-and-swap, and a comment must say so with a
pointer to the KV limitation recorded at `src/pages/api/rankings.ts:50-56`.

#### 3. The gate

**File**: `src/pages/api/rankings.ts`

**Intent**: Refuse a second same-day manual recompute for an owner on the free tier.

**Contract**: Only when `force === true`. Placed after the in-flight guard at `:57-63` and
before the dispatch at `:65-69`, so a duplicate click reuses the running job without spending
the claim. Skipped entirely when `hasUsableOwnerKey` is true for the owner. On `"spent"` the
route answers **429** with `{ jobId: null, reason: "daily_limit", error: <Polish message> }`,
extending the existing `reason` discriminator rather than inventing a shape.

#### 4. The view

**Files**: `src/components/hierarchy/HierarchyView/HierarchyView.tsx`, `src/components/hierarchy/RefreshBanner/{RefreshBanner.tsx,types.ts}`

**Intent**: Say what happened and where to remove the limit, without looking like a failure.

**Contract**: `Status` gains `"limited"`; `dispatchRefresh` sets it when the response carries
`reason: "daily_limit"`, before its `jobId` check. `RefreshBannerStatus` gains the same member,
rendering a calm line saying today's recompute is used up and linking to `/settings` to add a
key, with the button disabled. It is not the destructive `failed` styling, and a stored ranking
stays visible beneath it.

#### 5. Tests

**File**: `tests/routes/free-tier-limit.test.ts`

**Contract**: A key-less owner's first `force` dispatches and the second answers 429 with
`reason: "daily_limit"`; a non-forced call is never gated, even after the claim is spent; an
owner whose ciphertext decrypts is never gated; a claim dated yesterday is claimable today,
and one dated today is not, with the boundary expressed in `Europe/Warsaw`; the claim is not
spent when the in-flight guard returns an existing job. Cross-owner: claiming for A must not
touch B's date, verified by deleting the owner filter.

### Success Criteria:

#### Automated Verification:

- Route tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- The cross-owner claim test goes red when the claim's owner filter is deleted

#### Manual Verification:

- On a key-less account, "Przelicz teraz" works once and the second attempt shows the limit message with the ranking still on screen
- Reloading the dashboard after the limit is hit still triggers the free automatic refresh path, not the limit
- On an account with a stored key, repeated manual recomputes are never refused

**Implementation Note**: pause here for manual confirmation before Phase 5.

---

## Phase 5: Marking a key that stopped working

### Overview

A key that was valid at save time can be revoked or run out of quota later, inside a background
job nobody is watching. This phase makes that visible in `/settings`. It is the agreed first
thing to cut if the change has to shrink.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_add_profiles_openai_key_health.sql`

**Contract**: Two nullable columns on `public.profiles`: `openai_api_key_failed_at timestamptz`
and `openai_api_key_failure_reason text`. Additive, no default, `comment on column` each, same
header conventions as Phase 1. The reason column holds `auth` or `quota` and its comment must
say the values are written only by the ranking run.

#### 2. Writing the health signal

**File**: `src/lib/ranking/run.ts`

**Intent**: Record which of the two rejections happened, and clear it on the next success.

**Contract**: In the catch, when the run used a user key and the error is an
`AuthenticationError` or `RateLimitError`, write the timestamp and the reason to the owner's
row. On a successful run with a user key, clear both. The write must never stop the job
reaching its terminal state, mirroring how the analytics capture at `:196-210` sits after
`writeJob`.

#### 3. Surfacing it

**Files**: `src/pages/settings.astro`, `src/components/settings/ApiKeySection/*`

**Contract**: Select the two columns alongside the hint; pass a `failure` prop to the section;
render a distinct line for a rejected key and for an exhausted quota, each telling the user
what to do. Saving a new key clears the state, because the route already overwrites the row.

#### 4. Tests

**File**: `tests/unit/ranking-key-source.test.ts`

**Contract**: Extend Phase 2's file: a user-key 401 writes reason `auth`, a 429 writes `quota`,
and a successful run clears both.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Types regenerate clean: `npm run db:types`
- Tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- With a stored key revoked at OpenAI, one recompute marks it and `/settings` says the key was rejected
- Saving a working key clears the warning

**Implementation Note**: pause here for manual confirmation before Phase 6.

---

## Phase 6: Documents, roadmap and tracker

### Overview

The repo's own records catch up. No application code changes here.

### Changes Required:

#### 1. Roadmap

**File**: `context/foundation/roadmap.md`

**Contract**: Five edits. Add an `S-17` row to `## At a glance` after `S-11`; add the slice to
the relevant `## Streams` entry; add a `### S-17:` section after `### S-11` using the fixed
field order the neighbouring sections use; add the row to `## Backlog Handoff`; and remove the
"User-supplied OpenAI API key" bullet from `## Parked` § Other. Bump the frontmatter `updated`.
`S-12` through `S-16` are reserved in the tracker, which is why this is `S-17`.

#### 2. Tracker mirror

**File**: `context/foundation/github-issues-roadmap.md`

**Contract**: One row for `S-17` in the post-migration section, matching the shape of the six
parked rows already there.

#### 3. PRD amendment

**File**: `context/foundation/prd.md`

**Contract**: An inline dated `> Amended 2026-09-10 …` note under FR-001, in the same style as
the two existing amendments on FR-002, recording that cost control now has a second mechanism:
mandatory login still gates access, and a user's own key removes the cap for that user. The
requirement text itself does not change.

#### 4. Lesson

**File**: `context/foundation/lessons.md`

**Contract**: One appended entry in the established Context/Problem/Rule/Applies-to shape,
covering the first cryptographic secret in this repo: the versioned envelope, the asymmetry
between a decryption failure and a provider rejection, and the fact that a rolled-back Worker
leaves unreadable ciphertext behind that only the settings page can explain to the user.

#### 5. README

**File**: `README.md`

**Contract**: Add `OPENAI_KEY_ENCRYPTION_KEY` to the secret list, noting how to generate it.
The existing list is already stale against the eight secrets in use; correcting the rest is out
of scope and should be noted as such rather than silently half-fixed.

#### 6. Linear

**Contract**: Per `context/foundation/lessons.md`, create or update the `[S-17] …` issue in team
`GRatajczak`, project `InTouch MVP v1`, moving it to In Progress on the first implemented phase
and Done at archive time, with a closing comment carrying per-phase commit SHAs, every
divergence from this plan, and the manual verification items still open.

### Success Criteria:

#### Automated Verification:

- Linting passes on the markdown that the repo lints: `npm run lint`
- No roadmap item is left with a status contradicting `change.md`

#### Manual Verification:

- The parked bullet is gone and the `S-17` section reads consistently with its neighbours
- The Linear issue exists with the right title prefix and status

---

## Testing Strategy

### Unit Tests

- Crypto round trip, per-call IV, and every null-returning failure path.
- Key resolution: absent ciphertext, decryptable ciphertext, undecryptable ciphertext.
- Failure classification: which branch the ranking run takes on 401 versus 429, and that no
  second call follows a user-key rejection.
- The calendar-date helper across a `Europe/Warsaw` day boundary, including a DST transition
  date, since date arithmetic is the whole point of not using an elapsed interval.

### Integration Tests

- The settings route triad, with the cross-owner case verified by mutation.
- The gate: first force dispatches, second refuses, non-forced never gated, key-holder never
  gated, in-flight reuse does not spend the claim.

### Manual Testing Steps

1. Add a real key in `/settings`, confirm the mask, run a manual recompute, and watch
   `wrangler tail` attribute the call to the user key.
2. Remove the key, run one manual recompute, then run a second and confirm the limit message.
3. Reload the dashboard after hitting the limit and confirm the automatic refresh is unaffected.
4. Revoke the key at OpenAI, run a recompute, and confirm the job fails and `/settings` says so.
5. Run `POST /api/settings/delete-data` on a throwaway account with a stored key and confirm the
   row, and therefore the ciphertext, is gone.

## Performance Considerations

Each ranking gains one decryption of a short string, which is negligible against a model call
and does not count toward the Workers CPU budget in any meaningful way. The gate adds one
statement to a request that already performs several. No new subrequest is added to the
50-per-request ceiling except the one `models.list()` call on save, which happens on a route
that makes no others.

## Migration Notes

Both migrations are additive and nullable, so a `wrangler rollback` to a pre-S-17 Worker leaves
five unread columns behind and nothing breaks. The reverse case is the one to keep in mind:
rolling the *encryption secret* while ciphertext exists makes every stored key unreadable. The
code degrades to the app key and the free tier, and the settings page asks for the key again,
which is the behaviour Phase 2 and Phase 3 implement together.

## References

- Research: `context/changes/byok-openai-key/research.md`
- Decisions: `context/changes/byok-openai-key/change.md`
- Route template: `src/pages/api/settings/reminders.ts:25-71`
- Section template: `src/components/settings/AnalyticsSection/AnalyticsSection.tsx`
- Migration template: `supabase/migrations/20260908121419_add_profiles_analytics_opt_out.sql`
- Calendar-day precedent: `supabase/migrations/20260908090338_create_reminder_sends.sql:155-167`
- KV limitation this design avoids: `src/pages/api/rankings.ts:46-63`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema and the crypto seam

#### Automated

- [x] 1.1 Migration applies cleanly against the local stack — aa0af08
- [x] 1.2 Generated types include the three new columns — aa0af08
- [x] 1.3 Unit tests pass — aa0af08
- [x] 1.4 Type checking passes — aa0af08
- [x] 1.5 Linting passes — aa0af08

#### Manual

- [x] 1.6 Encryption secret set in Workers Secrets via printf — aa0af08
- [x] 1.7 Same value added to GitHub Secrets — aa0af08
- [x] 1.8 `wrangler secret list` shows the name present — aa0af08

### Phase 2: The owner's key reaches the model

#### Automated

- [x] 2.1 Unit tests pass — e3f2d42
- [x] 2.2 Type checking passes — e3f2d42
- [x] 2.3 Linting passes — e3f2d42
- [x] 2.4 Build passes — e3f2d42
- [x] 2.5 No new supabase-admin import outside the reminders module — e3f2d42

#### Manual

- [x] 2.6 A recompute with a hand-seeded valid key is attributed to the user key in wrangler tail — e3f2d42
- [x] 2.7 A hand-seeded invalid key fails the job rather than falling back — e3f2d42

### Phase 3: The settings section

#### Automated

- [x] 3.1 Route tests pass — e7cdfc4
- [x] 3.2 Type checking passes — e7cdfc4
- [x] 3.3 Linting passes — e7cdfc4
- [x] 3.4 Build passes — e7cdfc4
- [x] 3.5 Cross-owner test goes red when the owner filter is deleted — e7cdfc4

#### Manual

- [x] 3.6 Saving a real key shows the mask and survives a reload — e7cdfc4
- [x] 3.7 A wrong key is rejected and stores nothing — e7cdfc4
- [x] 3.8 Removing the key returns the section to its empty state — e7cdfc4
- [x] 3.9 The section reads correctly on a narrow viewport — e7cdfc4

### Phase 4: The daily gate

#### Automated

- [x] 4.1 Route tests pass — 3e51b26
- [x] 4.2 Type checking passes — 3e51b26
- [x] 4.3 Linting passes — 3e51b26
- [x] 4.4 Build passes — 3e51b26
- [x] 4.5 Cross-owner claim test goes red when the owner filter is deleted — 3e51b26

#### Manual

- [x] 4.6 Second same-day manual recompute is refused with the ranking still visible — 3e51b26
- [x] 4.7 The automatic refresh still runs after the limit is hit — 3e51b26
- [x] 4.8 An account with a stored key is never refused — 3e51b26

### Phase 5: Marking a key that stopped working

#### Automated

- [x] 5.1 Migration applies cleanly
- [x] 5.2 Types regenerate clean
- [x] 5.3 Tests pass
- [x] 5.4 Type checking passes
- [x] 5.5 Linting passes

#### Manual

- [x] 5.6 A revoked key is marked and explained in settings
- [x] 5.7 Saving a working key clears the warning

### Phase 6: Documents, roadmap and tracker

#### Automated

- [ ] 6.1 Linting passes
- [ ] 6.2 No roadmap item contradicts change.md

#### Manual

- [ ] 6.3 The parked bullet is gone and S-17 reads consistently with its neighbours
- [ ] 6.4 The Linear issue exists with the right title prefix and status
