# Add-Person Form: Shell Nav + Richer Per-Person Context — Implementation Plan

## Overview

Closes the per-person half of FR-003 (roadmap `S-10`). Extends the person the
user is adding with three optional pieces of context the design bundle asks
for but the shipped form doesn't capture — a short "who are they to you"
line, a handful of freeform context tags, and a rough "when did you last
talk" bucket — and moves `/people/new` inside the same persistent app shell
every other authenticated page already renders in.

## Current State Analysis

- `people` (`supabase/migrations/20260830101704_add_profiles_and_people_fields.sql:42-50`)
  has `name`, `relationship_type` (5-value check-constrained enum),
  `description` (≤500, not null), `is_collective`, `weight` (1-10). No column
  exists for relationship context, tags, or last-contact estimate.
- `src/lib/validation/person.ts` is the single source of truth for the
  person shape: `personSchema` (Zod), `parseForm` (reads indexed
  `field-${i}` keys from a native multipart `FormData`), `toRows` (maps
  parsed values to DB insert rows). All three need the same three new
  fields added in lockstep.
- `PersonForm.tsx` (`src/components/people/PersonForm/PersonForm.tsx`) is a
  client-hydrated (`client:load`) multi-row form — a user can add several
  people in one submit, each row independently addable/removable. It posts
  as a native `<form method="POST" action="/api/people">`, not `fetch`;
  `/api/people.ts` redirects back to `/people/new?error=...` on failure.
- `/people/new.astro` renders inside the bare `Layout`, standalone — not
  `AppShell`. Every other authenticated page (`/people`, `/dashboard`)
  already uses `AppShell`, which needs a `profileName` prop (loaded via
  `loadProfileName()` from `src/lib/shell-summary.ts`, see
  `src/pages/people/index.astro:7,37`).
- The ranking prompt (`src/lib/ranking/prompt.ts`, `buildPeopleSection`,
  lines 124-143) is the only place that decides what the AI actually sees
  per person — today: `name`, `relationship_type` label, `is_collective`,
  `weight`, `description`, plus derived contact-history facts. A new column
  reaches the model only if a line is added here.
- `PersonCard` (`src/components/people/PersonCard/PersonCard.tsx`) renders
  the relationship swatch, weight, name, type/collective line, and a
  last-contact fact from `contact_events` — it does not render `description`
  today, so not rendering `relationship_context` either keeps the same
  precedent.
- `contact_events` (`supabase/migrations/20260902184909_create_contact_events_table.sql`)
  stores real confirmed events with a precise `occurred_at`; `src/lib/contact-history/facts.ts`
  derives `daysSinceLastHappened` from it. This slice does not write to it —
  see Key Discoveries.
- No test framework is configured in this repo (no `vitest`/`jest`, no
  `*.test.ts` files) — `context/foundation/test-plan.md` does not exist yet.
  CI (`ci.yml`) runs `npx astro sync`, `npm run lint`, `npm run build` only.
  Automated verification for this plan is therefore limited to those three
  plus the existing `scripts/verify-*.ts` pattern (`tsx scripts/verify-*.ts`,
  see `package.json`) for one new prompt-content check.

## Desired End State

A signed-in user on `/people/new` sees the add-person form rendered inside
the app shell (sidebar / bottom nav, matching `/people`). Each row of the
multi-row form carries, alongside today's fields: a "Kim jest dla Ciebie?"
short text input, up to 5 freeform context-tag chips, and a "Kiedy ostatnio
rozmawialiście?" 4-option bucket picker — all three optional. On submit, the
new columns are persisted on `people`, tags render as chips on `PersonCard`,
and all three new fields (relationship context, tags, and the bucket as
context text) reach the AI ranking prompt.

Verify by: adding a person with all three new fields filled, confirming the
row lands in `people` with the expected column values, confirming the tags
render on the card in `/people`, and confirming a ranking run's prompt
(via `verify:ranking` or a fresh hierarchy generation) includes lines for
all three new fields.

### Key Discoveries:

- **Rows are optional across the board, and `description` is not touched.**
  The design copy's own line ("nic nie jest obowiązkowe poza imieniem i
  wagą") settles the required/optional question, and this plan holds it:
  `relationship_context`, `context_tags`, `last_contact_bucket` are all
  nullable with no default beyond `null`/`'{}'`. `description` keeps its
  existing `not null`, ≤500 constraint and its own ranking-prompt line
  unchanged — the new context line is additive, not a replacement.
