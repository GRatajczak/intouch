# AI Contact Hierarchy Implementation Plan

## Overview

Turn the placeholder `/dashboard` — already labelled "Dziś" in the nav — into the ranked
"who to reconnect with" view that `US-01` and `FR-007` describe. A `gpt-5.4-mini` call,
made through `F-02`'s non-blocking `waitUntil` + KV-poll path, orders every person the
user has added, gives each a suggested time window and a short "Dlaczego teraz"
justification, and persists the result in a new owner-scoped table pair so `S-03` has
something durable to attach a yes/no answer to and `S-04` has a real order to remind from.

This is the slice that carries the product's biggest unknown. The PRD names AI relevance
as the guardrail that decides whether the core feature is worth anything, and two of
`US-01`'s acceptance criteria are quality gates rather than feature checks: two people
with the same weight must not be ordered identically, and a user with no people must get
an explanatory empty state rather than an error.

## Current State Analysis

**All three prerequisites are shipped.** The roadmap still shows `F-02` as `in-progress`,
but `context/changes/openai-ranking-call-path/change.md` says `status: implemented` and
the code is present and verified against a deployed preview.

What exists that this slice builds on:

- **Data.** `people` carries `name`, `relationship_type`, `description` (≤500 chars),
  `is_collective`, `weight` (1–10) — `supabase/migrations/20260830101704_add_profiles_and_people_fields.sql`.
  `profiles` carries `name`, `birth_date`, `life_context` (≤300 chars) plus `S-09`'s three
  optional rhythm columns — `supabase/migrations/20260831202209_add_profile_rhythm_fields.sql`.
- **The AI call path.** `src/lib/openai.ts:3` returns `null` when the key is absent;
  `src/lib/ai-jobs.ts` is the repo's only importer of `cloudflare:workers`' `env` and wraps
  the `AI_JOBS` KV namespace with a baked-in 1h TTL; `src/pages/api/internal/ai-ping.ts` is
  a working reference for the whole `POST → 202 → waitUntil → KV → GET poll` shape,
  including its `json()` helper and its `cfContext`-missing fallback.
- **The shell.** `src/components/layout/AppShell.astro` takes `title`, `profileName` and an
  optional `peopleCount`; `NAV_ITEMS[0]` in `src/lib/nav-items.ts:18` already points "Dziś"
  at `/dashboard`. `src/pages/dashboard.astro` renders a placeholder "Panel" card with two
  links, and is the only thing standing where the hierarchy goes.
- **Conventions to copy.** `src/lib/validation/profile.ts` establishes the
  `VALUES` / `LABELS` / `OPTIONS` triple as the single source for an enum and its Polish
  copy. `src/components/people/PersonCard/` establishes the folder-per-component layout
  (`Component.tsx` + `types.ts` + `index.ts`) that `lessons.md` requires.
  `scripts/verify-openai-call.ts` establishes the `assert()` + `failures[]` + non-zero-exit
  verification script, run against a deployed URL and refusing localhost.

What is missing:

- No table stores a ranking. `F-02`'s KV store is deliberately ephemeral
  (`expirationTtl: 3600` in `src/lib/ai-jobs.ts:9`) — correct for a job status, useless as
  the durable artifact `S-03` and `S-04` both need to reference.
