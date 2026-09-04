# Self-Profile Rhythm Fields — Implementation Plan

## Overview

This implements roadmap slice `S-09`: three optional rhythm selectors on the existing `/profile` form — how much time the user realistically has in a week, how they prefer to reach out, and when in the week they have space for it — stored on `profiles` and available to the ranking prompt `S-02` will write.

The slice is unusual in one respect that shapes the whole plan: **an implementation of it already exists in the working tree, uncommitted, and its migration is already applied to the remote database.** The decision taken in this planning session is to discard that work and re-derive the slice from the design bundle. Phase 0 exists to unwind it — code *and* schema, on both databases — so the re-derivation starts from a genuinely clean baseline rather than confirming choices already made.

## Current State Analysis

`S-01` shipped the `profiles` table and the `/profile` form: `name`, `birth_date`, `life_context`, owner-scoped under the `F-01` RLS contract. The form is a React island (`client:load`) doing native `POST` to `src/pages/api/profile.ts`, which runs `parseForm` → `toRow` → `supabase.upsert` and redirects. There is no test runner in this repo at all — verification convention is standalone `tsx` scripts (`scripts/verify-rls.ts`, `scripts/verify-openai-call.ts`) plus `eslint` and `astro check`.

The uncommitted work to be discarded touches eight files and adds two: migration `20260831150106_add_profile_rhythm_fields.sql`, `src/components/forms/ChoiceChips/`, and edits to `validation/profile.ts`, `ProfileForm.tsx` + its `types.ts`, `profile.astro`, `database.types.ts`, `verify-rls.ts`. It passes `npm run lint` (0 errors) and `npx astro check` (0 errors, 0 warnings). A recoverable copy is saved outside the repo — see References — so the revert is not a one-way door.

### Key Discoveries:

- **The migration is applied on remote, the code never was.** `supabase migration list` shows `20260831150106` in both Local and Remote columns, but `main`'s tip is `2fc5cc4` and `deploy.yml` ships from `main` — so the deployed Worker has no reference to these three columns. This is what makes dropping them on remote safe: the columns hold nothing but their defaults and no running code reads them.
- **`supabase db query --linked "<sql>"` executes SQL against the linked project** via the Management API (CLI v2.98.2, `--help` verified). `supabase migration repair --status reverted <version> --linked` removes the history row. Both are needed — dropping the columns alone leaves the remote history claiming the migration is applied.
- **`supabase/` has no `seed.sql`** (only `config.toml`, `migrations/`, `snippets/`), so `supabase db reset` is a clean replay of migrations with no seed side effects.
- **Table-level `GRANT` covers columns added later.** `grant select, insert, update on public.profiles to authenticated` in `20260830101704_add_profiles_and_people_fields.sql` means a column-adding migration needs no new grants. RLS policies are row-level and likewise unaffected.
- **Component layout is a `lessons.md` rule**, not a preference: `ComponentName/` + `ComponentName.tsx` + `types.ts` + `index.ts` barrel. `src/components/forms/TextField/` is the in-repo example to follow.
- **Forward-compatibility is a hard constraint** (`CLAUDE.md`): `wrangler rollback` reverts Worker code but not the database. Every column this slice adds must be nullable or defaulted so code predating it keeps working.
- **The design bundle is untracked and not gitignored.** `.ai/intouch-design-preparation/` (8 files, 256K) holds `project/InTouch.dc.html`, the onboarding card that is the sole source for these three fields. Its `project/uploads/` subdirectory duplicates four `context/foundation/` documents at stale versions — including `prd.md`, which this very slice amended.

## Desired End State

A signed-in user opening `/profile` sees the existing three fields plus an optional "Twój rytm" section with three chip-selector groups. They can fill none, some, or all of them, save, return to `/profile`, and see their answers still selected. A user who filled their profile before this slice sees the new section empty and is never blocked or bounced. The three answers are readable from `profiles` by whatever `S-02` writes next, and the chip groups are announced correctly by a screen reader as named groups rather than orphaned controls.

**Verification**: `supabase migration list` shows Local and Remote matched with the new migration; `npm run verify:rls` passes with the new columns in its seed payloads; `npm run lint` and `npx astro check` are error-free; and a manual round-trip through the browser confirms selection, persistence and re-hydration.

