# Add-Person Form: Shell Nav + Richer Context — Plan Brief

> Full plan: `context/changes/add-person-context-fields/plan.md`

## What & Why

Closes the per-person half of FR-003 (roadmap `S-10`): the design bundle's
add-person form shows a "who are they to you" line, freeform context tags,
and a "when did you last talk" bucket that the shipped form never got. Adds
all three as optional fields, and moves `/people/new` into the app shell so
it finally matches every other authenticated page.

## Starting Point

`people` today has `name`, `relationship_type`, `description` (≤500),
`is_collective`, `weight` (1-10) — no room for the richer context. The
add-person form (`PersonForm.tsx`) supports multi-row add and posts via a
native form to `/api/people`, but renders standalone, outside `AppShell`.
The ranking prompt reads `description` but nothing more granular; `contact_events`
already exists (from S-03) but nothing outside the real did-it-happen marker
writes to it.

## Desired End State

A user on `/people/new` sees the shell chrome (sidebar/bottom nav) and, per
row, three new optional inputs: a short relationship-context line, up to 5
tag chips, and a 4-option last-contact bucket. Saved tags show as chips on
the person's card in `/people`; all three new fields reach the AI ranking
prompt as context text.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Multi-row form | Kept, all new fields replicated per row | Preserves existing bulk-add capability rather than regressing it for form simplicity |
| `description` field | Untouched; new `relationship_context` column supplements it | Zero risk to the existing ranking-prompt dependency; additive migration only |
| Tag storage | `text[]` column on `people`, capped at 5 | Mirrors S-09's array-column precedent; no reuse/dedup requirement to justify a separate table |
| Tag surface | Ranking prompt + `PersonCard` chips | Makes the richer context visible where the user already looks |
| Last-contact bucket | Own enum column on `people`, never writes `contact_events` | A vague bucket has no honest timestamp to seed; would corrupt `facts.ts`'s precision math |
| Bucket → AI | Included as a prompt context line despite no `contact_events` link | This is the point of the richer context — a cheap, real tie-breaking signal for US-01 |
| Field requirement | All three new fields optional | Matches the design copy itself and the S-09 precedent — zero added friction to a form the PRD already worried about abandonment on |

## Scope

**In scope:** migration for 3 new `people` columns; `person.ts` validation/parser/mapper updates; `PersonForm` new inputs (tag chip field, bucket picker); `/people/new` → `AppShell`; ranking prompt lines; `PersonCard` tag chips.

**Out of scope:** `Kategoria`/`relationship_type` changes (FR-006, parked); weight scale changes (stays 1-10); splitting/replacing `description`; any `contact_events` write path; person edit (S-05's job); tag reuse/autocomplete/separate table; the design's 3-step onboarding wizard.

## Architecture / Approach

One additive migration → `src/lib/validation/person.ts` (schema, form
parser, row mapper, kept in lockstep) → `PersonForm.tsx` row UI (two new
small components: `TagChipsField`, `LastContactBucketField`) → `/people/new.astro`
shell swap → `buildPeopleSection` in the ranking prompt + `PersonCard` chips.
No API route changes — `/api/people.ts` already delegates entirely to
`parseForm`/`toRows`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data model | Migration, regenerated DB types, extended Zod schema/parser/mapper | Array-column check constraint syntax; keeping schema/parser/mapper in lockstep |
| 2. PersonForm UI | Two new field components wired into every row, multi-row preserved | Tag-chip serialization over native multipart form (repeated-name vs delimited) |
| 3. AppShell integration | `/people/new` renders with sidebar/bottom nav | Wrapper `<div>` styling conflicting with `AppShell`'s own `<main>` padding |
| 4. AI + card surface | New context reaches the ranking prompt; tags render as card chips | Prompt noise from empty-field lines for people who skip the new fields |

**Prerequisites:** S-01, S-03, F-05 — all shipped. No external dependency.
**Estimated effort:** ~1-2 sessions across 4 phases.

## Open Risks & Assumptions

- No test framework exists in this repo yet — verification here is manual +
  the existing `verify:*` script pattern only, not new automated tests.
- The design mock's exact tag-chip and bucket-picker visuals are a starting
  point, not a pixel spec — implementer has latitude on final styling
  within the existing `PersonForm` field-component visual family.

## Success Criteria (Summary)

- A user can fill all three new fields on `/people/new`, see the form
  inside the app shell, and have the person save with all fields correct.
- Tags appear as chips on the person's catalog card.
- The next AI ranking run's prompt visibly includes the new context for
  people who provided it, and omits it cleanly for those who didn't.