- **The last-contact bucket deliberately never touches `contact_events`.**
  `contact_events.occurred_at` backs `facts.ts`'s `daysSinceLastHappened`
  math, which the did-it-happen loop (`S-03`, the product's north star)
  depends on for precision. A bucket like "2–6 miesięcy temu" has no honest
  single timestamp to seed a row with — inserting one would quietly corrupt
  that math. `last_contact_bucket` is stored as its own enum column on
  `people` and reaches the AI prompt as plain context text, with no FK or
  join to `contact_events` anywhere in this plan.
- **This is the first non-nullable-by-precedent array column on `people`.**
  S-09 added `text[]` columns to `profiles` (`preferred_channels`,
  `availability_windows`) with a `default '{}'` and a subset `check`
  constraint — `context_tags` follows the same shape, but caps by **array
  length** (`array_length(context_tags, 1) is null or array_length(context_tags, 1) <= 5`)
  rather than a fixed subset, since tags are freeform text, not an enum.

## What We're NOT Doing

- Not touching `relationship_type` / adding a `Kategoria` selector — FR-006,
  parked on the roadmap.
- Not changing the weight scale or its UI — shipped 1–10 stays 1–10; the
  mock's 1–5 strip is a known draft error (`S-06`'s retro already flagged
  this exact file for this exact mistake).
- Not splitting or replacing the existing `description` field.
- Not writing to `contact_events` from the last-contact bucket.
- Not simplifying `PersonForm` to single-person-only — multi-row add is
  preserved with the new fields replicated per row.