## What We're NOT Doing

- **The 3-step onboarding wizard.** The design frames these as step 2 of 3 (`InTouch.dc.html:87-135`); the fields land on the existing single-card `/profile`. Inter-step state and abandonment handling are separate work.
- **A fourth `weekly_contact_goal` field** ("ilu osobom tygodniowo") — rejected in the planning session as duplicating the time budget.
- **The design's `Push` channel** — PRD v2 FR-008 is email-only.
- **Anything on the *person* form** — that is the still-open half of PRD Open Question 2.
- **Making the fields required, or gating any route on them.** They are optional; `S-02` must degrade gracefully when they are empty.
- **Unifying how "no answer" is modelled** across the three columns (a nullable scalar vs. empty arrays). Considered and deliberately deferred — it would need a second migration against a live column under the add-then-drop rule.
- **Wiring these fields into any prompt, ranking or reminder.** That is `S-02` and `S-04`.
- **Deploying the Worker.** This slice ends at a commit; the deploy rides whatever ships next.

## Implementation Approach

Unwind first, then rebuild forward. Phase 0 returns both databases and the working tree to the pre-slice state, so that nothing in the re-derivation is silently inheriting a decision from the discarded code. Phases 1–3 then rebuild bottom-up in the order this repo's data features already follow — migration → generated types → validation contract → component → form — each phase leaving the tree green. Phase 4 closes out the paperwork the repo's own rules require: the design bundle that the source citations depend on, the roadmap flip, and the Linear mirror.

The re-derivation is deliberately *fresh*: column names, enum values and Polish copy come from `.ai/intouch-design-preparation/project/InTouch.dc.html`, not from the discarded implementation. Phase 0 is what makes that honest — with the old columns gone from both databases, a differently-named column is a normal migration rather than a contradiction of live schema.

## Critical Implementation Details

**Ordering in Phase 0.** Drop the columns *before* repairing the history row. If the repair runs first and the drop then fails, remote is left with three orphan columns and no history record that anything created them — a state nothing in the toolchain will notice or fix. In the other order, a failed repair leaves a recoverable inconsistency that `supabase migration list` reports plainly.

**Phase 0 touches production.** `supabase db query --linked` runs DDL against the live database. This step must not execute unattended: `/10x-implement` pauses for explicit human confirmation before running it, and the confirmation covers the exact SQL, not the phase. The safety argument (no deployed code reads these columns) is recorded above and should be re-checked — `git log origin/main -1` — immediately before running, because it stops being true the moment this slice's code is deployed.

**The revert is partial by design.** Phase 0 reverts `src/`, `scripts/` and `supabase/migrations/` only. `context/foundation/prd.md` and `context/foundation/roadmap.md` keep their amendments: the FR-002 field-set extension and the Open Question 2 narrowing are decisions from the planning session, not implementation artifacts, and `change.md` records them as such. Reverting them would discard reasoning this plan depends on.

**Chip a11y is a build requirement, not a follow-up.** A button carrying `role="radio"` or `role="checkbox"` needs a parent with `role="radiogroup"` / `role="group"` whose accessible name comes from the group's label. A `<legend>` inside a `<fieldset>` does not supply that name to an ARIA group — the association has to be explicit (`aria-labelledby` pointing at the legend's `id`). `eslint-plugin-jsx-a11y` does not flag the omission, so nothing downstream will catch it if it is skipped.

## Phase 0: Unwind to Pre-Slice Baseline

### Overview

Return both databases and the working tree to the state before any S-09 code existed, keeping the PRD and roadmap amendments.

### Changes Required:

#### 1. Remote database

**File**: none — a one-off command against the linked project.

**Intent**: Remove the three prematurely-applied columns from the production database, then remove the migration's row from the remote history table so the CLI stops reporting it as applied.

**Contract**: Columns `weekly_time_budget`, `preferred_channels`, `availability_windows` no longer exist on `public.profiles` remotely, and `supabase migration list` shows no Remote entry for `20260831150106`. Order is fixed — drop, then repair.

```sql
-- via: supabase db query --linked "<this>"
alter table public.profiles
  drop column weekly_time_budget,
  drop column preferred_channels,
  drop column availability_windows;
```

```
supabase migration repair --status reverted 20260831150106 --linked
```

