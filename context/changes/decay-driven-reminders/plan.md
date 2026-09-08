# Decay-Driven Reminders (S-04) Implementation Plan

## Overview

Build the daily sweep that emails a user, unprompted, about the relationship
that has gone quietest — one hero person per email, at most one email per user
per cooldown window, ordered by the hierarchy `S-02`/`S-03` already produce.

This is the first code in this repository that acts on behalf of users who are
not present. `F-04` proved the Worker can send email on a schedule; it
deliberately built no Supabase access, no reminder logic, and no sending
identity beyond Resend's owner-only test sender. This slice adds all three, and
owns the security question `F-01` never had to face: how a scheduled sweep reads
across owners without a blanket RLS bypass.

## Current State Analysis

**What exists and works:**

- `src/worker.ts` exports `scheduled` alongside Astro's `fetch`, fired by a real
  Cron Trigger (`wrangler.jsonc` `"triggers": { "crons": ["0 0 * * *"] }`).
  Today it sends one hardcoded proof email to `RESEND_TEST_RECIPIENT`.
- `src/lib/resend.ts` returns `null` when `RESEND_API_KEY` is absent — the
  optional-client pattern `src/lib/openai.ts` established.
- `src/lib/email/shell.ts` renders the design bundle's header/footer chrome
  around an arbitrary `bodyHtml`. Its footer currently says the message is a
  delivery-path test.
- `src/lib/ranking/store.ts` — `loadLatestRanking(supabase, ownerId)`,
  `isStale()` (24h via `STALE_AFTER_MS`), `persistRanking()`.
- `src/lib/contact-history/facts.ts` — `loadContactFacts(supabase, ownerId)`
  folds `contact_events` into `daysSinceLastHappened`, `lastAttemptFailed`,
  `failedAttemptsSinceLastHappened`, `recentNotes` per person. A person with no
  events is **absent from the map**, never present with zeroed fields.
- `src/lib/ranking/run.ts` — `runRanking(ownerId, supabase, jobId)` does the
  whole refresh: load profile/people/facts, call OpenAI, reconcile, persist,
  write a KV job status. Its only caller today is `POST /api/rankings`.
- `ranking_entries.time_window` is a CHECK-constrained enum:
  `'this_week' | 'two_weeks' | 'this_month' | 'no_rush'`.
- `people.status` is `'active' | 'deactivated'`; `contact_events.outcome` is
  `'happened' | 'not_yet'`.
- A vitest suite exists (`vitest.config.ts`, `tests/{rls,routes,http,stubs}/`)
  with `cloudflare:workers` aliased to an in-memory KV stub and `@/` mirrored
  from tsconfig. `tests/routes/context.ts` builds a synthetic `APIContext`;
  `tests/routes/route-client.ts` is the seam routes use to reach Supabase.

**What is missing:**

- **No cross-owner read path.** `src/lib/supabase.ts` builds a cookie-bound SSR
  client only. Every RLS policy in the schema is
  `to authenticated using ((select auth.uid()) = owner_id)`, so a cron with no
  session reads exactly zero rows from every table. There is no service-role
  client anywhere — `S-07` deliberately avoided creating the first one.
- **No send state.** Nothing records that an email went out. "At most once per
  day" is currently unenforceable and unverifiable.
- **No usable sending identity.** `src/worker.ts:24` hardcodes
  `InTouch <onboarding@resend.dev>`, which Resend delivers only to the account
  owner's own inbox (`lessons.md`).
- **No opt-out.** `src/pages/settings.astro:44` renders a "Przypomnienia" stub
  card that `S-07` left for this slice.
- **The cron fires at midnight UTC** — 01:00–02:00 in Poland.

## Desired End State

At 06:00 UTC each day the Worker wakes, asks Postgres for the small set of users
who are eligible for a reminder (opted in, and outside their cooldown), refreshes
any of those users' rankings that have gone stale, picks the single most urgent
person from each refreshed ranking, and sends one branded email per user from
`przypomnienia@mail.get-in-touch.pl`. Every send writes a row to `reminder_sends`
carrying Resend's message id or its error, so "did this user get an email today"
is a SQL query rather than a log grep. A user who has switched reminders off on
`/settings` is never contacted; a user with nothing urgent gets silence.

**How to verify:** `npm test tests/reminders` covers the decision rules;
`npm run verify:reminders -- <url> --dry-run` prints the exact send set against
real data without sending; one production run against a temporarily tightened
cron delivers a real email to a real inbox with a matching `reminder_sends` row.

### Key Discoveries

- `runRanking` (`src/lib/ranking/run.ts:76`) already takes a
  `SupabaseClient<Database>` as a parameter rather than building its own, so the
  admin client can be passed straight in. It catches every error and returns
  `void`, writing a failed KV job — the sweep therefore cannot currently tell a
  successful refresh from a failed one.