- Not building person edit (`S-05`, `person-lifecycle-and-erasure`'s job) —
  this plan only touches the add flow.
- Not adding tag reuse, autocomplete, or a separate tags table.
- Not building the design's 3-step onboarding wizard (already ruled out by
  `S-09`'s precedent) — the richer fields land on the same single-card,
  multi-row `/people/new` form that exists today.

## Implementation Approach

Standard vertical slice, following the codebase's own layering
(`schema/migration → validation/row-mapper → API → form UI → shell → AI
consumer`): one additive migration; extend `src/lib/validation/person.ts`'s
schema/parser/mapper together since they must stay in lockstep; extend
`PersonForm.tsx` row state with the three new inputs (a new small
`TagChipsField` component for the tag input, a new `LastContactBucketField`
pill-group component, and a plain `TextField` reuse for the relationship
context line); swap `/people/new.astro` to `AppShell`; then extend
`buildPeopleSection` in the ranking prompt and add a tag-chip row to
`PersonCard`.

## Phase 1: Data model — migration, DB types, validation schema

### Overview

Adds the three columns, regenerates DB types, and extends the single
validation module (`schema` + `parseForm` + `toRows`) that both the form and
the API route already depend on.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<timestamp>_add_people_context_fields.sql`

**Intent**: Add `relationship_context`, `context_tags`, `last_contact_bucket`
to `people`, all nullable/optional, forward-compatible per `CLAUDE.md`
(no code depends on them existing until this same change's later phases
ship, and rollback of this change's code leaves harmless nullable columns
behind).

**Contract**:
```sql
alter table public.people
  add column relationship_context text check (char_length(relationship_context) <= 100),
  add column context_tags text[] not null default '{}'
    check (array_length(context_tags, 1) is null or array_length(context_tags, 1) <= 5),
  add column last_contact_bucket text
    check (last_contact_bucket in ('this_month', 'two_to_six_months', 'over_six_months', 'unknown'));
```
`relationship_context` and `last_contact_bucket` are nullable (no default);
`context_tags` follows the S-09 array-column precedent (`not null default
'{}'`) since "no tags" and "null tags" mean the same thing and a non-null
default keeps every read site from needing a null-check. No RLS change —
these are columns on an already owner-scoped, policy-covered table.

#### 2. Regenerate DB types

**File**: `src/db/database.types.ts`

**Intent**: Reflect the three new `people` columns in the generated
`Row`/`Insert`/`Update` types so the rest of the phases get compile-time
coverage.

**Contract**: Run `npm run db:types` (`supabase gen types typescript
--local > src/db/database.types.ts`) against the migrated local DB — do not
hand-edit this file.

#### 3. Validation schema, form parser, row mapper

**File**: `src/lib/validation/person.ts`

**Intent**: Extend the person shape with the three new optional fields, add
the last-contact bucket enum + Polish labels (mirroring the existing
`RELATIONSHIP_TYPE_LABELS` pattern), and keep `parseForm`/`toRows` in sync
so `/api/people.ts` needs no changes of its own.

**Contract**:
- `LAST_CONTACT_BUCKETS = ["this_month", "two_to_six_months", "over_six_months", "unknown"] as const`
  and `LAST_CONTACT_BUCKET_LABELS` (Polish labels: "W tym miesiącu",
  "2–6 miesięcy temu", "Ponad pół roku", "Nie pamiętam" — matching
  `InTouch.dc.html:650-653` verbatim).
- `personSchema` gains: `relationshipContext: z.string().trim().max(100, ...).optional()`,
  `contextTags: z.array(z.string().trim().min(1).max(30)).max(5, ...).optional()`,
  `lastContactBucket: z.enum(LAST_CONTACT_BUCKETS).optional()`.
- `parseForm` reads `relationshipContext-${i}` (string), `contextTags-${i}`
  (a `FormData.getAll` of repeated same-named inputs, or a delimited value —
  implementer's choice consistent with how the tag chip field serializes
  its state; see Phase 2), and `lastContactBucket-${i}` (string).
- `toRows` maps to `relationship_context`, `context_tags` (default `[]` when
  absent), `last_contact_bucket` (`null` when absent).

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly against local Supabase: `supabase db reset`
- [ ] Generated types compile: `npm run build`
- [ ] Linting passes: `npm run lint`

#### Manual Verification:

- [ ] Inserting a row via `supabase` SQL editor with all three new columns
      populated succeeds and round-trips through a `select *`
- [ ] Inserting a row with all three omitted succeeds (defaults/nulls hold)

---

## Phase 2: PersonForm UI — new fields, multi-row preserved

### Overview

Adds the three new inputs to each row of `PersonForm.tsx`: a short text
field, a tag-chip input, and a 4-option bucket picker — all optional, all
replicated per row alongside the existing name/category/description/weight
fields.

### Changes Required:

#### 1. Row state shape

**File**: `src/components/people/PersonForm/types.ts`

**Intent**: Extend `PersonRowState` with the three new fields so each row's
local state carries them alongside the existing ones.

**Contract**: `PersonRowState` gains `relationshipContext: string`,
`contextTags: string[]`, `lastContactBucket: string` (empty string =
unset, consistent with how `isCollective` is stored as a string today).

#### 2. Tag-chip input component

**File**: `src/components/people/PersonForm/TagChipsField.tsx` (new)

**Intent**: A small controlled component matching the mock's "chip +
dopisz" interaction (`InTouch.dc.html:628-632`) — renders existing tags as
removable chips plus an inline add affordance, capped at 5, each tag
≤30 chars trimmed.

**Contract**: Props `{ value: string[]; onChange: (tags: string[]) => void; max?: number }`. No new dependency — plain controlled input + Enter-to-add + chip `×` to remove, styled consistent with the existing `SelectField`/`TextField` primitives in the same directory.

#### 3. Last-contact bucket picker

**File**: `src/components/people/PersonForm/LastContactBucketField.tsx` (new)

**Intent**: A 4-pill single-select matching `InTouch.dc.html:649-654`,
sourcing its options and labels from `LAST_CONTACT_BUCKET_LABELS`
(Phase 1) rather than hardcoding Polish strings again.

**Contract**: Props `{ value: string; onChange: (bucket: string) => void }`. Renders `LAST_CONTACT_BUCKETS.map(...)` as pill buttons; empty string is a valid "unset" state (the picker is optional, so no bucket needs to start pre-selected, unlike the mock's static screenshot).

#### 4. Wire the new fields into each row

**File**: `src/components/people/PersonForm/PersonForm.tsx`

**Intent**: Render the relationship-context text input (reusing the
existing `TextField` primitive, label "Kim jest dla Ciebie?"), the new
`TagChipsField`, and the new `LastContactBucketField` inside each row, in
the same position the mock shows them (between `description` and
`weight`, and after `weight`, respectively — `InTouch.dc.html:622-655`).
Client-side validation (`peopleFormSchema.safeParse`, already present at
line 62-87) picks up the new optional fields automatically since Zod's
`.optional()` fields don't need extra handling in the existing per-row
error map.

**Contract**: Each new field submits under its row-indexed name
(`relationshipContext-${i}`, `lastContactBucket-${i}`, and
`contextTags-${i}` — as repeated same-named hidden inputs or a single
delimited hidden input, implementer's choice, kept consistent with
Phase 1's `parseForm` reader).

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] Build succeeds (astro + TS check): `npm run build`

#### Manual Verification:

- [ ] Adding one person with all three new fields filled saves successfully
      and the values match what was entered
- [ ] Adding one person with all three new fields left empty saves
      successfully (optional path)
- [ ] Adding two people in the same submit, each with different tag sets
      and buckets, saves both rows correctly (multi-row preserved)
- [ ] Adding a 6th tag to a row is rejected client-side with a clear error
- [ ] Removing a tag chip and re-adding a different one works before submit

---

## Phase 3: App shell integration for `/people/new`

### Overview

Moves `/people/new` from the bare `Layout` into `AppShell`, matching every
other authenticated page.

### Changes Required:

#### 1. Shell swap

**File**: `src/pages/people/new.astro`

**Intent**: Render inside `AppShell` (sidebar + bottom nav) instead of a
standalone centered card, following the exact pattern
`src/pages/people/index.astro:2,7,37,40` already establishes.

**Contract**: Import `AppShell` instead of `Layout`; load `profileName` via
`loadProfileName(Astro.request.headers, Astro.cookies, user?.id)`; pass
`title="Dodaj osobę"` and `profileName` to `<AppShell>`. `peopleCount` is
skipped here — this page has no people array in scope, and `AppShell`'s own
doc comment (`AppShell.astro:9`) says only pass it when already free. Drop
the current `min-h-screen items-center justify-center` centering wrapper
`<div>` (`AppShell`'s `<main>` already provides page padding) and keep the
existing `border-border bg-card ... rounded-2xl border p-8` card as the
direct child of the slot.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:

- [ ] Navigating to `/people/new` shows the sidebar (desktop) / bottom nav
      (mobile), matching `/people`'s chrome
- [ ] The form still submits and redirects to `/people` on success, and
      back to `/people/new?error=...` on failure, unchanged from today
- [ ] No layout regression on mobile width (bottom nav doesn't overlap the
      form's submit row)

---

## Phase 4: Ranking prompt + PersonCard tag chips

### Overview

Feeds the three new fields to the AI (relationship context, tags, and the
last-contact bucket as context text) and renders tags as chips on the
catalog card.

### Changes Required:

#### 1. Ranking prompt

**File**: `src/lib/ranking/prompt.ts`

**Intent**: Extend `buildPeopleSection` (lines 124-143) so each person's
serialized block includes the new context alongside the existing
`description` line — this is the only path by which these fields reach the
model.

**Contract**: Inside the per-person `lines` array, conditionally append (only when the field is set, to avoid empty noise lines for people added before this change or who left them blank):
- `Kontekst: ${person.relationship_context}` when non-null
- `Tagi: ${person.context_tags.join(", ")}` when the array is non-empty
- `Ostatni kontakt (szacunkowo): ${LAST_CONTACT_BUCKET_LABELS[person.last_contact_bucket]}` when non-null

Import `LAST_CONTACT_BUCKET_LABELS` from `src/lib/validation/person.ts`
(Phase 1), matching how `RELATIONSHIP_TYPE_LABELS` is already imported at
the top of this file.

#### 2. PersonCard tag chips

**File**: `src/components/people/PersonCard/PersonCard.tsx`

**Intent**: Render up to 5 small tag chips beneath the existing name/type
line, only when `context_tags` is non-empty — following the doc comment's
own note that this component stays un-hydrated (no `client:` directive),
so the chips are static server-rendered markup, not interactive.

**Contract**: A `flex flex-wrap gap-1` row of small pill `<span>`s (same
visual family as the mock's tag chips, `InTouch.dc.html:629-631`, simplified
to a read-only display state — no `×` remove affordance on the card).
Renders nothing when `person.context_tags` is empty, keeping the card's
existing height for people without tags.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] `tsx scripts/verify-ranking.ts` (existing script, extended if needed to
      print the built prompt) shows the new context lines present for a
      person that has all three fields set, and absent for one that has none

#### Manual Verification:

- [ ] A person added with tags shows those tags as chips on their card in
      `/people`
- [ ] A person added without tags shows no chip row and no layout gap
- [ ] Triggering a hierarchy re-generation for a user with a
      context-rich person produces a ranking explanation that plausibly
      reflects the new context (spot-check, not exact-match)

---

## Testing Strategy

### Unit Tests:

No test framework exists in this repo yet (`context/foundation/test-plan.md`
absent). This plan does not introduce one — that is `/10x-test-plan`'s job,
out of scope here. Verification below is manual + the existing
`scripts/verify-*.ts` pattern only.

### Integration Tests:

None (see above).

### Manual Testing Steps:

1. Add a person via `/people/new` with all three new fields filled; confirm
   the person appears in `/people` with tag chips, and its row in the
   `people` table has the expected column values.
2. Add a person with all new fields left blank; confirm it saves and
   nothing breaks (no chip row, no prompt lines for it).
3. Add two people in one multi-row submit with different tag sets and
   buckets; confirm both save correctly.
4. Regenerate the AI hierarchy for a user with at least one context-rich
   person and inspect the prompt sent to OpenAI (via logs or
   `verify:ranking`) to confirm the new lines are present.
5. Load `/people/new` on a narrow viewport and confirm the bottom nav and
   form don't overlap or clip.

## Performance Considerations

None beyond the existing `PEOPLE_CAP = 50` prompt truncation
(`src/lib/ranking/prompt.ts:19,161`), which already bounds per-request
prompt size regardless of how much context each person now carries.

## Migration Notes

Purely additive (`alter table ... add column`, all nullable or
zero-value-defaulted) — no backfill needed, no existing `people` row
requires a value for any of the three new columns, and rolling the Worker
code back after this migration ships leaves harmless unused columns behind,
consistent with `CLAUDE.md`'s forward-compatible migration rule.

## References

- Roadmap slice: `context/foundation/roadmap.md` §S-10
- Design source: `.ai/intouch-design-preparation/project/InTouch.dc.html:598-660`
- Prior nullable-array-column precedent: `context/changes/self-profile-rhythm-fields/plan.md`
- Prior app-shell opt-in precedent: `src/pages/people/index.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data model — migration, DB types, validation schema

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase: `supabase db reset` — badbb26
- [x] 1.2 Generated types compile: `npm run build` — badbb26
- [x] 1.3 Linting passes: `npm run lint` — badbb26

#### Manual

- [x] 1.4 Inserting a row via `supabase` SQL editor with all three new columns populated succeeds and round-trips through a `select *` — badbb26
- [x] 1.5 Inserting a row with all three omitted succeeds (defaults/nulls hold) — badbb26

### Phase 2: PersonForm UI — new fields, multi-row preserved

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 0bcc170
- [x] 2.2 Build succeeds (astro + TS check): `npm run build` — 0bcc170

#### Manual

- [x] 2.3 Adding one person with all three new fields filled saves successfully and the values match what was entered — 0bcc170
- [x] 2.4 Adding one person with all three new fields left empty saves successfully (optional path) — 0bcc170
- [x] 2.5 Adding two people in the same submit, each with different tag sets and buckets, saves both rows correctly (multi-row preserved) — 0bcc170
- [x] 2.6 Adding a 6th tag to a row is rejected client-side with a clear error — 0bcc170
- [x] 2.7 Removing a tag chip and re-adding a different one works before submit — 0bcc170

### Phase 3: App shell integration for `/people/new`

#### Automated

- [x] 3.1 Linting passes: `npm run lint` — 9810f30
- [x] 3.2 Build succeeds: `npm run build` — 9810f30

#### Manual

- [x] 3.3 Navigating to `/people/new` shows the sidebar (desktop) / bottom nav (mobile), matching `/people`'s chrome — 9810f30
- [x] 3.4 The form still submits and redirects to `/people` on success, and back to `/people/new?error=...` on failure, unchanged from today — 9810f30
- [x] 3.5 No layout regression on mobile width (bottom nav doesn't overlap the form's submit row) — 9810f30

### Phase 4: Ranking prompt + PersonCard tag chips

#### Automated

- [x] 4.1 Linting passes: `npm run lint` — 771ddbe
- [x] 4.2 Build succeeds: `npm run build` — 771ddbe
- [x] 4.3 `tsx scripts/verify-ranking.ts` shows the new context lines present for a person with all three fields set, and absent for one with none — skipped by decision, see change.md

#### Manual

- [x] 4.4 A person added with tags shows those tags as chips on their card in `/people` — 771ddbe
- [x] 4.5 A person added without tags shows no chip row and no layout gap — 771ddbe
- [x] 4.6 Triggering a hierarchy re-generation for a user with a context-rich person produces a ranking explanation that plausibly reflects the new context (spot-check, not exact-match) — 771ddbe