#### 2. Local database and migration file

**File**: `supabase/migrations/20260831150106_add_profile_rhythm_fields.sql` (deleted)

**Intent**: Delete the migration file and replay the remaining two migrations locally, so the local schema matches the pre-slice remote one.

**Contract**: `supabase/migrations/` holds exactly `20260824192356_create_people_table.sql` and `20260830101704_add_profiles_and_people_fields.sql`; `supabase db reset` completes; `supabase migration list` shows two rows, Local and Remote matched.

#### 3. Application code

**File**: `src/lib/validation/profile.ts`, `src/components/profile/ProfileForm/ProfileForm.tsx`, `src/components/profile/ProfileForm/types.ts`, `src/pages/profile.astro`, `src/db/database.types.ts`, `scripts/verify-rls.ts` (all reverted), `src/components/forms/ChoiceChips/` (deleted)

**Intent**: Restore every tracked source file to its committed state and remove the untracked component folder. `database.types.ts` is restored by revert rather than regenerated — the reverted file already describes the post-reset schema.

**Contract**: `git status --short` reports no modifications under `src/` or `scripts/`, and no untracked entries under `src/components/forms/ChoiceChips/` or `supabase/migrations/`. `context/foundation/prd.md` and `context/foundation/roadmap.md` remain modified.

### Success Criteria:

#### Automated Verification:

- Remote columns are gone: `supabase db query --linked "select column_name from information_schema.columns where table_name = 'profiles'"` returns only the pre-slice columns
- Migration history is clean on both sides: `supabase migration list` shows two rows, Local and Remote matched, no `20260831150106`
- Working tree is clean under source: `git status --short` shows changes only under `context/`
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`

#### Manual Verification:

- Human confirmed the production DDL before it ran, having re-checked that no deployed code reads the three columns (`git log origin/main -1`)
- `/profile` still loads and saves the original three fields after the reset

**Implementation Note**: This phase runs destructive DDL against the production database. Pause for explicit human confirmation of the exact SQL before executing it, and pause again for manual confirmation before proceeding to Phase 1.

---

## Phase 1: Schema and Generated Types

### Overview

Re-derive the three columns from the design bundle and apply the migration to both databases.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<new timestamp>_add_profile_rhythm_fields.sql`

**Intent**: Add three optional columns to `public.profiles` carrying the rhythm answers, with the allowed values derived from the design bundle's onboarding card rather than from the discarded implementation.

**Contract**: Three columns on `public.profiles`, each nullable or defaulted so that code predating the migration keeps working (`CLAUDE.md` forward-compatibility rule). Each column constrains its values against the option set read from `.ai/intouch-design-preparation/project/InTouch.dc.html`. The single-answer field is a scalar; the two multi-answer fields are arrays. No `GRANT` statements — the table-level grant from `20260830101704` already covers new columns. No RLS changes — policies are row-level. Add a `comment on column` for each, naming what it feeds downstream. Record the design-bundle line range the values came from in a header comment.

#### 2. Generated database types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate from the local schema so the new columns are typed for app code.

**Contract**: `npm run db:types` output only; never hand-edited. The `profiles` `Row` / `Insert` / `Update` shapes gain the three columns, with the optionality matching the migration's nullability and defaults.

#### 3. RLS verification seeds

**File**: `scripts/verify-rls.ts`

**Intent**: Extend both profile seed payloads with the new columns so the isolation check exercises them, and a constraint mistake surfaces as a failing verification rather than at runtime.

**Contract**: `profilePayloadA` and `profilePayloadB` carry values for all three new columns, using two different value sets so a cross-user read of the wrong row is distinguishable.

### Success Criteria:

#### Automated Verification:

- Migration applies locally: `supabase db reset` completes with three migrations
- Migration applies remotely: `supabase db push`, then `supabase migration list` shows three rows matched
- Types regenerate cleanly: `npm run db:types` leaves no diff on a second run
- RLS isolation still holds with the new columns: `npm run verify:rls`
- Type checking passes: `npx astro check`

#### Manual Verification:

- Column names and allowed values match the design bundle's onboarding card, checked against `InTouch.dc.html` directly
- Existing profile rows survived the migration with usable defaults

**Implementation Note**: Pause for manual confirmation before Phase 2.

---