- `loadLatestRanking` and `loadContactFacts` both filter explicitly on
  `owner_id`, so they are safe to reuse under a service-role client: the owner
  scope is in the query, not only in the policy.
- The design bundle's reminder mock (`.ai/intouch-design-preparation/project/InTouch.dc.html:1047-1160`)
  is the source for the email's structure, **not** for its facts — per
  `lessons.md` it states the weight scale as "5 na 5" while the shipped product
  is 1–10, and `S-06` already shipped one factual error transcribed from it.
- `tests/routes/context.ts` and `tests/routes/route-client.ts` are the
  established seams for testing a route without a server; the sweep's decision
  logic needs neither, because it will be pure functions over already-loaded data.

## What We're NOT Doing

- **No "czy się udało?" follow-up email.** The design bundle's second mock is a
  different trigger (a ranking entry's suggested window elapsing, not decay).
  `S-03`'s in-app pending-answer prompt already closes the FR-009 loop. Recorded
  as a roadmap follow-on.
- **No one-click action tokens.** Email CTAs are plain deep links into the app;
  a signed-out click takes the normal `/auth/signin` redirect. No unauthenticated
  mutation endpoint is created.
- **No user-facing frequency control.** `/settings` gets an on/off toggle only.
  The cadence stays product-owned — the vision's claim is that the app decides.
- **No frequency link in the email footer.** The mock's "Zmień częstotliwość"
  has no destination; the footer carries "Ustawienia przypomnień" → `/settings`
  and nothing else.
- **No per-person rotation.** Per the chosen anti-nag rule, the hero stays the
  same person until a `happened` event resolves them; the cooldown is what stops
  it becoming daily.
- **No timezone field, no per-user send hour.** One cron, one hour, everyone.
- **No changes to the ranking prompt or the `time_window` semantics.** That is
  the in-flight `ranking-recency-floor` change's scope (see Open Risks).
- **No reminder history UI.** `reminder_sends` is written and queried, never
  rendered.

## Implementation Approach

Three ideas carry the design.

**1. The RPC decides *whose* data may be touched; existing helpers do the
reading.** A blanket service-role client that can `select *` across every table
is exactly what the roadmap warned would "quietly undo the guarantee `F-01`
exists to establish". Instead, `reminder_candidates()` — a `SECURITY DEFINER`
function with a fixed return shape — is the only cross-owner query in the
system. It answers one question: which owner ids are eligible right now, and
what is each one's email. Everything after that point is scoped to a single,
named `ownerId` and reuses `loadLatestRanking` / `loadContactFacts` /
`runRanking` unchanged, all of which already carry an explicit `owner_id`
filter. The service-role key lives in exactly one module that only the scheduled
handler imports.

**2. Gate before you spend.** The sweep's steps are ordered cheapest-first:
opted-in and outside-cooldown (a single RPC round trip) → refresh a stale ranking
(an OpenAI call) → is anyone actually urgent (in-memory) → send. Refreshing
before gating would put an OpenAI call on every user every day; gating first
caps AI spend at the number of users who could actually receive mail today.

**3. The decision rules are pure functions.** Eligibility, hero selection and the
once-a-day guard take already-loaded data and return a verdict. They hold every
bug worth catching and need no database, no network and no Workers runtime to
test — which is what makes phase 3 the one genuinely test-first phase here.

## Critical Implementation Details

**Failure isolation is per user, not per sweep.** One user's OpenAI timeout or
Resend rejection must not abort the loop for everyone behind them. Each user is
processed inside its own `try`/`catch`; a caught failure is logged with a
`[reminders]` prefix (mirroring `[ranking]` in `run.ts`) and, where a send was
attempted, written to `reminder_sends` with its error. The `scheduled` handler
throws only if the sweep itself could not start.

**`runRanking` currently swallows its outcome.** It catches everything and
returns `void`. The sweep needs to know whether the refresh worked before it
decides to send, so `runRanking` must return its terminal status. This is
additive — `POST /api/rankings` ignores the return value and is unaffected.

**Cloudflare's free tier caps Cron Triggers at 5 per account, not per Worker**
(`context/foundation/infrastructure.md`). This slice keeps exactly one trigger;
phase 7's temporary tight interval must *replace* the daily entry, never be
added alongside it.

**`wrangler.jsonc`'s `triggers` block is non-versioned.** `wrangler versions
upload` does not apply a cron change — it needs `wrangler triggers deploy` or a
real `wrangler deploy`. The same applies to `observability`, which is why a
silent `wrangler tail` is an unsynced-settings symptom first (`lessons.md`).

---

## Phase 1: Sending identity and config plumbing

### Overview

Everything that has an external lead time or touches secrets, done first so DNS
verification runs in the background while later phases are built. No reminder
logic yet.

### Changes Required

#### 1. Resend sending domain

**Intent**: Replace the owner-only test sender with an identity that can reach
any user's inbox — the gap `lessons.md` says must close before this slice ships.

**Contract**: A `mail.get-in-touch.pl` subdomain verified in Resend (SPF, DKIM
and the return-path records Resend issues), so transactional sending reputation
stays off the apex domain that serves the site. Sending address:
`InTouch <przypomnienia@mail.get-in-touch.pl>`. This is a human operation, not
an agent one — DNS records are added by the user.

#### 2. Environment schema

**File**: `astro.config.mjs`

**Intent**: Admit the two new config values, following the existing
optional-secret convention so a missing key degrades one feature rather than
breaking the Worker.

**Contract**: Two `envField.string({ context: "server", access: "secret" })`
entries — `SUPABASE_SERVICE_ROLE_KEY` (optional) and `REMINDER_FROM` (optional).
Both `optional: true`, mirroring `RESEND_API_KEY`'s comment and rationale.
`RESEND_TEST_RECIPIENT` stays, still used by nothing after phase 5 removes the
proof send — remove it in phase 5, not here.

#### 3. Secrets in all three locations

**Intent**: The project's standing rule (`CLAUDE.md`) is that a secret lives in
`.dev.vars`, Workers Secrets and GitHub Secrets. Setting production secrets is a
human operation.

**Contract**: `SUPABASE_SERVICE_ROLE_KEY` and `REMINDER_FROM` added to
`.env.example` (as `###`), to `.dev.vars` locally, and — by the user —
`wrangler secret put` plus the GitHub repository secrets consumed by
`deploy.yml`.

#### 4. Service-role client module

**File**: `src/lib/supabase-admin.ts` (new)

**Intent**: Confine the RLS bypass to one auditable file. This module is the
only place the service-role key is read, and only `src/lib/reminders/**` and
`scripts/verify-reminders.ts` may import it.

**Contract**: `createAdminClient(): SupabaseClient<Database> | null` — returns
`null` when `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is absent, matching
`src/lib/supabase.ts`'s and `src/lib/resend.ts`'s null-on-missing-config shape.
Built with `createClient` from `@supabase/supabase-js` (not `@supabase/ssr` —
there are no cookies here) and `auth: { persistSession: false, autoRefreshToken: false }`.
A file-header comment states the import restriction and why it exists, in the
style of `src/lib/ai-jobs.ts`'s binding note.

#### 5. Cron time

**File**: `wrangler.jsonc`

**Intent**: Move the daily trigger from midnight UTC to the morning of the
user base's actual timezone.

**Contract**: `"crons": ["0 6 * * *"]` — 08:00 CEST / 07:00 CET. Comment records
that the hour is chosen for Poland and shifts by one with DST, and that this
block is non-versioned.

### Success Criteria

#### Automated Verification

- `npm run build` succeeds with the new env schema
- `npx astro check` passes
- `npm run lint` passes
- `npm test` — the existing suite stays green (a new env field must not break `vitest.config.ts`'s env inlining; add both to `.env.test`)

#### Manual Verification

- Resend dashboard shows `mail.get-in-touch.pl` as Verified
- `wrangler secret list` shows `SUPABASE_SERVICE_ROLE_KEY` and `REMINDER_FROM` in production
- The Cloudflare dashboard's Trigger Events tab shows the schedule as `0 6 * * *` after a deploy

**Implementation Note**: DNS verification has an external lead time nobody can
compress. Start it before writing any code in this phase; phases 2–6 do not
depend on it and can proceed while it propagates.

---

## Phase 2: Schema for absent-user reads

### Overview

The state the sweep needs: an opt-out flag, a send log, and the two narrow
`SECURITY DEFINER` functions that are the sweep's only cross-owner surface.

### Changes Required

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_create_reminder_sends.sql` (new)

**Intent**: Add reminder state in one forward-compatible migration — additive
columns with defaults, a new table, and two functions. Nothing existing is
altered in a way that a `wrangler rollback` of the Worker code would break
(`CLAUDE.md`).

**Contract**:

- `alter table public.profiles add column reminders_enabled boolean not null default true` —
  additive with a default, so every existing profile reads back opted in and
  needs no backfill.
- `create table public.reminder_sends`:
  `id uuid pk`, `owner_id uuid not null references auth.users(id) on delete cascade`,
  `person_id uuid references public.people(id) on delete set null`,
  `ranking_id uuid references public.rankings(id) on delete set null`,
  `sent_at timestamptz not null default now()`,
  `status text not null check (status in ('sent', 'failed'))`,
  `provider_message_id text`, `error text check (char_length(error) <= 500)`.
  Index on `(owner_id, sent_at desc)` — the cooldown query's exact shape.
- **Per-table `ON DELETE` decision**, recorded in the migration comment as
  `lessons.md` requires: `owner_id` cascades (a send log about a deleted
  account's relationships is third-party personal data with no owner, and the
  erasure NFR is binary). `person_id` and `ranking_id` are `SET NULL` rather
  than cascade, so deleting one person does not erase the evidence that the
  once-a-day NFR was honoured for that user. The row that survives carries no
  name — only an owner id, a timestamp and a status.
- Four owner-scoped RLS policies plus the `grant select on … to anon` /
  `grant select, insert, update, delete on … to authenticated` pair, mirroring
  `20260902184909_create_contact_events_table.sql` exactly so the isolation
  contract stays uniform.
- `create function public.reminder_candidates(cooldown_days int, max_rows int)
   returns table (owner_id uuid, email text, last_sent_at timestamptz)
   language sql security definer set search_path = ''` — joins `public.profiles`
   to `auth.users`, filters `reminders_enabled`, excludes any owner with a
   `reminder_sends` row newer than `now() - cooldown_days`, orders by
   `last_sent_at nulls first` so never-reminded users go first, `limit max_rows`.
   `revoke execute … from anon, authenticated` — only `service_role` may call it.
- `create function public.record_reminder_send(...) returns uuid`, same
  `security definer` / `set search_path = ''` / revoke treatment, inserting one
  `reminder_sends` row.

Both functions carry `set search_path = ''` and fully-qualified table names —
the standard `SECURITY DEFINER` hardening, without which a caller-controlled
search path can redirect the function's table references.

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Keep app code typed against the real schema.

**Contract**: Regenerated via `npm run db:types` after the migration applies
locally. The `Functions` section gains both RPC signatures.

### Success Criteria

#### Automated Verification

- `supabase migration up` applies cleanly against a local stack
- `npm run db:types` regenerates without error and the diff shows `reminder_sends`, `profiles.reminders_enabled` and both functions
- `npx astro check` passes with the regenerated types
- `npm test tests/rls` — the isolation suite stays green and is extended to cover `reminder_sends` (user B cannot read user A's rows)

#### Manual Verification

- Calling `reminder_candidates` as an `authenticated` role is rejected (permission denied), and as `service_role` returns rows
- The migration applied to the hosted Supabase project, not only locally

---

## Phase 3: Decision logic (test-first)

### Overview

The rules that decide whether to send and to whom, as pure functions over
already-loaded data. This is where the bugs live and where the tests belong.

**This phase is a good `/10x-tdd` candidate.** The first red test states itself:
*"selects no hero when every entry's window is `this_month` or `no_rush`"*.

### Changes Required

#### 1. Reminder rules

**File**: `src/lib/reminders/select.ts` (new)

**Intent**: Express the cadence decision as data-in / verdict-out, with the two
tunable numbers as named constants rather than literals buried in the sweep.

**Contract**:

- `export const REMINDER_COOLDOWN_DAYS = 3` — the per-user gap. The NFR's ceiling
  is one per day; three keeps it to roughly two emails a week, which is the
  restraint FR-008's Socrates note asked for. Named so it is one edit to retune
  once `F-06`'s funnel gives it a number.
- `export const URGENT_WINDOWS = ["this_week", "two_weeks"] as const` — the two
  `time_window` values the model uses to mean time-sensitive. `this_month` and
  `no_rush` produce silence, which is what makes the cadence decay-driven rather
  than calendar-driven.
- `export const MAX_REFRESHES_PER_RUN = 25` — bounds AI spend and wall-clock time
  for a single invocation.
- `selectHero(ranking, facts): { hero, queue } | null` — the hero is the
  lowest-`rankPosition` entry whose `person.status === 'active'` and whose
  `timeWindow` is in `URGENT_WINDOWS`, **excluding** anyone with a `happened`
  contact event recorded after `ranking.createdAt` (they have already been dealt
  with since this ranking was computed). `queue` is the next two entries after
  the hero, whatever their window — the mock's "W kolejce, ale bez pośpiechu"
  list. Returns `null` when nothing qualifies.
- `buildReasonFactors(hero, facts): ReasonFactor[]` — the "Dlaczego akurat teraz"
  bullets, derived from real data only and **omitted rather than defaulted** when
  a source is absent, following the same rule `facts.ts` and the ranking prompt
  already apply: relationship weight (`n na 10` — the shipped 1–10 scale, *not*
  the mock's "5 na 5"), silence duration from `daysSinceLastHappened`, a failed
  previous attempt from `lastAttemptFailed`, and the entry's `rhythmNote` when
  the owner filled `S-09`'s fields. A person with no recorded events yields no
  silence bullet, never "0 dni".

#### 2. Tests

**File**: `tests/reminders/select.test.ts` (new)

**Intent**: Pin the rules against regressions, with each test catching a distinct
failure rather than restating the implementation.

**Contract**: One `it.each`-style table per property, covering at minimum:
no hero when every window is non-urgent; the hero skips a `deactivated` person;
the hero skips someone with a `happened` event after `ranking.createdAt` but
**not** one recorded before it; `queue` is capped at two and may contain
non-urgent entries; `buildReasonFactors` omits the silence bullet for a person
absent from the facts map; the weight bullet reads against a 1–10 scale. The
expected values come from the PRD and the schema's CHECK constraint, not from
running the implementation.

**File**: `vitest.config.ts`

**Contract**: Add `"tests/reminders/**/*.test.ts"` to `test.include`, and extend
the comment block's directory-per-layer list with `tests/reminders -- none; pure
functions, no infrastructure`.

### Success Criteria

#### Automated Verification

- `npm test tests/reminders` passes
- `npm test` — the full suite stays green
- `npx astro check` passes
- `npm run lint` passes

#### Manual Verification

- A dry read of the test table confirms each case would fail if the corresponding rule were removed (spot-check by commenting out one rule)

---

## Phase 4: Reminder email template

### Overview

The email body the mock specifies, built from real data, on top of the existing
shell.

### Changes Required

#### 1. Shell footer

**File**: `src/lib/email/shell.ts`

**Intent**: The footer currently declares the message a delivery-path test. That
was correct for `F-04` and is false for a real reminder.

**Contract**: The footer text becomes a parameter (`footerNote`) rather than a
hardcoded string, defaulting to the mock's line: *"Wysyłamy maksymalnie jedną
taką wiadomość dziennie, tylko o relacjach, które cichną."* followed by an
"Ustawienia przypomnień" link to `/settings`. No "Zmień częstotliwość" link —
there is no frequency control to link to.

#### 2. Reminder body

**File**: `src/lib/reminders/email.ts` (new)

**Intent**: Render the hero email the mock describes, from the selection phase's
output.

**Contract**: `renderReminderEmail({ hero, queue, factors, profileName, baseUrl }): { subject, html }`.
Structure follows `InTouch.dc.html:1078-1155`: an urgency pill carrying the
Polish label for the hero's `time_window`, a serif headline naming the person, a
prose line from the entry's `reason`, the "Dlaczego akurat teraz" factor card,
the CTA block, the "W kolejce, ale bez pośpiechu" list, and the shell footer.

CTAs are native anchors styled inline (this is email HTML — table/inline styles
only, no Tailwind, no external CSS), pointing at:
`Zaplanuję kontakt` → `${baseUrl}/people/${hero.person.id}`;
`Odłóż o tydzień` and `Już rozmawialiśmy` → `${baseUrl}/dashboard`. A signed-out
click takes the normal `/auth/signin` redirect and lands there after login.

`baseUrl` comes from `astro.config.mjs`'s `site` value, never a hardcoded domain
(`CLAUDE.md`).

The `time_window` → Polish label map already exists for the hierarchy UI —
reuse it rather than writing a second one, so the email and the dashboard can
never disagree about what `two_weeks` is called.

#### 3. Preview script

**File**: `scripts/render-email-preview.ts`

**Intent**: A human has to look at this. `lessons.md` is explicit that passing
`astro check` / lint / build proves nothing about whether a component renders.

**Contract**: Extend the script to render a realistic reminder (fixture hero,
two queue entries, all four factor types) to `email-preview.html` alongside the
existing shell preview.

### Success Criteria

#### Automated Verification

- `npm run render:email-preview` writes the file without error
- `npx astro check` passes
- `npm run lint` passes

#### Manual Verification

- `email-preview.html` opened in a browser matches the mock's structure and the warm palette
- The weight bullet reads "n na 10", not "n na 5" — the mock's own error is not transcribed
- Every CTA is a visibly styled button, not plain link text (`lessons.md`'s `<Button asChild>` failure mode has an email-HTML analogue: inline styles on the anchor itself)
- The rendered email is legible on a phone-width viewport

**Implementation Note**: Pause here for the human look before proceeding — this
phase's automated criteria cannot prove the email renders correctly.

---

## Phase 5: The sweep

### Overview

Wire it together: candidates → refresh → select → render → send → record.

### Changes Required

#### 1. `runRanking` returns its outcome

**File**: `src/lib/ranking/run.ts`

**Intent**: The sweep must not send from a ranking whose refresh just failed.

**Contract**: `runRanking` returns `Promise<"done" | "failed">` instead of
`Promise<void>` — the value it already writes to the KV job. Purely additive:
`src/pages/api/rankings.ts:69` ignores the return and is unchanged.

#### 2. The sweep

**File**: `src/lib/reminders/sweep.ts` (new)

**Intent**: The orchestration, kept out of `worker.ts` so the handler stays a
thin shell — the same separation `run.ts` has from the rankings route.

**Contract**: `runReminderSweep({ dryRun }: { dryRun?: boolean }): Promise<SweepSummary>`.

Ordered cheapest-first:

1. Build the admin client and the Resend client; if either is `null`, log and
   return an empty summary (no throw — a missing key fails one sweep, not the Worker).
2. `reminder_candidates(REMINDER_COOLDOWN_DAYS, MAX_REFRESHES_PER_RUN)`.
3. For each candidate, inside its own `try`/`catch`:
   a. `loadLatestRanking(admin, ownerId)`; if `isStale()`, `await runRanking(...)`
      with a `cron:<uuid>` job id, then reload. If the refresh returned `"failed"`
      or the reload is still stale, skip this user and log.
   b. `loadContactFacts(admin, ownerId)`.
   c. `selectHero(...)`; `null` → skip, log, **no** `reminder_sends` row (silence
      is not a send).
   d. `renderReminderEmail(...)`.
   e. `dryRun` → push to the summary and continue. Otherwise `resend.emails.send`
      with `from: REMINDER_FROM`, `to: [candidate.email]`.
   f. `record_reminder_send(...)` with `'sent'` + the provider message id, or
      `'failed'` + the error. **The log row is written on both outcomes** — a
      failed send that leaves no trace is the fire-and-forget the NFR forbids.
4. Return a summary (considered / refreshed / sent / skipped-with-reason /
   failed) and log it as one line.

Every log line carries a `[reminders]` prefix, mirroring `[ranking]` in `run.ts`.
No log line ever contains a person's name, description or the user's email —
owner ids and person ids only, consistent with `F-06`'s privacy constraint.

#### 3. Scheduled handler

**File**: `src/worker.ts`

**Intent**: Replace `F-04`'s proof send with the real sweep.

**Contract**: `scheduled` becomes a call to `runReminderSweep({})`, logging the
returned summary. The `PROOF_SUBJECT` constant, the `RESEND_TEST_RECIPIENT`
import and the proof body are removed, along with the now-unused
`RESEND_TEST_RECIPIENT` entry in `astro.config.mjs` and `.env.example`. The
handler rethrows only if the sweep itself could not start, so Cloudflare's
Trigger Events tab shows a red invocation for an infrastructure failure but not
for one user's bad send.

#### 4. Dry-run script

**File**: `scripts/verify-reminders.ts` (new), `package.json`

**Intent**: There is no way to fire a Cron Trigger on demand, and a real run
costs a real email. A dry run gives an end-to-end read in seconds.

**Contract**: `npm run verify:reminders -- --dry-run` calls `runReminderSweep({ dryRun: true })`
against the configured Supabase project and prints, per candidate, the hero, the
factors and the subject line it *would* send — sending nothing. Follows the
`assert()` + `failures[]` + non-zero-exit shape of `scripts/verify-ranking.ts`.
Unlike the other verify scripts it runs the sweep in-process rather than against
a deployed URL, because the sweep has no HTTP surface.

### Success Criteria

#### Automated Verification

- `npm test` — full suite green
- `npx astro check` passes
- `npm run lint` passes
- `npm run build` succeeds
- `npm run verify:reminders -- --dry-run` exits 0 and prints a plausible send set against local data

#### Manual Verification

- The dry-run output names the person the dashboard's hierarchy also puts first
- Running the dry run twice in a row produces the same result (no state is mutated by a dry run)
- A user with `reminders_enabled = false` never appears in the candidate list

---

## Phase 6: Reminders toggle on `/settings`

### Overview

Replace the stub card with the one control that is non-negotiable: a way to stop
the email.

### Changes Required

#### 1. Toggle component

**File**: `src/components/settings/RemindersSection/` (new — `RemindersSection.tsx`, `types.ts`, `index.ts`)

**Intent**: Let the user opt out. Component structure follows `lessons.md`'s
folder-plus-types-plus-barrel rule, matching `EmailChangeForm` and
`PasswordChangeForm` beside it.

**Contract**: Takes `remindersEnabled: boolean`, renders a labelled switch plus
a one-line explanation of what the reminders are, `POST`s to
`/api/settings/reminders`, and reports success/failure through the existing
`Toaster`. Optimistic update reverted on failure.

#### 2. API route

**File**: `src/pages/api/settings/reminders.ts` (new)

**Intent**: Persist the flag, owner-scoped.

**Contract**: `POST` with `{ enabled: boolean }`, validated by a zod schema in
`src/lib/validation/settings.ts` (the file already exists for the other settings
forms). Returns 401 without `locals.user`, 503 without a Supabase client, and
otherwise updates `profiles.reminders_enabled` for `auth.uid()` under normal
RLS — this route uses the ordinary cookie client, never the admin one.

#### 3. Settings page

**File**: `src/pages/settings.astro`

**Contract**: The "Przypomnienia" section's placeholder paragraph is replaced by
`<RemindersSection client:load remindersEnabled={…} />`, with the flag read
alongside the existing profile query.

### Success Criteria

#### Automated Verification

- `npm test tests/routes` — extended with cases for the new route: 401 unauthenticated, cross-owner write rejected, invalid body rejected
- `npx astro check` passes
- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification

- Toggling off, reloading `/settings`, and seeing it still off
- With the toggle off, `npm run verify:reminders -- --dry-run` omits that user
- The toast appears on both success and failure

**Implementation Note**: Pause for the human look — a rendered switch is exactly
the class of UI `lessons.md` says automated checks cannot vouch for.

---

## Phase 7: Production verification

### Overview

Prove the real thing on the real runtime. Nothing here is code.

### Changes Required

#### 1. Production migration and secrets

**Intent**: The hosted Supabase project and the production Worker need what
phases 1–2 added locally.

**Contract**: `supabase db push` against the hosted project; the user confirms
`SUPABASE_SERVICE_ROLE_KEY` and `REMINDER_FROM` via `wrangler secret list`, and
that the GitHub secrets `deploy.yml` consumes are set.

#### 2. Observed run

**Intent**: `F-04` established the only workable production proof: no mechanism
fires a Cron Trigger on demand.

**Contract**: Temporarily **replace** (never add to — the free tier caps 5 per
account) the `0 6 * * *` entry with a tight interval, `wrangler deploy`, observe
via `wrangler tail` and the dashboard's Trigger Events, confirm a real email
arrives and a matching `reminder_sends` row exists with a Resend message id, then
restore `0 6 * * *` and deploy again. Per `lessons.md`, a silent `wrangler tail`
means unsynced non-versioned settings, not missing traffic.

#### 3. Linear sync

**Intent**: `lessons.md` requires the roadmap flip to be mirrored the same run.

**Contract**: The `[S-04]` issue in team `GRatajczak`, project `InTouch MVP v1`,
moves to In Progress on the first implemented phase and to Done only once manual
verification closes, with a comment carrying per-phase SHAs, divergences and any
open manual items.

### Success Criteria

#### Automated Verification

- `npm run build && wrangler deploy` succeeds
- `wrangler secret list` shows both new secrets
- The final deployed `wrangler.jsonc` carries `"0 6 * * *"`

#### Manual Verification

- A real reminder email arrives in a real inbox, sent from `przypomnienia@mail.get-in-touch.pl`
- `wrangler tail` shows a clean `[reminders]` summary line and no uncaught exception
- A `reminder_sends` row exists with `status = 'sent'` and a provider message id
- A second invocation inside the cooldown window sends nothing and adds no row
- The email renders correctly in a real mail client (not only the local preview) on both desktop and phone

---

## Testing Strategy

### Unit Tests (`tests/reminders/`)

- Hero selection: non-urgent windows produce silence; deactivated people are skipped; a `happened` event after the ranking's `created_at` excludes that person, one before it does not
- Queue: capped at two, may hold non-urgent entries, empty when the hero is last
- Factors: each bullet omitted rather than defaulted when its source is absent; the weight bullet reads against 1–10

### Integration Tests (`tests/rls/`)

- `reminder_sends` isolation: user B cannot select, insert or delete user A's rows — the same shape the existing suite applies to `contact_events`
- `reminder_candidates` is not executable by `authenticated` or `anon`

### Route Tests (`tests/routes/`)

- `POST /api/settings/reminders`: 401 unauthenticated, 400 on an invalid body, and a write scoped to the caller

### Manual Testing Steps

1. Set `reminders_enabled = false` on `/settings`; run the dry run; confirm the user is absent
2. Set it back on; run the dry run; confirm the hero matches the dashboard's top card
3. Record a `happened` event for the hero; re-run the dry run; confirm the hero moved on or silence resulted
4. Set every person's window to `no_rush` (via a ranking refresh after marking everyone contacted); confirm the dry run sends nothing
5. Open the production email on a phone and click each CTA while signed out — confirm the signin redirect lands on the intended page

## Performance Considerations

The sweep's cost is dominated by the OpenAI refresh, which is why the cooldown
gate runs first: at `REMINDER_COOLDOWN_DAYS = 3`, at most a third of the user
base is eligible on any given day, and `MAX_REFRESHES_PER_RUN = 25` caps a single
invocation regardless.

Cron handlers get materially more CPU headroom than the free tier's 10ms
per-request limit, and the OpenAI wait is I/O rather than CPU — but `lessons.md`
is explicit that a clean local run proves nothing about production ceilings.
Phase 7's observed run is what actually establishes this holds, and the summary
line it logs should carry the elapsed time so the headroom is visible.

Per-user reads are one query each for the ranking, its entries and the owner's
contact events — the same three `dashboard.astro` already runs per page view.

## Migration Notes

The migration is additive throughout: a column with a default, a new table, two
new functions. A `wrangler rollback` to a pre-S-04 Worker leaves the schema in
place with nothing reading it, which is the forward-compatibility `CLAUDE.md`
requires. No backfill: every existing profile reads back `reminders_enabled = true`.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-04)
- Delivery path this builds on: `context/archive/2026-09-02-resend-email-delivery-path/plan.md`
- Feedback loop this reads: `context/archive/2026-09-02-did-it-happen-feedback-loop/plan.md`
- Email design source: `.ai/intouch-design-preparation/project/InTouch.dc.html:1047-1160`
- Risk #7 in `context/foundation/test-plan.md`
- `src/lib/ranking/run.ts:76` (`runRanking`), `src/lib/ranking/store.ts:57` (`loadLatestRanking`), `src/lib/contact-history/facts.ts:66` (`loadContactFacts`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Sending identity and config plumbing

#### Automated

- [x] 1.1 `npm run build` succeeds with the new env schema — 4cebfee
- [x] 1.2 `npx astro check` passes — 4cebfee
- [x] 1.3 `npm run lint` passes — 4cebfee
- [x] 1.4 `npm test` — existing suite stays green with both fields in `.env.test` — 4cebfee

#### Manual

- [ ] 1.5 Resend dashboard shows `mail.get-in-touch.pl` as Verified
- [x] 1.6 `wrangler secret list` shows `SUPABASE_SERVICE_ROLE_KEY` and `REMINDER_FROM` — 4cebfee
- [x] 1.7 Cloudflare Trigger Events shows the schedule as `0 6 * * *` — 4cebfee

### Phase 2: Schema for absent-user reads

#### Automated

- [x] 2.1 `supabase migration up` applies cleanly locally — cc43b79
- [x] 2.2 `npm run db:types` regenerates and the diff shows the new table, column and both functions — cc43b79
- [x] 2.3 `npx astro check` passes with the regenerated types — cc43b79
- [x] 2.4 `npm test tests/rls` green, extended to cover `reminder_sends` — cc43b79

#### Manual

- [x] 2.5 `reminder_candidates` rejected as `authenticated`, returns rows as `service_role` — cc43b79
- [x] 2.6 Migration applied to the hosted Supabase project — cc43b79

### Phase 3: Decision logic (test-first)

#### Automated

- [x] 3.1 `npm test tests/reminders` passes — 31b12d9
- [x] 3.2 `npm test` — full suite green — 31b12d9
- [x] 3.3 `npx astro check` passes — 31b12d9
- [x] 3.4 `npm run lint` passes — 31b12d9

#### Manual

- [x] 3.5 Spot-check: removing one rule makes its test fail — 31b12d9

### Phase 4: Reminder email template

#### Automated

- [x] 4.1 `npm run render:email-preview` writes the file without error — ba35178
- [x] 4.2 `npx astro check` passes — ba35178
- [x] 4.3 `npm run lint` passes — ba35178

#### Manual

- [x] 4.4 Preview matches the mock's structure and palette — ba35178
- [x] 4.5 Weight bullet reads "n na 10", not the mock's "5 na 5" — ba35178
- [x] 4.6 Every CTA renders as a visibly styled button — ba35178
- [x] 4.7 Legible at phone width — ba35178

### Phase 5: The sweep

#### Automated

- [x] 5.1 `npm test` — full suite green
- [x] 5.2 `npx astro check` passes
- [x] 5.3 `npm run lint` passes
- [x] 5.4 `npm run build` succeeds
- [x] 5.5 `npm run verify:reminders -- --dry-run` exits 0 with a plausible send set

#### Manual

- [ ] 5.6 Dry-run hero matches the dashboard's top card
- [x] 5.7 Two consecutive dry runs produce identical output
- [x] 5.8 A user with `reminders_enabled = false` never appears

### Phase 6: Reminders toggle on `/settings`

#### Automated

- [ ] 6.1 `npm test tests/routes` green, extended for `/api/settings/reminders`
- [ ] 6.2 `npx astro check` passes
- [ ] 6.3 `npm run lint` passes
- [ ] 6.4 `npm run build` succeeds

#### Manual

- [ ] 6.5 Toggling off survives a reload
- [ ] 6.6 With the toggle off the dry run omits that user
- [ ] 6.7 Toast appears on both success and failure

### Phase 7: Production verification

#### Automated

- [ ] 7.1 `npm run build && wrangler deploy` succeeds
- [ ] 7.2 `wrangler secret list` shows both new secrets
- [ ] 7.3 Deployed `wrangler.jsonc` carries `"0 6 * * *"`

#### Manual

- [ ] 7.4 A real reminder arrives from `przypomnienia@mail.get-in-touch.pl`
- [ ] 7.5 `wrangler tail` shows a clean `[reminders]` summary, no uncaught exception
- [ ] 7.6 A `reminder_sends` row exists with `status = 'sent'` and a message id
- [ ] 7.7 A second invocation inside the cooldown sends nothing and adds no row
- [ ] 7.8 The email renders correctly in a real mail client, desktop and phone
- [ ] 7.9 Linear `[S-04]` updated with SHAs, divergences and open manual items