- No contact history exists. The design mock's `Ostatni kontakt`, `Poprzednia próba nie
  udała się` chips and its `Zaplanowałam kontakt` / `Odłóż o tydzień` actions all need a
  table that `S-03` owns. `US-01`'s fourth acceptance criterion ("takes into account time
  since the last (un)successful contact") is therefore explicitly out of scope here.
- No structured-output code. The repo has `openai@7.8.0` and `zod@4.5.4` but has never
  called `responses.parse()`.

## Desired End State

A signed-in user with a filled profile and at least one person opens `/dashboard` and sees
their people in AI-decided order. The top three carry a "Dlaczego teraz" paragraph and
factor chips; the rest are one-line rows with a time window and a `Rozwiń` affordance. A
banner states when the order was last computed and offers "Przelicz teraz". Opening the
page on a ranking older than 24 hours quietly starts a refresh, the stored order stays on
screen while it runs, and the new one swaps in when it lands — even if the user left and
came back. Two people with weight 8 appear in different positions, and the reason text
says why.

Verified by: `npm run verify:ranking -- <deployed-preview-url>` passing, plus a manual pass
through the states listed in each phase's Manual Verification.

### Key Discoveries:

- `openai@7.8.0` ships `responses.parse()` (`node_modules/openai/resources/responses/responses.d.ts:78`)
  and `zodTextFormat` from `openai/helpers/zod`, whose JSDoc explicitly states it supports
  `zod/v4` — which is what this repo has. This is the structured-output path; no manual
  JSON-schema authoring and no `JSON.parse` of a free-text response.
- Real model IDs are enumerated in `node_modules/openai/resources/shared.d.ts:2`.
  `gpt-5.4-mini` is present and is the chosen model. `F-02`'s `gpt-4o-mini` was a
  throwaway ping choice it explicitly deferred to this slice.
- `OPENAI_API_KEY` is `optional: true` in `astro.config.mjs` with the comment "Optional
  until S-02 depends on it". **It stays optional** — see "Implementation Approach".
- `src/middleware.ts:4-5` gates `/dashboard` on auth but not on profile existence, and
  `src/lib/shell-summary.ts`'s docstring confirms a signed-up user who skipped `/profile`
  can reach `/dashboard`. That state is reachable and needs its own empty state.
- `lessons.md` — a non-browser POST to a JSON route must send
  `Content-Type: application/json` or Astro's pre-routing origin check returns a 403 that
  never reaches the handler. This bites `scripts/verify-ranking.ts`, not the browser.
- `lessons.md` — `ON DELETE CASCADE` on a new `owner_id` FK is a per-table decision, never
  inherited from `people`.

## What We're NOT Doing

- **No contact history.** No `contacts` table, no `Ostatni kontakt` / `Poprzednia próba`
  chips, no `Zaplanowałam kontakt` / `Odłóż o tydzień` actions, no `Historia` nav item.
  All of it is `S-03`. The card renders thinner than the mock rather than showing
  disabled buttons or fabricated history.
- **No scheduled recompute.** The mock's "dziś o 6:00" implies a nightly cron. Building it
  needs the cross-user, no-signed-in-user sweep that the roadmap parks in `S-04` as an
  unresolved RLS problem. Refresh is stale-on-view plus the explicit button.
- **No person editing, deactivation or deletion** — `S-05`. A deactivated-person filter is
  not built here because there is no `is_active` column yet.
- **No categories/tabs** (`FR-006`, nice-to-have), no reminder emails (`S-04`), no changes
  to `/people` or `/profile`.
- **No `OPENAI_API_KEY` promotion to required**, no new KV namespace, no new binding.
- **No retry/backoff beyond the `openai` SDK's own defaults**, matching `F-02`'s scope note.
- **No test framework.** The repo has none; verification follows the two existing `tsx`
  script precedents.

## Implementation Approach

**Persistence.** Two new tables — `rankings` (one row per computed run) and
`ranking_entries` (one row per person in that run) — following `F-01`'s owner-scoped RLS
pattern exactly: RLS enabled, one explicit policy per command, explicit table-level GRANTs
(the `20260830101704` migration's comment records that policies alone are not enough in
this project). `owner_id` is denormalized onto `ranking_entries` so every policy stays a
flat `(select auth.uid()) = owner_id` check with no join, matching every existing policy in
the repo. Both `owner_id` FKs are `ON DELETE CASCADE` — a ranking is derived data with no
value once its inputs are gone, and leaving AI-generated prose about a deleted user's
relationships behind would violate the PRD's binary erasure NFR outright.

**The call.** `responses.parse()` with `zodTextFormat`, so the model's output is validated
against a zod schema before it is trusted. The model receives every person up to a cap of
50 (highest weight first) and returns a complete ordering with, per entry, a time-window
enum, a reason paragraph, and two optional short chip labels. Time windows are never
model-authored prose: the model picks from a fixed enum and the UI maps it to Polish copy
through a label map, mirroring `src/lib/validation/profile.ts`. This keeps the value
sortable for `S-04`'s scheduling and stops phrasing drifting between runs.

**Why the API key stays optional.** Promoting `OPENAI_API_KEY` to `optional: false` would
make a missing secret fail every request in the Worker, not just the hierarchy. Keeping it
optional means `createOpenAIClient()` returning `null` becomes an ordinary job failure,
which the chosen failure handling already covers gracefully. The blast radius of a
misconfigured deploy stays confined to one screen.

**Non-blocking.** `POST /api/rankings` writes a `pending` KV job, hands the real work to
`cfContext.waitUntil()`, and returns `202` immediately — the exact shape
`src/pages/api/internal/ai-ping.ts` proved in production, including its fallback when
`cfContext` is absent. The page server-renders the stored ranking; a React island polls
`GET /api/rankings?jobId=…` and swaps the new list in when the job reaches `done`.

**Failure.** A failed run never writes to `rankings`. The stored ranking stays on screen and
the banner reports the failure with a retry. A first-ever failure, with nothing stored,
gets an explanatory state — not a stack trace, not an empty list.

## Critical Implementation Details

**OpenAI strict mode has no concept of an optional field.** Every property in a structured-
output schema must be present in `required`, so a field that may be absent must be modelled
as `.nullable()`, not `.optional()`. This matters for `contextNote` and `rhythmNote`, both
of which are legitimately absent for some people — and `rhythmNote` is *always* null when
the user left `S-09`'s rhythm fields empty. Getting this wrong surfaces as an API-level
schema rejection, not a parse failure, so it fails the whole call rather than one field.

**The model can return person ids that were not sent.** `responses.parse()` validates
shape, never referential integrity. The returned entry list must be reconciled against the
set of people actually sent before anything is written: drop ids that were not in the
input, and append any person the model omitted at the tail in weight order. Without this
reconciliation a hallucinated id becomes a foreign-key violation at insert time, and a
silently dropped person disappears from the user's screen with no trace.

**The rhythm section is omitted from the prompt, not defaulted.** When
`weekly_time_budget` is null and both rhythm arrays are empty, the prompt must not mention
rhythm at all, and the schema's `rhythmNote` must be forced to null rather than left to the
model. `S-09` made these fields optional on the explicit promise that `S-02` degrades
gracefully; a model told "no stated preference" will still produce a confident-sounding
`Twój rytm` claim grounded in nothing.

**Cloudflare's 10ms CPU limit is CPU time, not wall time.** Waiting on the OpenAI response
is I/O and does not count against it, which is why `F-02`'s approach works at all. What
does count is parsing and reconciling the response — bounded by the 50-person cap. The
50-subrequest ceiling is shared across the request and its `waitUntil` continuation: one
OpenAI call plus a handful of Supabase round-trips leaves ample headroom, but Phase 4 must
record the real numbers rather than assume it.

---

## Phase 1: Ranking schema and generated types

### Overview

Add the two tables the ranking is stored in, wired into `F-01`'s isolation pattern, and
regenerate the typed database client so Phases 2–3 compile against real types.

### Changes Required:

#### 1. Ranking tables migration

**File**: `supabase/migrations/<timestamp>_create_rankings_tables.sql`

**Intent**: Create the durable home for a computed ranking. Two tables rather than one, so
a run's metadata (when, which model, how many people it could see) is separable from its
entries — which is what lets the banner state "przeliczona o 14:32 na podstawie 14 osób"
and what gives `S-03` a stable row to attach feedback to.

**Contract**: Follows `20260824192356_create_people_table.sql` exactly — RLS enabled, four
explicit policies per table scoped `to authenticated` with `(select auth.uid()) = owner_id`,
plus the explicit table-level GRANTs the `20260830101704` migration's comment established
as necessary in this project. `owner_id` is denormalized onto `ranking_entries` so its
policies need no join.

```sql
create table public.rankings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  model text not null,
  -- People actually sent to the model vs. people the user has. Unequal when the
  -- 50-person cap truncated the input; the UI says so rather than hiding it.
  people_considered smallint not null,
  people_total smallint not null
);