## Phase 2: Validation Contract and Chip Component

### Overview

The server-side contract for the three fields, and the shared chip-selector component the form will use — built a11y-correct on the first pass.

### Changes Required:

#### 1. Profile validation

**File**: `src/lib/validation/profile.ts`

**Intent**: Extend the profile schema with the three fields as optional, export the value sets and their Polish labels as the single source both the form and any future read-only display draw from, and teach `parseForm` / `toRow` to move them between `FormData` and the DB row.

**Contract**: The schema accepts an absent or empty answer for all three fields without error — "no answer" is a valid state, not a validation failure, and a profile filled before this slice must still parse. The exported option sets pair each stored value with its Polish label; labels are the design bundle's copy verbatim. `parseForm` reads the multi-answer fields with `FormData.getAll` (they arrive as repeated keys) and drops values outside the allowed set rather than failing the whole submission — a stale chip from a cached page should not cost the user everything else they typed. `toRow` maps each field onto its column.

#### 2. Chip selector component

**File**: `src/components/forms/ChoiceChips/ChoiceChips.tsx`, `types.ts`, `index.ts`

**Intent**: A reusable labelled group of selectable pills covering both the single-answer and multi-answer cases, submitting through a native form post so the existing `/api/profile` handler needs no change.

**Contract**: Folder layout follows the `lessons.md` component rule and mirrors `src/components/forms/TextField/` — rendering logic in `ChoiceChips.tsx` importing its props type from `./types`, barrel re-export in `index.ts`. The component is controlled, and a single-answer group is still modelled as an array so both modes share one value shape. Selecting the active chip in a single-answer group clears it — these fields are optional, so there must be a path back to "no answer" without a reload. Selected values are carried into the form post as repeated hidden inputs under one name, so an empty selection submits no key at all.

**A11y contract** (the reason this is a phase requirement and not a later fix): the chip container carries `role="radiogroup"` for single-answer and `role="group"` for multi-answer, and takes its accessible name from the group's visible label via `aria-labelledby` — a `<legend>` alone does not name an ARIA group. Each chip is a `type="button"` with the matching `role` and a correct `aria-checked`. Do not add an `error` prop unless this phase also gives it a caller.

### Success Criteria:

#### Automated Verification:

- Linting passes, including `jsx-a11y`: `npm run lint`
- Type checking passes: `npx astro check`
- Component folder matches the repo rule: `ChoiceChips.tsx`, `types.ts` and `index.ts` all present

#### Manual Verification:

- A screen reader announces each chip group by its visible label, and reports each chip's selected state
- Keyboard alone can reach every chip, toggle it, and clear a single-answer group

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Form Wiring and Page

### Overview

Put the three groups on `/profile` and hydrate them from the saved row.

### Changes Required:

#### 1. Profile form

**File**: `src/components/profile/ProfileForm/ProfileForm.tsx`, `src/components/profile/ProfileForm/types.ts`

**Intent**: Add an optional "Twój rytm" section below the existing fields holding the three chip groups, with state seeded from the initial values and fed into the existing client-side validate-on-submit path.

**Contract**: `ProfileFormInitialValues` gains the three fields. The section is visually separated from the required fields above it and its heading marks it optional, so a user who wants to skip it can see that they may. Submitting with all three untouched succeeds and reaches `/people` exactly as before this slice.

#### 2. Profile page

**File**: `src/pages/profile.astro`

**Intent**: Pass the saved rhythm answers into the form's initial values, and widen the card so three chip groups fit without wrapping into an unreadable column.

**Contract**: The initial-values object gains the three fields, mapping a null scalar to the form's empty representation. The card's max width increases from its current `max-w-sm`. No change to `src/pages/api/profile.ts` — Phase 2's `parseForm` / `toRow` absorb the new fields behind the existing call.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Filling some or all groups, saving, and returning to `/profile` shows the same chips selected
- Saving with the whole section untouched works and redirects to `/people`
- A profile created before this slice opens with the section empty and no error
- The card reads well at mobile width — no chip group collapses to one-per-line
- Clearing a previously-saved single-answer chip and saving persists the cleared state

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Close-Out

### Overview

Commit the slice, land the design bundle its source citations depend on, and sync the roadmap and Linear.

### Changes Required:

#### 1. Design bundle

