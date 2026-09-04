# Did-It-Happen Feedback Loop Implementation Plan

## Overview

Close the product's central loop. Today the app suggests who to contact and the user acts,
but nothing comes back — `src/lib/ranking/prompt.ts` is structurally blind to whether any
suggestion was ever followed, and its system message explicitly forbids the model from
mentioning contact history at all. This slice adds a durable, person-centric record of
whether a suggested contact happened, surfaces a one-tap marker on the hierarchy card, and
feeds deterministic facts derived from that record back into the ranking prompt — so the
next ranking demonstrably reflects the answer.

This is roadmap slice `S-03`, the declared north star, and it satisfies `FR-009` plus the
fourth acceptance criterion of `US-01` ("the hierarchy takes into account time since the last
(un)successful contact").

## Current State Analysis

**What exists.** `S-02` shipped the full ranking path: an owner-scoped `rankings` +
`ranking_entries` pair (`supabase/migrations/20260901120000_create_rankings_tables.sql`), a
prompt builder, a background run function, a JSON API with KV-backed job polling, and a
React island rendering the result.

- `src/lib/ranking/prompt.ts:119-138` — `buildRankingPrompt(profile, people)` takes exactly
  two inputs. There is no third parameter and no call site that could supply one.
- `src/lib/ranking/prompt.ts:56` — the system message instructs the model, verbatim:
  *"opieraj się WYŁĄCZNIE na faktach obecnych w danych wejściowych — nie wymyślaj dat,
  historii kontaktu ani żadnych szczegółów, których nie podano."* Correct while no history
  exists; it is the single line this slice must rewrite.
- `src/lib/ranking/run.ts:87-99` — fetches profile and people in one `Promise.all`, then
  calls `buildRankingPrompt`. This is where a third fetch and a third argument land.
- `src/components/hierarchy/HierarchyCard/HierarchyCard.tsx` — collapsed and expanded
  variants. Expanded renders `Dlaczego teraz`, a `WeightIndicator`, and the optional
  `contextNote` / `rhythmNote` chips. No actions, no history chips.
- `src/components/hierarchy/HierarchyView/HierarchyView.tsx` — owns stale-on-mount
  dispatch, polling, expand/collapse state, and the `RefreshBanner`.
- `src/pages/api/rankings.ts` — the JSON route precedent: `json()` helper, `context.locals.user`
  auth check, `createClient(...)` 503 fallback.

**What is missing.** No contact-history table of any kind. `ranking_entries` has no column
for an answer, and would be the wrong home for one regardless: entries are per-run and a new
row set is written on every recompute, while `FR-005` requires a person's history to survive
their *deactivation*.

**Key constraints discovered.**

- `wrangler rollback` reverts code but not the database (`CLAUDE.md`), so the migration must
  be forward-compatible — additive only, no column any currently-deployed code requires.
- `lessons.md` requires an explicit `ON DELETE CASCADE` decision per new owner-scoped table.
- `lessons.md` requires every non-browser JSON caller to send `Content-Type: application/json`,
  or Astro's origin-check middleware returns 403 before routing.
- `lessons.md` requires config through `astro:env/server` and bindings through
  `cloudflare:workers` — this slice adds neither.
- `lessons.md`: a phase producing visible UI cannot be proved by `astro check` / lint / build.
  `S-06` shipped three broken phases that way.
- The repo has no test framework. Verification precedent is standalone `tsx` scripts run
  against a **deployed** Worker (`scripts/verify-rls.ts`, `verify-openai-call.ts`,
  `verify-ranking.ts`).
- `src/components/ui/` contains exactly one primitive (`button.tsx`). A sheet must be added
  via `npx shadcn add`.
- `src/components/layout/Toaster` exposes only `showToast(variant, message)` — no action slot.

### Key Discoveries:

- The seam `S-02` left is real but incomplete: its note says "attach a yes/no answer to an
  entry", yet `ranking_entries` cannot outlive a recompute. Storage must be person-centric,
  with the ranking-entry link kept only as optional provenance.
- The design bundle uses a *failed* attempt as an urgency **amplifier**
  (`.ai/intouch-design-preparation/project/InTouch.dc.html:1109`: "Poprzednia próba nie udała
  się — przesunięta z kwietnia", listed under "Dlaczego akurat teraz"), not as a snooze.
- `S-02` established the governing pattern for user-visible facts: time windows are enum
  buckets with a Polish label map, **never** model-authored prose
  (`src/lib/validation/ranking.ts:1-21`). The history chips follow the same rule — they render
  from the database, never from `reason`.
- `RefreshBanner.tsx:39` already treats `peopleConsidered < peopleTotal` as a legitimate
  state to surface rather than hide. The "your answer lands in the next recompute" line is
  the same posture applied to a new fact.
- OpenAI strict mode requires every property in `required`, so optional model output fields
  are `.nullable()` and never `.optional()` (`src/lib/validation/ranking.ts:23-33`). This
  slice adds no model output fields, so the existing schema is untouched.

## Desired End State

A signed-in user with a filled profile and at least one person opens `/dashboard` and sees the
ranked list as today. Each card now offers `Tak, rozmawialiśmy` / `Jeszcze nie`. One tap
records the answer; the card confirms in place, shows a freshly-rendered `Ostatni kontakt`
chip, and offers an optional note. A line in `RefreshBanner` states that the order will update
on the next recompute, with `Przelicz teraz` available for anyone who wants it immediately.
When that recompute runs, the prompt carries per-person facts (days since the last successful
contact, whether the last attempt failed, how many attempts have failed since, and the most
recent notes) and the resulting order and `Dlaczego teraz` text reflect them. `/people` shows
a last-contact line on every card, and a per-person history sheet lists every recorded event
with edit and delete.

**How to verify:** `npm run verify:feedback-loop -- <deployed-url>` exits zero, having proved
the write path, cross-account isolation, and that a recompute after a mark produces a ranking
whose reasons cite the recorded history. Plus the manual passes listed per phase.

## What We're NOT Doing

- **No reminders and no reminder settings.** Email delivery, cadence, and the "3 dni po
  terminie" mail in the design are `S-04`, still blocked on `F-04`.
- **No user-declared intent.** The design's `Zaplanowałam kontakt` button and the due-date it
  implies are not built. "After its intended date" (`FR-009`) is satisfied by the app's own
  suggested time window, not by a date the user declares. No `intents` table, no due dates.
- **No snooze.** `Odłóż o tydzień` is not built. `Jeszcze nie` records a failed attempt that
  raises urgency; it never suppresses or downranks.
- **No recompute triggered by marking.** The stored ranking is not invalidated, not flagged,
  and no OpenAI call fires on a mark. The existing 24h stale-on-view rule and the manual
  `Przelicz teraz` button remain the only two triggers, exactly as `S-02` shipped them.
- **No `/people/[id]` route.** History lives in a sheet. The person-detail page belongs to
  `S-05` along with edit / deactivate / delete.
- **No backdating UI.** `occurred_at` is always the server time at marking. The column is a
  real `timestamptz` so a picker is a purely additive change later.
- **No person editing, deactivation, or deletion** (`S-05`), **no categories/tabs** (`FR-006`),
  **no changes to `/profile`**, **no scheduled recompute**, **no new KV namespace or binding**,
  **no test framework**, **no changes to the model or the ranking output schema.**

## Implementation Approach

Five phases, ordered so each one is independently provable and the riskiest work lands first.

Storage is a single append-only-by-default table, `contact_events`, owner-scoped under the
same RLS contract every table in this repo uses. Reads go through one module,
`src/lib/contact-history/facts.ts`, which folds raw events into a per-person facts object.
That module has exactly two consumers: the prompt builder (which serializes facts into the
model input) and the UI (which renders chips from the same facts). Both read the same derived
values, so a chip can never disagree with what the model was told.

The model's job is unchanged — it still ranks and still writes `reason`. What changes is that
it now receives history as structured input and is told to weigh recency and failed attempts.
Nothing about the order is computed in code, so `US-01`'s claim that context breaks ties stays
the model's to keep.

## Critical Implementation Details

**The system message's prohibition must be narrowed, not deleted.** `prompt.ts:56` currently
forbids the model from referencing contact history *at all* — the correct instruction while no
history existed. Deleting the clause outright reopens exactly the fabrication risk it was
written to close (a model inventing "wasn't in touch since spring"). The rewrite must keep the
"invent nothing" half and scope the prohibition to facts *not supplied*, while explicitly
permitting the history block that is now present. When a person has no recorded events, their
history block is omitted entirely and the model must not infer one — the same
omission-not-defaulting rule `S-02` established for the rhythm section (`prompt.ts:41-47`,
`buildSystemMessage`'s `rhythmIncluded: false` branch).

**Recompute is deliberately not triggered by a mark.** Because of that, the acknowledgment on
the card is the *only* immediate evidence the loop worked. If the confirmed state or the
`RefreshBanner` line is dropped as polish, the user taps and observes nothing change, which is
precisely the "empty loop" failure `roadmap.md` names as this slice's principal risk. Treat
both as load-bearing, not decoration.

**A foreign key is not an authorization check.** `contact_events.person_id` references
`people(id)`, and Postgres validates that reference without applying RLS. The table's own
`with check` clause tests `owner_id` only. Any endpoint accepting a `person_id` from a request
body must therefore verify the person belongs to the caller itself — the schema will not do it.

**Notes reaching the prompt are a new untrusted input surface.** Free text authored after the
person was created now flows into the model input. Bound it at the schema (200 chars), cap how
many notes per person are serialized (most recent two), and keep them inside the clearly
labelled history block so they read as user-supplied context rather than instructions.

---

## Phase 1: Schema, derived facts, and the write path

### Overview

Create the `contact_events` table with its RLS contract, regenerate DB types, build the module
that folds events into per-person facts, and expose the create endpoint. No UI. Everything in
this phase is provable by script.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260902<HHMMSS>_create_contact_events_table.sql`

**Intent**: Give the app a durable, person-centric record of whether a suggested contact
happened, which survives every ranking recompute and every person deactivation. Mirrors the
RLS shape of `20260901120000_create_rankings_tables.sql` exactly — four owner-scoped policies
plus the same `grant` pair — so the isolation contract is uniform across the schema.

**Contract**: New table `public.contact_events`:

| column | type | notes |
| --- | --- | --- |
| `id` | `uuid` pk | `default gen_random_uuid()` |
| `owner_id` | `uuid not null` | → `auth.users(id)` **`on delete cascade`** |
| `person_id` | `uuid not null` | → `public.people(id)` **`on delete cascade`** |
| `ranking_entry_id` | `uuid null` | → `public.ranking_entries(id)` `on delete set null` — provenance only |
| `occurred_at` | `timestamptz not null` | `default now()` |
| `outcome` | `text not null` | `check (outcome in ('happened', 'not_yet'))` |
| `note` | `text null` | `check (char_length(note) <= 200)` |
| `created_at` | `timestamptz not null` | `default now()` |

Index `(owner_id, person_id, occurred_at desc)` — serves both the per-person facts fold and
the history sheet's listing. `enable row level security`, four policies named
`contact_events_{select,insert,update,delete}_own` using `(select auth.uid()) = owner_id`,
`grant select on ... to anon` and `grant select, insert, update, delete on ... to authenticated`.

Both `on delete cascade` choices are deliberate per `lessons.md` and are recorded in a header
comment: the PRD's erasure NFR is binary, and a `note` is free text about a third party, so
retaining events after the person or the account is deleted would be a stated regression.
`ranking_entry_id` is `set null` instead, so history survives a ranking's own lifecycle.

Forward-compatible by construction: a new table only, nothing existing altered.

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate so `Tables<"contact_events">` is available to every consumer.

**Contract**: `npm run db:types` after the migration applies locally. Committed, never
hand-edited.

#### 3. Derived facts module

**File**: `src/lib/contact-history/facts.ts`

**Intent**: The single place raw events become the facts both the prompt and the UI consume.
One query, folded in memory — a view or RPC would be a second schema surface for a dataset
this small, and would still need the same shape in TypeScript.

**Contract**: Other phases depend on this signature.

```ts
export interface ContactFacts {
  lastHappenedAt: string | null;        // ISO, most recent outcome='happened'
  daysSinceLastHappened: number | null; // null when never
  lastAttemptFailed: boolean;           // most recent event overall is 'not_yet'
  failedAttemptsSinceLastHappened: number;
  recentNotes: string[];                // newest first, max 2, from any outcome
}

export const RECENT_NOTES_PER_PERSON = 2;

export async function loadContactFacts(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<Map<string, ContactFacts>>;   // keyed by person_id; absent = no history
```

A person with no events is **absent from the map**, never present with zeroed fields — callers
must distinguish "never contacted" from "contacted zero days ago". This mirrors the
rhythm-omission rule `S-02` set.

#### 4. Create endpoint

**File**: `src/pages/api/contact-events.ts`

**Intent**: Record one answer. Follows `src/pages/api/rankings.ts`'s JSON-route shape exactly:
local `json()` helper, `context.locals.user` 401, `createClient` 503, never a redirect.

**Contract**: `POST /api/contact-events` with JSON body
`{ personId, outcome: 'happened' | 'not_yet', note?: string | null, rankingEntryId?: string | null }`.
Body validated by a new zod schema in `src/lib/validation/contact-event.ts` (following
`src/lib/validation/person.ts`'s export shape: schema + inferred type + label maps). Returns
`201` with the created row plus that person's recomputed `ContactFacts`, so the client can
render the new chip without a second round-trip. `owner_id` is taken from the session, never
from the body. Invalid body → `400` with a Polish message.

**`person_id` must be verified as the caller's own before the insert** — select the person by
id through the caller's RLS-scoped client and return `404` when it is absent, reusing the
404-not-403 rule this slice applies to `[id].ts`. This is not covered by the table's own
policies: `contact_events`'s `with check` tests only `owner_id`, and Postgres does not apply
RLS when validating a foreign key, so a `person_id` belonging to another account would
otherwise insert cleanly and produce a row whose person resolves to nothing under the owner's
own RLS — silently corrupting the facts fold.

`GET` is added to this same file in Phase 4; do not stub it here.

#### 5. Note-attachment endpoint

**File**: `src/pages/api/contact-events/[id].ts`

**Intent**: Let the optional note attach to an event that has *already* been recorded, so the
answer can commit on its own tap. Phase 3's marker depends on this; without it the note would
have to ride on the initial POST and the "answer commits alone" decision would be lost.

**Contract**: `PATCH /api/contact-events/[id]` with JSON body `{ note: string | null }`,
validated by the same zod schema module as the POST. Scoped by `owner_id` from the session in
addition to RLS, returning `404` (never `403`) for a row the caller does not own, so the
endpoint leaks nothing about existence. Returns the person's recomputed `ContactFacts`.

`DELETE`, and extending `PATCH` to accept `outcome`, land in Phase 4 — do not build them here.

#### 6. RLS proof extension

**File**: `scripts/verify-rls.ts`

**Intent**: Extend the existing local isolation proof to the new table, so `contact_events`
carries the same evidence `people` and `profiles` already do.

**Contract**: A third block mirroring the existing two — user A inserts an own event, sees it,
cannot select / update / delete user B's, B's row survives A's attempt, and the anon client
sees nothing.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a local Supabase: `supabase db reset`
- Generated types include `contact_events`: `npm run db:types` produces no diff on a second run
- RLS isolation proof passes for the new table: `npm run verify:rls`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- A `POST /api/contact-events` from a signed-in browser session returns `201` with the row and the facts object
- The same POST with another user's `personId` fails rather than writing a row
- A `PATCH /api/contact-events/[id]` attaches a note to an already-created event and returns updated facts
- The same PATCH against another account's event id returns `404`
- Deleting a person removes their contact events (cascade behaves as decided)

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 2: History reaches the ranking

### Overview

Thread the facts through to the model and rewrite the system-message prohibition. After this
phase a recompute produces a ranking that has actually seen the user's answers, even though
nothing in the UI can create one yet except a manual POST.

### Changes Required:

#### 1. Prompt builder

**File**: `src/lib/ranking/prompt.ts`

**Intent**: Serialize each person's facts into the model input and narrow the fabrication
prohibition so supplied history may be cited while invented history stays forbidden.

**Contract**: `buildRankingPrompt(profile, people, facts)` gains a third parameter,
`Map<string, ContactFacts>`. `buildPeopleSection` appends a `Historia kontaktu:` block per
person — omitted entirely when that person is absent from the map, following the existing
`rhythmIncluded` omission pattern (`prompt.ts:41-47, 69-93`). Line 56's clause is rewritten to
permit citing the supplied history block and to keep forbidding anything not supplied.
`buildSystemMessage` gains an instruction that a longer silence and a recent failed attempt
both *raise* urgency — never lower it — and that a person with no history block must not be
described as having any. Notes are serialized under a clear label, capped at
`RECENT_NOTES_PER_PERSON`.

`PEOPLE_CAP = 50` and the weight-ordered truncation are unchanged.

#### 2. Run function

**File**: `src/lib/ranking/run.ts`

**Intent**: Fetch the facts alongside the profile and people and pass them through.

**Contract**: `loadContactFacts` joins the existing `Promise.all` at lines 87-90; its result is
passed as `buildRankingPrompt`'s third argument. No change to `reconcileEntries`,
`persistRanking`, the job lifecycle, or the output schema. A facts-load failure must not
prevent a ranking — an empty map degrades to today's behaviour rather than throwing.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Existing ranking path still passes end-to-end against a deployed preview: `npm run verify:ranking -- <preview-url>`

#### Manual Verification:

- With events recorded for a person, a forced recompute produces a `Dlaczego teraz` for that person that references the recorded history
- A person with no recorded events gets a reason that makes no claim about past contact
- A person whose last attempt failed has that attempt cited in their `Dlaczego teraz`, named as a reason to reach out sooner
- A run for an account with zero contact events produces the same quality of output as before this phase

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: The marker on the hierarchy card

### Overview

The north-star screen. Add the one-tap marker, the optional note, the history chips, the
confirmed-in-place state, and the banner line that promises when the order will update.

### Changes Required:

#### 1. Facts on the dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Load contact facts server-side alongside the ranking so the first paint already
carries the chips, and compute whether any answer has been recorded since the stored ranking
was generated.

**Contract**: `loadContactFacts` joins the existing profile/count `Promise.all` (lines 20-23).
Two new props reach `HierarchyView`: the facts (serialized as a plain object keyed by person
id, since a `Map` does not survive island serialization) and a boolean for "answers recorded
after `ranking.createdAt`".

#### 2. Marker component

**File**: `src/components/hierarchy/ContactMarker/` (`ContactMarker.tsx`, `types.ts`, `index.ts`)

**Intent**: The two-button answer plus the optional note revealed after answering. Folder
layout per `lessons.md`'s component rule.

**Contract**: Props take the person id, the optional ranking-entry id for provenance, current
facts, and a callback invoked with the server's response. Renders `Tak, rozmawialiśmy` /
`Jeszcze nie` (copy from the design bundle), POSTs to `/api/contact-events` with the answer
alone, then swaps to a confirmed state offering a bounded optional note. Submitting that note
PATCHes the event created by the POST (Phase 1 §5) — the answer is already committed by then,
so skipping the note costs nothing and never blocks. Both buttons disable while the
request is in flight; a failure surfaces via `showToast("error", …)` and restores the
unanswered state.

#### 3. History chips

**File**: `src/components/hierarchy/ContactChips/` (`ContactChips.tsx`, `types.ts`, `index.ts`)

**Intent**: Render `Ostatni kontakt` and `Poprzednia próba` from `ContactFacts` — never from
model output — following the design bundle's chip styling
(`InTouch.dc.html:255-257`).

**Contract**: Takes `ContactFacts | null`. Renders nothing when null. Relative-time formatting
in Polish follows `RefreshBanner.tsx:5-14`'s `pl-PL` `toLocaleDateString` precedent, with the
same numeral-agreement care `HierarchyView.tsx:33-41` already applies.

#### 4. Card integration

**File**: `src/components/hierarchy/HierarchyCard/HierarchyCard.tsx` and `types.ts`

**Intent**: Place the chips and the marker in the expanded card, and show a compact confirmed
indicator on the collapsed row so an answered person is identifiable without expanding.

**Contract**: `HierarchyCardProps` gains the person's facts and the mark callback. Chips sit
alongside the existing `WeightIndicator` / `contextNote` / `rhythmNote` row; the marker is a
new block below `Dlaczego teraz`. The collapsed variant stays a single `<button>` — the marker
does not appear there, only a confirmed indicator, so the row keeps one activation target.

#### 5. View state

**File**: `src/components/hierarchy/HierarchyView/HierarchyView.tsx` and `types.ts`

**Intent**: Own the facts map client-side and update it in place when a mark returns, so the
chip changes immediately with no refetch and no reorder.

**Contract**: New props for the initial facts and the "answers pending" flag. A handler passes
the server's returned facts into local state keyed by person id and sets the pending flag.
The flag is **cleared in the poll's `done` branch**, alongside the existing `setRanking` call —
the ranking arriving there already incorporates every answer, so leaving it set would keep the
banner promising an update that has already happened. Order is never recomputed and entries are
never reordered locally.

#### 6. Banner line

**File**: `src/components/hierarchy/RefreshBanner/RefreshBanner.tsx` and `types.ts`

**Intent**: State that recorded answers will be reflected on the next recompute, so the absent
reordering reads as a promise rather than a bug.

**Contract**: New `hasPendingAnswers` prop. When true and `status === "fresh"`, an extra line
appears beside the existing "Kolejność odświeżona" block. `Przelicz teraz` is already present
and unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Tapping `Tak, rozmawialiśmy` confirms the card in place and the `Ostatni kontakt` chip appears immediately
- The optional note can be added after answering, and can be skipped entirely without blocking the answer
- Tapping `Jeszcze nie` records a failed attempt and renders the `Poprzednia próba` chip
- The `RefreshBanner` line about the next recompute appears after a mark and `Przelicz teraz` still works
- The list does **not** reorder, and the browser network tab shows a mark issuing exactly one request — to `/api/contact-events` — with no `POST /api/rankings` following it
- The collapsed row shows an answered person as answered, and expanding still works
- Buttons and chips render correctly on a narrow mobile viewport as well as desktop

**Implementation Note**: This phase produces visible UI, so `astro check` / lint / build are
explicitly **not** sufficient evidence — see `lessons.md` on `S-06`. Pause for a human look
before proceeding.

---

## Phase 4: History sheet and the catalog line

### Overview

Give recorded history a durable home the recompute cannot wipe, with full edit and delete, and
surface last-contact on the people catalog.

### Changes Required:

#### 1. Sheet primitive

**File**: `src/components/ui/sheet.tsx`

**Intent**: Add the shadcn sheet the history panel needs.

**Contract**: `npx shadcn add sheet`, which reads `components.json` (`style: new-york`,
`baseColor: neutral`, `cssVariables: true`) and emits into `src/components/ui/`. Adds the
`@radix-ui/react-dialog` dependency. Do not hand-write the primitive.

#### 2. List and delete endpoints

**Files**: `src/pages/api/contact-events.ts` (add `GET`), `src/pages/api/contact-events/[id].ts` (add `DELETE`, widen `PATCH`)

**Intent**: Back the sheet's listing and its per-row edit and delete. `PATCH` already exists
from Phase 1 §5 and only needs widening — do not rewrite it.

**Contract**: `GET /api/contact-events?personId=<uuid>` returns that person's events newest
first. `PATCH` widens its body from `{ note }` to `{ outcome?, note? }`, keeping its existing
auth shape and return value. `DELETE /api/contact-events/[id]` removes the row. All three
scope by `owner_id` from the session in addition to RLS, and return `404` rather than `403`
for a row the caller does not own. All return the person's recomputed `ContactFacts` so the
caller can refresh chips.

#### 3. History sheet component

**File**: `src/components/contact-history/ContactHistorySheet/` (`ContactHistorySheet.tsx`, `types.ts`, `index.ts`)

**Intent**: List a person's events with edit and delete per row, modelled on the design's
`Historia kontaktu` timeline (`InTouch.dc.html:568-596`).

**Contract**: Mounted **once**, not per card — it listens for an open event and holds its own
`personId` / `personName` state, exactly as `Toaster` does. Fetches that person's events on
open. Each row shows outcome, relative date, and the note; edit switches the row to an inline
form (outcome toggle + note field), delete asks for confirmation inline — never via
`window.confirm`, which blocks the browser automation the repo's tooling uses. Every mutation
re-broadcasts the person's updated facts so open cards can refresh their chips.

A sibling `openContactHistory(personId, personName)` module mirrors
`src/components/layout/Toaster/toast.ts` — one exported `CustomEvent` name plus a typed detail
interface, dispatched on `window`. That file's own comment states the reasoning this follows:
the sheet is a separate island, so a DOM event is what connects it to callers rather than
React state or context.

#### 4. Sheet entry points

**Files**: `src/layouts/Layout.astro`, `src/components/hierarchy/HierarchyCard/HierarchyCard.tsx`, `src/components/people/PersonCard/PersonCard.tsx` and `types.ts`

**Intent**: Mount the single sheet and make it reachable from both places history is
referenced, without hydrating either card grid.

**Contract**: `Layout.astro` mounts `<ContactHistorySheet client:load />` beside the existing
`<Toaster client:load />` (line 70) — one instance for the whole app. The expanded hierarchy
card gains a quiet "Historia" affordance that calls `openContactHistory(...)`; `PersonCard`
gains a last-contact line and the same affordance. `PersonCardProps` gains optional facts —
optional so no existing caller breaks.

#### 5. Catalog facts

**File**: `src/pages/people/index.astro`

**Intent**: Supply facts to the grid.

**Contract**: `loadContactFacts` runs alongside the existing `fetchPeople`; each `PersonCard`
receives its person's facts. **`PersonCard` stays un-hydrated.** Its "Historia" affordance is a
plain element dispatching the open event, so the grid remains server-rendered static HTML and
adds no islands — the sheet mounted in `Layout.astro` is the only interactive piece. Do not add
a `client:` directive to the grid.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- `npm run verify:rls` still passes after the mutate endpoints exist

#### Manual Verification:

- The sheet opens from a hierarchy card and from a PersonCard, listing the same events
- Editing an event's outcome or note persists and the chips update without a page reload
- Deleting an event removes it and the chips update accordingly
- Another account's event id returns 404 from `PATCH` and `DELETE`
- `/people` shows a correct last-contact line, and people with no history show none
- The catalog grid still renders correctly on mobile, its first paint is not blank, and it ships no per-card island

**Implementation Note**: Visible UI again — pause for a human look before proceeding.

---

## Phase 5: Production verification

### Overview

Prove the whole loop against a deployed Worker under Cloudflare's real limits, which
`lessons.md` states a local `astro dev` run cannot do.

### Changes Required:

#### 1. Verification script

**File**: `scripts/verify-feedback-loop.ts`

**Intent**: One script that exercises the loop end to end against a deployed URL and exits
non-zero on any failure.

**Contract**: Follows `scripts/verify-ranking.ts`'s shape exactly — `export {}` for module
scope, `assert()` + `failures[]`, refuses a localhost URL, signs in through `/api/auth/signin`
with an explicit `Origin` header, reuses the cookie jar. Every JSON call sends
`Content-Type: application/json` per `lessons.md`. Asserts, in order: a mark returns `201` and
the row is readable; a second account cannot read or mutate it; a forced recompute completes
and its reasons reference the recorded history; an edit and a delete both take effect and the
returned facts change accordingly.

Credentials come from `VERIFY_EMAIL` / `VERIFY_PASSWORD` (plus a second account's pair),
never hardcoded, matching the existing scripts.

#### 2. Script registration

**File**: `package.json`

**Intent**: Register the runner beside the three existing verify scripts.

**Contract**: `"verify:feedback-loop": "tsx scripts/verify-feedback-loop.ts"`.

#### 3. Verification record

**File**: `context/changes/did-it-happen-feedback-loop/production-verification.md`

**Intent**: Record the deployed run's evidence, following
`context/changes/ai-contact-hierarchy/production-verification.md`'s precedent.

**Contract**: Version id, timings, per-assertion results, and any limit observed.

### Success Criteria:

#### Automated Verification:

- Deployed preview builds and uploads: `npm run preview:upload`
- Full loop passes against the deployed URL: `npm run verify:feedback-loop -- <preview-url>`
- Ranking path still passes: `npm run verify:ranking -- <preview-url>`
- Linting passes: `npm run lint`

#### Manual Verification:

- `wrangler tail` shows no error-level `[ranking]` output during the verified run (noting `lessons.md`: non-versioned settings sync only on `versions deploy`, so budget a real deploy if tail is silent)
- The production-verification record is written and its numbers match the run
- Roadmap `S-03` and its Linear issue are moved to reflect the shipped state

---

## Testing Strategy

The repo has no test framework and this slice does not introduce one. Verification is the
three-layer approach already established here.

### Local isolation proof:

- `scripts/verify-rls.ts` extended to `contact_events`: own-row insert/select, cross-account select/update/delete all denied, anon sees nothing.

### Deployed end-to-end proof:

- `scripts/verify-feedback-loop.ts`: mark → read back → cross-account denial → forced recompute → reasons reference history → edit → delete.

### Manual testing steps:

1. Sign in, open `/dashboard`, expand the top card, tap `Tak, rozmawialiśmy`. Confirm the card confirms in place and the `Ostatni kontakt` chip appears.
2. Add a note in the revealed field; reload and confirm it persisted.
3. On a second person tap `Jeszcze nie`; confirm the `Poprzednia próba` chip renders.
4. Confirm the list did **not** reorder and that `RefreshBanner` now promises the next recompute.
5. Tap `Przelicz teraz`; when it completes, confirm the marked people's `Dlaczego teraz` text references the recorded history and that the person with a failed attempt has not dropped.
6. Open the history sheet from a hierarchy card and from a PersonCard; edit an event, then delete one, confirming chips update both times.
7. Visit `/people` and confirm last-contact lines are correct and absent for people with no history.
8. Repeat steps 1 and 6 on a narrow mobile viewport.
9. Edge case: an account with zero contact events must produce a ranking indistinguishable in quality from before this slice.

## Performance Considerations

`loadContactFacts` issues one query per page load or ranking run and folds in memory. At MVP
volumes (a personal circle, capped at 50 people in the prompt) this is a small result set, and
the `(owner_id, person_id, occurred_at desc)` index covers it. It runs inside the existing
`Promise.all` blocks rather than adding a serial round-trip.

The prompt grows by a bounded amount per person — a few derived numbers plus at most two
notes of 200 characters. With `PEOPLE_CAP = 50` the worst case is well inside the model's
input budget, and `lessons.md`'s 10ms-CPU concern applies to the Worker's own work, not the
awaited OpenAI call, which already runs in `waitUntil`.

No recompute is triggered by marking, so this slice adds zero OpenAI spend per interaction.

## Migration Notes

One additive migration, no changes to existing tables, so it is forward-compatible in the
sense `CLAUDE.md` requires: a `wrangler rollback` to pre-`S-03` code leaves an unused table
behind and nothing breaks. Apply locally with `supabase db reset`, verify with
`npm run verify:rls`, then push to the hosted project before deploying the Worker that reads
it — the table must exist before any code queries it.

Both `on delete cascade` decisions are recorded in the migration's header comment so the next
table author sees a decision rather than an inherited default (`lessons.md`).

## References

- Roadmap slice: `context/foundation/roadmap.md` (`S-03`, the north star)
- Product requirements: `context/foundation/prd.md` (`US-01`, `FR-009`, `FR-005`)
- Recurring rules: `context/foundation/lessons.md`
- Upstream slice and its seam: `context/changes/ai-contact-hierarchy/plan.md`, `.../plan-brief.md`, `.../change.md`
- Upstream review (accepted KV race, verification precedents): `context/changes/ai-contact-hierarchy/reviews/impl-review.md`
- Design bundle: `.ai/intouch-design-preparation/project/InTouch.dc.html:255-263` (chips and actions), `:568-596` (history timeline), `:697-712` (the "Czy się udało?" card)
- RLS + policy template: `supabase/migrations/20260901120000_create_rankings_tables.sql`
- JSON route template: `src/pages/api/rankings.ts`
- Verification script templates: `scripts/verify-rls.ts`, `scripts/verify-ranking.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, derived facts, and the write path

#### Automated

- [x] 1.1 Migration applies cleanly against a local Supabase: `supabase db reset` — ec18164
- [x] 1.2 Generated types include `contact_events`: `npm run db:types` produces no diff on a second run — ec18164
- [x] 1.3 RLS isolation proof passes for the new table: `npm run verify:rls` — ec18164
- [x] 1.4 Type checking passes: `npx astro check` — ec18164
- [x] 1.5 Linting passes: `npm run lint` — ec18164
- [x] 1.6 Build passes: `npm run build` — ec18164

#### Manual

- [x] 1.7 A `POST /api/contact-events` from a signed-in browser session returns `201` with the row and the facts object — ec18164
- [x] 1.8 The same POST with another user's `personId` fails rather than writing a row — ec18164
- [x] 1.9 A `PATCH /api/contact-events/[id]` attaches a note to an already-created event and returns updated facts — ec18164
- [x] 1.10 The same PATCH against another account's event id returns `404` — ec18164
- [x] 1.11 Deleting a person removes their contact events (cascade behaves as decided) — ec18164

### Phase 2: History reaches the ranking

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — f682995
- [x] 2.2 Linting passes: `npm run lint` — f682995
- [x] 2.3 Build passes: `npm run build` — f682995
- [x] 2.4 Existing ranking path still passes end-to-end against a deployed preview: `npm run verify:ranking -- <preview-url>` — f682995

#### Manual

- [x] 2.5 With events recorded for a person, a forced recompute produces a `Dlaczego teraz` for that person that references the recorded history — f682995
- [x] 2.6 A person with no recorded events gets a reason that makes no claim about past contact — f682995
- [x] 2.7 A person whose last attempt failed has that attempt cited in their `Dlaczego teraz`, named as a reason to reach out sooner — f682995
- [x] 2.8 A run for an account with zero contact events produces the same quality of output as before this phase — f682995

### Phase 3: The marker on the hierarchy card

#### Automated

- [x] 3.1 Type checking passes: `npx astro check` — 7b49f7d
- [x] 3.2 Linting passes: `npm run lint` — 7b49f7d
- [x] 3.3 Build passes: `npm run build` — 7b49f7d

#### Manual

- [x] 3.4 Tapping `Tak, rozmawialiśmy` confirms the card in place and the `Ostatni kontakt` chip appears immediately — 7b49f7d
- [x] 3.5 The optional note can be added after answering, and can be skipped entirely without blocking the answer — 7b49f7d
- [x] 3.6 Tapping `Jeszcze nie` records a failed attempt and renders the `Poprzednia próba` chip — 7b49f7d
- [x] 3.7 The `RefreshBanner` line about the next recompute appears after a mark and `Przelicz teraz` still works — 7b49f7d
- [x] 3.8 The list does **not** reorder, and the browser network tab shows a mark issuing exactly one request — to `/api/contact-events` — with no `POST /api/rankings` following it — 7b49f7d
- [x] 3.9 The collapsed row shows an answered person as answered, and expanding still works — 7b49f7d
- [x] 3.10 Buttons and chips render correctly on a narrow mobile viewport as well as desktop — 7b49f7d

### Phase 4: History sheet and the catalog line

#### Automated

- [x] 4.1 Type checking passes: `npx astro check` — 8822bc6
- [x] 4.2 Linting passes: `npm run lint` — 8822bc6
- [x] 4.3 Build passes: `npm run build` — 8822bc6
- [x] 4.4 `npm run verify:rls` still passes after the mutate endpoints exist — 8822bc6

#### Manual

- [x] 4.5 The sheet opens from a hierarchy card and from a PersonCard, listing the same events — 8822bc6
- [x] 4.6 Editing an event's outcome or note persists and the chips update without a page reload — 8822bc6
- [x] 4.7 Deleting an event removes it and the chips update accordingly — 8822bc6
- [x] 4.8 Another account's event id returns 404 from `PATCH` and `DELETE` — 8822bc6
- [x] 4.9 `/people` shows a correct last-contact line, and people with no history show none — 8822bc6
- [x] 4.10 The catalog grid still renders correctly on mobile, its first paint is not blank, and it ships no per-card island — 8822bc6

### Phase 5: Production verification

#### Automated

- [x] 5.1 Deployed preview builds and uploads: `npm run preview:upload`
- [x] 5.2 Full loop passes against the deployed URL: `npm run verify:feedback-loop -- <preview-url>`
- [x] 5.3 Ranking path still passes: `npm run verify:ranking -- <preview-url>`
- [x] 5.4 Linting passes: `npm run lint`

#### Manual

- [x] 5.5 `wrangler tail` shows no error-level `[ranking]` output during the verified run (noting `lessons.md`: non-versioned settings sync only on `versions deploy`, so budget a real deploy if tail is silent)
- [x] 5.6 The production-verification record is written and its numbers match the run
- [ ] 5.7 Roadmap `S-03` and its Linear issue are moved to reflect the shipped state