create table public.ranking_entries (
  id uuid primary key default gen_random_uuid(),
  ranking_id uuid not null references public.rankings (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  -- Not `position`: that is a Postgres function name and reads ambiguously in queries.
  rank_position smallint not null,
  time_window text not null
    check (time_window in ('this_week', 'two_weeks', 'this_month', 'no_rush')),
  reason text not null check (char_length(reason) <= 400),
  context_note text check (char_length(context_note) <= 60),
  -- Null whenever the owner left S-09's rhythm fields empty. Not defaulted.
  rhythm_note text check (char_length(rhythm_note) <= 60),
  unique (ranking_id, rank_position)
);
```

Indexes: `rankings (owner_id, created_at desc)` for the "latest run" lookup, and
`ranking_entries (ranking_id, rank_position)` for ordered reads.

`ON DELETE CASCADE` on both `owner_id` FKs is a deliberate decision per `lessons.md`, not
inherited from `people` — rationale in "Implementation Approach".

#### 2. Regenerated database types

**File**: `src/db/database.types.ts`

**Intent**: Give `createClient<Database>` knowledge of the two new tables so every query in
Phases 2–3 is type-checked.

**Contract**: Regenerated wholesale via `npm run db:types` against the local stack. Never
hand-edited.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a reset local stack: `supabase db reset`
- Types regenerate and contain both new tables: `npm run db:types`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- The existing isolation proof still passes: `npm run verify:rls`

#### Manual Verification:

- In Supabase Studio, confirm RLS is enabled on both tables and that four policies exist on
  each, matching the shape of the `people` policies.
- Confirm deleting a test user from `auth.users` removes their `rankings` and
  `ranking_entries` rows.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Ranking contract, prompt assembly, and the call path

### Overview

Everything between "a user asks for a ranking" and "a ranking row exists": the enum and its
Polish labels, the zod output schema, prompt assembly with the cap and the rhythm-omission
rule, reconciliation and persistence, and the two API routes that wrap it in `F-02`'s
proven non-blocking shape. At the end of this phase the feature works end to end via
`curl`; only the UI is missing.

### Changes Required:

#### 1. Time-window enum and AI output schema

**File**: `src/lib/validation/ranking.ts`

**Intent**: Define the one contract both the model and the UI answer to — the time-window
enum with its Polish copy, and the zod schema the model's response is validated against.

**Contract**: Exports `TIME_WINDOW_VALUES` / `TIME_WINDOW_LABELS` / `TIME_WINDOW_OPTIONS`
following the exact triple in `src/lib/validation/profile.ts:11-40`, with values
`this_week` / `two_weeks` / `this_month` / `no_rush` and Polish labels drawn from the design
mock ("Odezwij się w tym tygodniu", "Warto w ciągu 2 tygodni", "W ciągu miesiąca", and a
fourth for the calm tail). Also exports `rankingOutputSchema`, whose shape is the contract
Phase 2's runner and Phase 3's view model both depend on:

```ts
// .nullable() not .optional() — OpenAI strict mode requires every property in `required`,
// so absence must be modelled as an explicit null. See Critical Implementation Details.
const entrySchema = z.object({
  personId: z.string(),
  timeWindow: z.enum(TIME_WINDOW_VALUES),
  reason: z.string(),
  contextNote: z.string().nullable(),
  rhythmNote: z.string().nullable(),
});
export const rankingOutputSchema = z.object({ entries: z.array(entrySchema) });
```

Length caps are enforced after parsing (truncate to the column limits from Phase 1) rather
than expressed in the schema, so an over-long reason degrades to a trimmed string instead
of failing the whole call.

#### 2. Prompt assembly

**File**: `src/lib/ranking/prompt.ts`

**Intent**: Turn a profile row and a people list into the system + user messages sent to the
model, applying the 50-person cap and the rhythm-omission rule.

**Contract**: Exports `PEOPLE_CAP = 50` and a builder taking the profile row and the people
rows and returning the message array plus the ordered list of people actually included
(the caller needs that list for reconciliation). People are sorted by weight descending and
truncated to the cap. The system message states the task, the scale of `weight` (1–10), that
ties must be broken on description context rather than left arbitrary, that every person
sent must appear exactly once in the output, and that `reason` is written in Polish,
addressed to the user, and grounded only in facts present in the input. The user message
carries the profile (name, age derived from `birth_date`, life context) and the people
(name, relationship type, collective marker, description, weight, id).

The rhythm block is appended only when at least one of `weekly_time_budget`,
`preferred_channels`, `availability_windows` is populated. When none are, the block is
absent and the system message instructs that `rhythmNote` must be null.

#### 3. Ranking store

**File**: `src/lib/ranking/store.ts`

**Intent**: The single place that reads and writes rankings, so `dashboard.astro` and the
poll route assemble the same view model from the same query rather than drifting apart.

**Contract**: Exports `STALE_AFTER_MS` (24h) plus three functions over an injected Supabase
client: load the latest ranking for an owner as a view model (run metadata + entries joined
to their people, ordered by `rank_position`), report whether that ranking is stale or
absent, and persist a validated ranking (insert the `rankings` row, then its
`ranking_entries` rows, in that order). Returns `null` when the owner has no ranking yet.
The exported view-model type is what Phase 3's components take as props.

#### 4. Job runner

**File**: `src/lib/ranking/run.ts`

**Intent**: The background task itself — fetch inputs, call the model, reconcile, persist,
and report terminal status — kept out of the route so the route stays a thin auth-and-
dispatch shell like `ai-ping.ts`.

**Contract**: A single exported async function taking the owner id, a Supabase client and a
job id. Loads the profile and people, builds the prompt, calls
`openai.responses.parse({ model: RANKING_MODEL, input, text: { format: zodTextFormat(...) } })`
with `RANKING_MODEL = "gpt-5.4-mini"` exported as a named constant, reconciles
`output_parsed.entries` against the people sent (drop unknown ids, append omitted people at
the tail in weight order — see Critical Implementation Details), truncates the text fields
to their column limits, persists via the store, and writes the terminal KV job status.

Every failure path — no API key, OpenAI error, `output_parsed` null — is caught, logged with
a `[ranking]` prefix mirroring `ai-ping.ts:34`, and written as a `failed` job. Nothing is
written to `rankings` on a failure, so the previous ranking survives untouched.

#### 5. Job payload extension

**File**: `src/lib/ai-jobs.ts`

**Intent**: Let a completed job point at the ranking it produced, so the poll route can
return the fresh ranking without guessing.

**Contract**: Add an optional `rankingId?: string` to the existing `AiJob` interface. No
change to `readJob` / `writeJob` / the TTL, and `ai-ping.ts` is unaffected.

#### 6. Ranking API routes

**File**: `src/pages/api/rankings.ts`

**Intent**: The trigger and the poll. `POST` starts a run unless a fresh one already exists;
`GET` reports job status and hands back the new ranking once it lands.

**Contract**: Copies the `json()` helper, the 401-not-redirect posture and the
`cfContext.waitUntil` + `void work` fallback from `src/pages/api/internal/ai-ping.ts`
verbatim in shape.

- `POST` accepts an optional `{ force?: boolean }` body. Returns `200 { jobId: null,
  reason: "fresh" }` when a ranking exists, is not stale, and `force` is not set — so an
  ordinary page load costs no OpenAI call. Otherwise writes a `pending` job, dispatches
  through `waitUntil`, and returns `202 { jobId }`.
- A per-owner in-flight guard key in KV stops a double page load firing two concurrent
  runs; a `POST` arriving while one is in flight returns that job's id rather than starting
  another.
- `GET` requires a `jobId` query parameter and returns the job status, plus the freshly
  loaded ranking view model when the status is `done`.

Both methods 401 for an unauthenticated caller.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- `POST /api/rankings` on a locally running dev server returns `202` with a job id in well
  under the time a real OpenAI round-trip takes
- Polling `GET /api/rankings?jobId=…` reaches `done` and returns a ranking whose entry
  count equals the number of people on the account
- A second `POST` immediately afterwards returns `200` with `reason: "fresh"`, not a new job
- `POST` with `{ force: true }` starts a new run despite the fresh ranking

#### Manual Verification:

- Two people given the same weight but materially different descriptions land in different
  positions, and the `reason` text names the context that separated them — the `US-01`
  acceptance criterion this slice exists to satisfy.
- Every `reason` reads as natural Polish addressed to the user, and asserts nothing that
  was not in the input (no invented dates, no invented last-contact).
- With all three rhythm fields empty on the profile, every entry's `rhythm_note` is null.
- With rhythm fields filled, `rhythm_note` reflects what was actually selected.
- Temporarily unsetting `OPENAI_API_KEY` in `.dev.vars` produces a `failed` job with a
  readable error and leaves the previously stored ranking intact in the database.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 3: The Dziś hierarchy view

### Overview

Replace `/dashboard`'s placeholder with the real screen: the refresh banner, the expanded
top-three cards, the collapsed tail, the two empty states, and the polling that swaps a
finished ranking in without a reload.

### Changes Required:

#### 1. Hierarchy card

**File**: `src/components/hierarchy/HierarchyCard/` (`HierarchyCard.tsx`, `types.ts`, `index.ts`)

**Intent**: Render one ranked entry in either of its two forms — expanded, with the
"Dlaczego teraz" paragraph and factor chips, or collapsed to a single row with a `Rozwiń`
affordance.

**Contract**: Folder-per-component with a separate `types.ts` and barrel `index.ts`, per
`lessons.md`. Props are one entry from the store's view model plus its rank number and an
expanded/collapsed state. Chips render only for the factors this slice has data for:
relationship weight (reusing `src/components/people/WeightIndicator`), the model's
`contextNote`, and `rhythmNote` — each omitted entirely when null, never shown as an empty
or placeholder chip. No `Ostatni kontakt`, no `Poprzednia próba`, no action buttons.

#### 2. Refresh banner

**File**: `src/components/hierarchy/RefreshBanner/` (`RefreshBanner.tsx`, `types.ts`, `index.ts`)

**Intent**: Tell the user how current the order is and let them force a recompute — the
mock's "Kolejność odświeżona … Przelicz teraz" strip.

**Contract**: Four states, driven by props: *fresh* (states when it was computed and on how
many people, using `people_considered` / `people_total` from the run row so a truncated
input is stated honestly), *refreshing*, *failed with a stored ranking* (reports the failed
refresh, offers retry, and makes clear the shown order is the previous one), and *failed
with nothing stored*. The action button posts to `POST /api/rankings` with `force: true`.

#### 3. Hierarchy view island

**File**: `src/components/hierarchy/HierarchyView/` (`HierarchyView.tsx`, `types.ts`, `index.ts`)

**Intent**: Own the interactive behaviour — the stale-on-mount trigger, polling, expanding a
collapsed entry, and swapping in a finished ranking.

**Contract**: Takes the server-rendered ranking view model and a `staleOnLoad` boolean as
props. On mount, fires `POST /api/rankings` when `staleOnLoad` is set, then polls
`GET /api/rankings?jobId=…` on a bounded interval until a terminal status. It renders the
existing ranking throughout — never a skeleton over a ranking that already exists. Only a
first-ever run with nothing stored shows a loading state. Expands the top three by default;
everything below is collapsed until clicked. The tail beyond the expanded entries is
summarised in the mock's calm-tail phrasing, with the count taken from real data.

Polling must stop on unmount and after a terminal status, and must give up after a bounded
number of attempts rather than polling forever — a job whose Worker died never reaches a
terminal state, and the KV read is eventually consistent (`scripts/verify-openai-call.ts:22-26`
documents the up-to-60s staleness window this has to tolerate).

#### 4. Hierarchy empty states

**File**: `src/components/hierarchy/HierarchyEmptyState/` (`HierarchyEmptyState.tsx`, `types.ts`, `index.ts`)

**Intent**: Cover the two reachable states where no ranking can exist, each with a route out
rather than a dead end.

**Contract**: Modelled on `src/components/people/EmptyState/EmptyState.tsx` — icon,
heading, one line of explanation, one primary action. Two variants: *no profile* (reachable
because `src/middleware.ts:5` gates only `/people` on profile existence) pointing at
`/profile`, and *no people* pointing at `/people/new`. The no-people variant is the
`US-01` acceptance criterion "a user with no people added sees an explanatory empty state,
not an error or empty list".

#### 5. Dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the placeholder "Panel" card with the hierarchy, server-rendering the
stored ranking so the screen is useful on first paint.

**Contract**: Keeps the existing `AppShell` usage and `loadProfileName` call. Loads the
profile and the latest ranking through Phase 2's store, picks between the two empty states
and the hierarchy, and passes the view model plus a computed `staleOnLoad` into
`<HierarchyView client:load />`. Page title and heading move to the mock's "Kto teraz czeka
na Twój telefon" framing. `peopleCount` can now be passed to `AppShell` at no extra cost
since the ranking query already knows it — note this changes the comment at
`src/pages/dashboard.astro:8`, which currently justifies omitting it.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- A user with a profile and several people sees the ranked list on first paint, with the top
  three expanded and the rest collapsed.
- `Rozwiń` on a collapsed entry reveals its reason and chips.
- "Przelicz teraz" shows the refreshing state, and the new order swaps in without a page
  reload while the old order stays readable throughout.
- Reloading the page mid-refresh, or navigating away and back, still ends with the new
  ranking visible — the "left and came back" promise `F-02` was built for.
- A user with no `profiles` row sees the no-profile state and reaches `/profile` from it.
- A user with a profile and zero people sees the no-people state, not an error.
- With `OPENAI_API_KEY` unset, a first-ever run shows the explanatory failure state; a user
  who already had a ranking still sees it, with the banner reporting the failed refresh.
- The layout holds on a narrow mobile viewport, matching the mock's mobile column, with the
  bottom nav not overlapping the last card.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Production verification against real limits

### Overview

Prove the whole path on a deployed Worker rather than `astro dev`, and record the real
token, latency and subrequest numbers so the 50-person cap is a measured property instead
of a guess. `lessons.md` is explicit that a clean local run proves nothing about
Cloudflare's production ceilings.

### Changes Required:

#### 1. Verification script

**File**: `scripts/verify-ranking.ts`

**Intent**: A standalone check that a deployed Worker computes and persists a ranking
without blocking the response, and that the result satisfies `US-01`'s structural criteria.

**Contract**: Follows `scripts/verify-openai-call.ts` — `assert()` + `failures[]`, non-zero
exit on failure, refuses localhost URLs, signs in through `/api/auth/signin` and reuses the
returned cookie jar, credentials from `VERIFY_EMAIL` / `VERIFY_PASSWORD`. Sends
`Content-Type: application/json` on the `POST` to `/api/rankings`, without which Astro's
pre-routing origin check returns a 403 that never reaches the handler (`lessons.md`).

Assertions: unauthenticated callers are rejected; a forced `POST` returns before a real
OpenAI round-trip could have completed; polling reaches `done`; the returned ranking
contains one entry per person on the account; every entry has a time window from the enum
and a non-empty reason; a non-forced `POST` immediately afterwards reports `fresh`. Logs the
observed response time, poll-to-`done` duration and entry count so the numbers are on the
record.

#### 2. Script registration

**File**: `package.json`

**Intent**: Make the check runnable the same way as the other two.

**Contract**: Add `"verify:ranking": "tsx scripts/verify-ranking.ts"` alongside
`verify:rls` and `verify:ai-call`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- A preview version uploads: `npm run preview:upload`
- `npm run verify:ranking -- <preview-url>` exits zero with every assertion passing

#### Manual Verification:

- Confirm `OPENAI_API_KEY` is set in production: `wrangler secret list`
- Observed token usage and latency for a full-cap (or largest available) account are
  recorded in the change folder, and the headroom against Cloudflare's 50-subrequest and
  10ms-CPU limits is stated explicitly.
- The deployed `/dashboard` is used by hand end to end — sign in, view, force a recompute,
  leave and return — and behaves as it did locally.

**Implementation Note**: This is the final phase. After it passes, the manual-verification
items still outstanding go into the Linear issue comment per `lessons.md`.

---

## Testing Strategy

The repo has no test framework, and this plan does not introduce one — the two existing
verification precedents (`scripts/verify-rls.ts`, `scripts/verify-openai-call.ts`) are the
established pattern and Phase 4 extends it.

### Automated (script + type/lint/build):

- Isolation is unchanged: `npm run verify:rls` still passes after the new tables land.
- The full ranking path against a deployed Worker: `npm run verify:ranking`.
- `npx astro check`, `npm run lint`, `npm run build` at every phase boundary.

### Manual scenarios (the ones a script cannot judge):

1. **Tie-breaking** — two people, same weight, different descriptions. They must not be
   adjacent-arbitrary, and the reason must name the differentiator. This is the acceptance
   criterion that decides whether the feature works.
2. **Prose quality** — reasons are natural Polish, addressed to the user, and free of
   invented facts. Read every entry on a real account at least once.
3. **Empty states** — no profile, and profile-with-no-people.
4. **Failure with and without a stored ranking**, via an unset API key.
5. **Rhythm degradation** — the same account with rhythm fields empty and filled.
6. **Leave-and-return during a refresh**, which is the promise `F-02` exists to keep.
7. **Mobile viewport**, against the mock's mobile column.

## Performance Considerations

One OpenAI call per user per 24h staleness window, plus forced recomputes. Prompt size is
bounded by the 50-person cap; at 500 chars of description per person the input stays well
inside the model's context with room to spare. The response is bounded by the same cap.

Page load cost: `dashboard.astro` adds the profile query, the latest-ranking query (a join
across `rankings`, `ranking_entries` and `people`) and the existing `loadProfileName` call.
The `rankings (owner_id, created_at desc)` index keeps the latest-run lookup a single
indexed read.

The relevant Cloudflare ceilings are the 50-subrequest limit shared between a request and
its `waitUntil` continuation, and the 10ms CPU limit — which the OpenAI wait does not
consume, being I/O. Phase 4 records the actual figures rather than leaving this as an
assumption.

## Migration Notes

Forward-compatible per `CLAUDE.md`: this migration only adds tables. A rollback of the
Worker to a pre-`S-02` version leaves two unused tables behind, which nothing reads and
which break nothing. No existing column is altered or dropped, so no deploy-ordering
constraint applies.

`ranking_entries.person_id` cascades on person deletion, which matters once `S-05` ships a
delete path: removing a person removes their entries from past rankings rather than leaving
orphaned rows. `S-05` should confirm that is still the behaviour it wants when it plans.

## References

- Roadmap slice: `context/foundation/roadmap.md` (`S-02`, line 175)
- PRD: `context/foundation/prd.md` — `US-01` (line 79), `FR-007` (line 112), `FR-002` (line 97)
- Prior slice this builds on: `context/changes/openai-ranking-call-path/plan.md` (`F-02`)
- Rhythm-field contract and its degradation promise: `context/changes/self-profile-rhythm-fields/change.md`
- Reference implementation for the async shape: `src/pages/api/internal/ai-ping.ts`
- Verification-script precedent: `scripts/verify-openai-call.ts`
- Enum + Polish-label convention: `src/lib/validation/profile.ts:11-40`
- Design mock, section 3 "Hierarchia kontaktów": `.ai/intouch-design-preparation/project/InTouch.dc.html:186-400`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Ranking schema and generated types

#### Automated

- [x] 1.1 Migration applies cleanly against a reset local stack: `supabase db reset` — c5a73a4
- [x] 1.2 Types regenerate and contain both new tables: `npm run db:types` — c5a73a4
- [x] 1.3 Type checking passes: `npx astro check` — c5a73a4
- [x] 1.4 Linting passes: `npm run lint` — c5a73a4
- [x] 1.5 The existing isolation proof still passes: `npm run verify:rls` — c5a73a4

#### Manual

- [x] 1.6 RLS enabled with four policies on each new table, matching the `people` shape — c5a73a4
- [x] 1.7 Deleting a test user removes their `rankings` and `ranking_entries` rows — c5a73a4

### Phase 2: Ranking contract, prompt assembly, and the call path

#### Automated

- [x] 2.1 Type checking passes: `npx astro check`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 `POST /api/rankings` returns `202` with a job id well under an OpenAI round-trip
- [x] 2.4 Polling `GET /api/rankings?jobId=…` reaches `done` with one entry per person
- [x] 2.5 An immediate second `POST` returns `200` with `reason: "fresh"`
- [x] 2.6 `POST` with `{ force: true }` starts a new run despite the fresh ranking

#### Manual

- [x] 2.7 Same-weight people land in different positions and the reason names the differentiator
- [x] 2.8 Every reason is natural Polish and asserts nothing absent from the input
- [x] 2.9 With rhythm fields empty, every `rhythm_note` is null
- [x] 2.10 With rhythm fields filled, `rhythm_note` reflects the actual selections
- [x] 2.11 An unset API key yields a `failed` job and leaves the stored ranking intact

### Phase 3: The Dziś hierarchy view

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.4 Ranked list on first paint, top three expanded, rest collapsed
- [ ] 3.5 `Rozwiń` reveals a collapsed entry's reason and chips
- [ ] 3.6 "Przelicz teraz" swaps the new order in without a reload, old order readable throughout
- [ ] 3.7 Reloading or navigating away mid-refresh still ends with the new ranking visible
- [ ] 3.8 No-profile state renders and links to `/profile`
- [ ] 3.9 No-people state renders instead of an error
- [ ] 3.10 Failure states correct both with and without a stored ranking
- [ ] 3.11 Mobile viewport holds, bottom nav does not overlap the last card

### Phase 4: Production verification against real limits

#### Automated

- [ ] 4.1 Linting passes: `npm run lint`
- [ ] 4.2 A preview version uploads: `npm run preview:upload`
- [ ] 4.3 `npm run verify:ranking -- <preview-url>` exits zero

#### Manual

- [ ] 4.4 `wrangler secret list` confirms `OPENAI_API_KEY` is set in production
- [ ] 4.5 Observed tokens, latency and subrequest headroom recorded in the change folder
- [ ] 4.6 Deployed `/dashboard` used by hand end to end and behaves as it did locally