**File**: `.ai/intouch-design-preparation/` (added to git), `.gitignore`

**Intent**: Track the design bundle so the `InTouch.dc.html` line citations in the migration and validation comments resolve for anyone reading them later, while excluding the stale duplicates of foundation documents it ships with.

**Contract**: `.ai/intouch-design-preparation/README.md` and everything under `project/` are tracked **except** `project/uploads/`, which is added to `.gitignore` — those four files duplicate `context/foundation/` documents at older versions, and `prd.md` among them is already stale because this slice amended it.

#### 2. Roadmap and change status

**File**: `context/foundation/roadmap.md`, `context/changes/self-profile-rhythm-fields/change.md`

**Intent**: Flip `S-09` to done in both the At-a-glance table and the item body, and stamp the change file.

**Contract**: `S-09`'s `Status` reads `done` in both places; roadmap frontmatter `updated:` is bumped; `change.md` `status:` becomes `implemented` with `updated:` set. Both files already carry this slice's PRD/roadmap amendments from the planning session — they land in the same commit.

#### 3. Linear issue

**File**: none — Linear workspace.

**Intent**: Mirror the roadmap flip onto the tracked issue, per the `lessons.md` rule that exists because `F-05` shipped with its issue still in Backlog.

**Contract**: The issue titled `[S-09] …` in team `GRatajczak`, project `InTouch MVP v1` moves to **Done** once manual verification is signed off (**In Progress** while it is still outstanding). A comment carries the per-phase commit SHAs, the Phase 0 unwind and its rationale, any divergence from this plan, and any manual items left open. If the issue's description asserts something the implementation changed, patch the description too.

### Success Criteria:

#### Automated Verification:

- The bundle is tracked and the duplicates are not: `git ls-files .ai/` lists `README.md` and `project/` files but nothing under `project/uploads/`
- Full gate passes on the committed tree: `npm run lint`, `npx astro check`, `npm run build`
- Isolation check still passes: `npm run verify:rls`
- No stray files left: `git status --short` is empty

#### Manual Verification:

- The `InTouch.dc.html` line references in the migration and validation comments point at the right lines in the committed copy
- Roadmap `S-09` reads `done` in both the table and the item body
- The `[S-09]` Linear issue is in the right state and its comment carries the commit SHAs and the Phase 0 rationale

---

## Testing Strategy

This repo has no test runner. Verification is `eslint` + `astro check` + `npm run build`, the standalone `tsx` scripts, and manual browser checks — the same shape `F-01` and `F-02` used.

### Automated (scripts and gates):

- `npm run verify:rls` — extended in Phase 1 to seed the new columns, so it doubles as a constraint check: a bad `CHECK` or a wrong column type fails the insert.
- `npm run lint` — carries the `jsx-a11y` rules over the new component.
- `npx astro check` and `npm run build` — catch schema/type drift between `database.types.ts` and the code reading it.

### Manual testing steps:

1. Sign in, open `/profile` on an existing profile — the rhythm section renders empty, nothing is blocked.
2. Select one time-budget chip, two channels, one window. Save. Land on `/people`.
3. Return to `/profile` — the same four chips are selected.
4. Click the selected time-budget chip again to clear it, save, return — it is cleared.
5. Create a fresh profile filling only the required fields, leaving the section untouched — saves cleanly.
6. Repeat step 2 at mobile width — chip groups wrap readably.
7. With a screen reader, tab into each group — it is announced by its label, and chips report selected state.

## Migration Notes

Phase 0 removes three columns from the production database. It is safe only because the code that reads them was never committed or deployed — re-verify that with `git log origin/main -1` immediately before running the DDL, since it stops being true once this slice ships.

Phase 1's migration is forward-compatible per `CLAUDE.md`: every column is nullable or defaulted, so a `wrangler rollback` to code predating it leaves the database ahead of the Worker with no breakage. Existing profile rows take their defaults. No column is dropped by this slice, so the add-then-drop-across-deploys rule does not come into play.

## References

- Change identity and planning decisions: `context/changes/self-profile-rhythm-fields/change.md`
- Roadmap slice: `context/foundation/roadmap.md` → `### S-09: Self-profile rhythm fields`
- Recurring rules this plan is bound by: `context/foundation/lessons.md` — component folder layout, page/route naming, roadmap↔Linear mirroring, forward-compatible migrations
- Design source for the three fields: `.ai/intouch-design-preparation/project/InTouch.dc.html` (onboarding card, ~lines 87-135)
- Prior slice this extends: `context/changes/profile-and-first-people/plan.md`
- Verification precedent: `scripts/verify-rls.ts`, `scripts/verify-openai-call.ts`
- Discarded implementation, recoverable: `s09-tracked.patch` and `s09-untracked.tgz` in this session's scratchpad (`/private/tmp/claude-501/-Users-grzegorzratajczak-Desktop-workspace-intouch/33c2a808-62c5-49b9-b4a2-758349f3aa80/scratchpad/`) — session-scoped, so copy them somewhere durable if they may be wanted after this session ends

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 0: Unwind to Pre-Slice Baseline

#### Automated

- [x] 0.1 Remote columns dropped from `public.profiles` — adae754
- [x] 0.2 Migration history clean on both sides — `supabase migration list` shows two matched rows — adae754
- [x] 0.3 Working tree clean under `src/` and `scripts/` — adae754
- [x] 0.4 Linting passes — adae754
- [x] 0.5 Type checking passes — adae754

#### Manual

- [x] 0.6 Human confirmed the production DDL, having re-checked no deployed code reads the columns — adae754
- [x] 0.7 `/profile` loads and saves the original three fields after the reset — adae754

### Phase 1: Schema and Generated Types

#### Automated

- [x] 1.1 Migration applies locally via `supabase db reset` — 7a6c56e
- [x] 1.2 Migration applies remotely via `supabase db push`; `migration list` shows three matched rows — 7a6c56e
- [x] 1.3 `npm run db:types` regenerates cleanly with no diff on rerun — 7a6c56e
- [x] 1.4 `npm run verify:rls` passes with the new columns seeded — 7a6c56e
- [x] 1.5 Type checking passes — 7a6c56e

#### Manual

- [x] 1.6 Column names and allowed values match the design bundle's onboarding card — 7a6c56e
- [x] 1.7 Existing profile rows survived the migration with usable defaults — 7a6c56e

### Phase 2: Validation Contract and Chip Component

#### Automated

- [x] 2.1 Linting passes, including `jsx-a11y` — b4fc52d
- [x] 2.2 Type checking passes — b4fc52d
- [x] 2.3 Component folder carries `ChoiceChips.tsx`, `types.ts` and `index.ts` — b4fc52d

#### Manual

- [x] 2.4 Screen reader announces each chip group by its label and reports chip selected state — a4c7f99
- [x] 2.5 Keyboard alone reaches, toggles and clears chips — a4c7f99

### Phase 3: Form Wiring and Page

#### Automated

- [x] 3.1 Linting passes — a4c7f99
- [x] 3.2 Type checking passes — a4c7f99
- [x] 3.3 `npm run build` succeeds — a4c7f99

#### Manual

- [x] 3.4 Selections persist across save and reload — a4c7f99
- [x] 3.5 Saving with the section untouched works and shows the success toast (redirect-to-`/people` behavior superseded during manual verification — see Phase 4 divergence notes) — a4c7f99
- [x] 3.6 A pre-slice profile opens with the section empty and no error — a4c7f99
- [x] 3.7 Card reads well at mobile width — a4c7f99
- [x] 3.8 Clearing a saved single-answer chip persists the cleared state — a4c7f99

### Phase 4: Close-Out

#### Automated

- [x] 4.1 `.ai/` bundle tracked with `project/uploads/` excluded — 28e00f7
- [x] 4.2 Full gate passes on the committed tree — lint, check, build — 28e00f7
- [x] 4.3 `npm run verify:rls` passes — 28e00f7
- [x] 4.4 `git status --short` is empty (known exception: `.claude/fiszki/`, untracked and unrelated to this plan, predates this session — left alone) — 28e00f7

#### Manual

- [x] 4.5 `InTouch.dc.html` line citations resolve in the committed copy — 28e00f7
- [x] 4.6 Roadmap `S-09` reads `done` in both the table and the item body — 28e00f7
- [x] 4.7 `[S-09]` Linear issue synced with a comment carrying SHAs and the Phase 0 rationale — 28e00f7
