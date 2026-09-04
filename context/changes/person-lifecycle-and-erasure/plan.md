# Person Lifecycle and Erasure Implementation Plan

## Overview

Add the missing half of the `people` lifecycle: a user can edit an existing person, deactivate them (excluded from the AI ranking, contact history retained), reactivate them, and — only once deactivated — permanently and irreversibly delete them. This is roadmap slice `S-05`, PRD `FR-005`, and closes the binary, GDPR-adjacent erasure NFR ("deleting a person's data is fully and irreversibly honored").

## Current State Analysis

- `people` has no lifecycle column at all (`src/db/database.types.ts:85-126`) — every owned row is implicitly "active" today.
- Only `POST /api/people.ts` exists (bulk create, multipart form, redirect-based). There is no read-one, update, or delete route for a person.
- `src/lib/ranking/run.ts:90` selects every owned person with no filter (`supabase.from("people").select("*").eq("owner_id", ownerId)`) — a deactivated person would still reach the AI prompt today.
- `src/pages/dashboard.astro:25` and `src/pages/people/index.astro:22-26` likewise read all owned people with no status filter.
- `PersonCard` (`src/components/people/PersonCard/PersonCard.tsx`) is deliberately un-hydrated — no `client:` directive, delegated click handling only (`src/pages/people/index.astro:66-82`) — and has no edit/delete affordance.
- No person detail/profile view exists. `ContactHistorySheet` shows contact-event history only, opened from `PersonCard`'s "Historia" button.
- No shadcn confirmation-dialog primitive is installed (`src/components/ui/` has only `button.tsx`, `sheet.tsx`). The one destructive-confirm pattern in the app is `ContactHistorySheet`'s inline `confirmingDelete` row-state toggle (`src/components/contact-history/ContactHistorySheet/types.ts:9`), not a modal.
- Both FK chains that matter for erasure already exist and are already correct: `ranking_entries.person_id` and `contact_events.person_id` are `ON DELETE CASCADE` onto `people` (`supabase/migrations/20260901120000_create_rankings_tables.sql:56`, `supabase/migrations/20260902184909_create_contact_events_table.sql:21`). A real row delete on `people` already fully erases every derived row today — nothing about the cascade needs to change.
- The project already depends on the unified `radix-ui` package (`package.json:40`, `^1.6.7`), which `sheet.tsx` already consumes (`import { Dialog as SheetPrimitive } from "radix-ui"`). Adding shadcn's `alert-dialog` component generates a new file under `src/components/ui/` but requires no new npm dependency.

### Key Discoveries:

- `src/pages/api/contact-events/[id].ts:16-107` is the established JSON-route convention to mirror: `PATCH`/`DELETE` keyed by `context.params.id`, always double-scoped with `.eq("id", id).eq("owner_id", ownerId)` in addition to RLS, `.maybeSingle()` → `404` (never `403`) on a foreign or missing row, a local `json()` helper, Polish error strings.
- `src/lib/validation/profile.ts` (`profileSchema` + `toRow`) is the established singular-entity schema pattern to mirror for edit — as opposed to `person.ts`'s `peopleFormSchema` array wrapper, which is create-only.
- `.order("status")` on a two-value `active`/`deactivated` enum sorts `active` first for free (alphabetical) — no custom rank column needed to demote deactivated people to the end of `/people`'s list.
- The design mock (`.ai/intouch-design-preparation/project/InTouch.dc.html:495-505`) already specifies the deactivated-card treatment exactly: 75% opacity, a muted "nieaktywna" pill badge, and the caption "Pominięty w podpowiedziach, historia zachowana" replacing the last-contact line. The same mock (`:531-534`) shows a person's own view with side-by-side "Edytuj" / "Dezaktywuj" buttons — but no delete button anywhere in the file; deletion UX was never mocked and is designed fresh here.
- `scripts/verify-rls.ts` is the direct template for this slice's erasure-verification script: throwaway users via the service-role admin client, real anon-key sessions (not service role) to prove behavior at the actual Postgres-role level, and a `finally` block that deletes the throwaway users.

## Desired End State

A signed-in user can open a person from `/people`, land on `/people/[id]`, edit any of that person's fields, deactivate them (they immediately stop appearing in AI ranking runs and in the dashboard's people count, but their card and contact history remain reachable), reactivate them, and — only while deactivated — permanently delete them after confirming in a modal that says the action cannot be undone. After delete, the person and every row referencing them (`contact_events`, `ranking_entries`) are gone with no trace, verified by a script mirroring `verify-rls.ts`'s isolation-proof style.

Verification: `npm run verify:erasure` passes against a local Supabase instance; `npx astro check`, `npm run lint`, `npm run build` all pass; manual walkthrough of edit → deactivate → reactivate → deactivate → delete in the browser matches the above.

## What We're NOT Doing

- No bulk deactivate/delete, no "undo delete" — delete is the one genuinely irreversible action in the app by design.
- No deletion audit trail of any kind — not even a content-free timestamp log. The NFR is "fully and irreversibly honored"; a record that a specific person was deleted is residual data about that person.
- No account-level deletion (deleting every person a user owns at once) — that's `S-07`'s open question, not this slice.
- No "Nieaktywni · N" filter chip or category chip bar from the design mock — that's `FR-006` (categories/tabs), explicitly parked on the roadmap. Deactivated people stay visible inline, demoted to the end of the grid; no new filter UI.
- No rebuilding of the contact-history timeline on the new detail page — it reuses the existing `ContactHistorySheet` via the same delegated-open pattern `PersonCard` already uses, rather than duplicating history rendering.
- No changes to `/people/new`'s bulk-add flow, to `contact_events`, or to the ranking prompt's content beyond the one added filter.
- No test framework — the repo has none; verification follows the existing `tsx` script precedent (`verify-rls.ts`, `verify-ranking.ts`, etc.).

## Implementation Approach

**Lifecycle column.** `people.status` as a `text not null default 'active'` column with a check constraint (`'active' | 'deactivated'`), matching every other enum-as-text-check column already in this table (`relationship_type`, `last_contact_bucket`). Existing rows default to `'active'` — purely additive, forward-compatible per `CLAUDE.md`.

**One PATCH, one DELETE, per the established convention.** `src/pages/api/people/[id].ts` gets a `PATCH` handler that accepts either field edits (a subset of `personSchema`) or a status transition (`{ status: "active" | "deactivated" }`), building its `updates` object conditionally exactly as `contact-events/[id].ts:43-49` does — one endpoint covers edit, deactivate, and reactivate, since all three are semantically "update this person." `DELETE` on the same route is the only place the "deletion only after deactivation" business rule is enforced: it reads the row first, and returns `409` if `status !== "deactivated"`, regardless of what the UI already gates — the rule must hold even against a direct API call.

**No FK changes.** `ranking_entries` and `contact_events` already cascade correctly; this slice only ever changes `people.status`, never touches the cascade.

**Exclusion is a one-line filter, applied twice.** `run.ts:90` and `dashboard.astro:25` both add `.eq("status", "active")`. `people/index.astro`'s query adds `.order("status", { ascending: true })` ahead of its existing `weight`/`created_at` ordering — no filter, since deactivated people stay visible, just demoted.

**Detail page as a single-URL view/edit toggle.** `/people/[id].astro` (SSR: fetch the person + `loadPersonContactFacts`, redirect to `/people` on a missing/foreign id) renders one `PersonDetailView` island (`client:load`) that holds local `mode: "view" | "editing"` state — no second route for editing. In view mode it shows identity, weight, tags, last-contact fact, an "Edytuj" button, a Dezaktywuj/Aktywuj toggle button, and — only when `status === "deactivated"` — a "Usuń" button. In edit mode it swaps to the new `PersonEditForm`, built directly against `personSchema` (not the array-wrapped `peopleFormSchema`), reusing the same field components `PersonForm` already uses (`TextField`, `SelectField`, `WeightSelector`, `ChoiceChips`, `SegmentedToggle`, `TagChipsField`).

**Delete confirmation via a new `AlertDialog`.** `npx shadcn add alert-dialog` generates `src/components/ui/alert-dialog.tsx` against the already-installed `radix-ui` package — no new dependency. Reserved for the one truly irreversible action; the existing inline `confirmingDelete` pattern stays where it is (contact-event rows), since that action is reversible in effect (a lost event, not a lost person).

## Phase 1: Data model

### Overview

Add the `status` column and regenerate DB types. No other schema changes.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_add_people_status.sql`

**Intent**: Add a lifecycle column to `people` so deactivation and delete-gating have somewhere to live, without touching either existing cascade.

**Contract**: `alter table public.people add column status text not null default 'active' check (status in ('active', 'deactivated'));` — no index (query volume is small per the PRD's `target_scale`, and `people_owner_id_idx` already scopes every read to one owner's small row set). No RLS or GRANT changes — this is a column addition on a table whose policies and grants already exist. Comment on the column per the project's convention (see `20260831202209_add_profile_rhythm_fields.sql`'s `comment on column` usage) explaining that `'deactivated'` excludes a person from ranking while contact history is retained.

#### 2. Generated DB types

**File**: `src/db/database.types.ts`

**Intent**: Reflect the new column in `Row`/`Insert`/`Update` for `people`.

**Contract**: Regenerated via `npm run db:types` against a local Supabase with the migration applied — not hand-edited.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a local Supabase: `supabase db reset`
- Generated types include `people.status` and produce no diff on a second run: `npm run db:types`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- A row inserted without specifying `status` reads back as `'active'`.

---

## Phase 2: API routes

### Overview

Edit, deactivate, reactivate, and delete a single person by id, following the `contact-events/[id].ts` JSON-route convention exactly.

### Changes Required:

#### 1. Validation schema additions

**File**: `src/lib/validation/person.ts`

**Intent**: Give the new route something to validate a partial update or a status transition against, without disturbing the existing create-only `personSchema`/`peopleFormSchema` exports.

**Contract**: Export `PERSON_STATUSES = ["active", "deactivated"] as const` and a `personUpdateSchema` built from `personSchema.partial()` extended with an optional `status: z.enum(PERSON_STATUSES)`. At least one recognized key must be present in a given request body (reject an empty `{}` with a 400, same posture as every other validated route in this codebase) — enforce this with a `.refine()` on the schema, not in the route handler, so the contract lives in one place.

#### 2. `PATCH` / `DELETE` route

**File**: `src/pages/api/people/[id].ts`

**Intent**: One route file owns every single-person mutation. `PATCH` handles field edits and status transitions alike (an edit-form save sends field keys; a deactivate/reactivate click sends `{ status }` only) by conditionally building its `updates` object per key present in the parsed body, mapping camelCase → snake_case the same way `toRows` (`person.ts:110-122`) does for create. `DELETE` enforces the sequencing rule.

**Contract**: Mirrors `contact-events/[id].ts:16-107` structure precisely: `401` with no `context.locals.user`; `400` with no `context.params.id`; JSON body parse failure → `400`; schema `safeParse` failure → `400` with the first issue's message; every mutation double-scoped `.eq("id", id).eq("owner_id", ownerId)`; `.maybeSingle()` → `404` (never `403`) when the row doesn't exist or isn't owned by the caller. `DELETE` additionally does a `select()` (or a preceding read) to check `status === "deactivated"` before issuing the delete; if the row is still `active`, return `409` with a Polish message (e.g. "Najpierw dezaktywuj tę osobę.") and perform no mutation. On successful `DELETE`, the response body needs nothing beyond a success signal — there is no `facts` to return once the person and its `contact_events` are gone.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `PATCH` with a field change updates the row and returns it.
- `PATCH` with `{ "status": "deactivated" }` then `{ "status": "active" }` round-trips correctly.
- `DELETE` on an `active` person returns `409` and the row still exists.
- `DELETE` on a `deactivated` person returns success and the row is gone.
- A `PATCH`/`DELETE` against another user's person id (or a nonexistent id) returns `404` in both cases — indistinguishable from each other.

---

## Phase 3: AI exclusion and counts

### Overview

Deactivated people stop reaching the AI ranking prompt and stop counting toward the dashboard's people count; the `/people` grid demotes them to the end without hiding them.

### Changes Required:

#### 1. Ranking query filter

**File**: `src/lib/ranking/run.ts`

**Intent**: A deactivated person must never be sent to the model.

**Contract**: The people query at `run.ts:90` gains `.eq("status", "active")`. No other change to `run.ts` — `peopleIncluded`/`people_total` semantics are unaffected, since both are now already computed from the (now pre-filtered) `people` array.

#### 2. Dashboard people count

**File**: `src/pages/dashboard.astro`

**Intent**: "How many people are in your circle" should mean actively-tracked people.

**Contract**: The count query at `dashboard.astro:25` gains `.eq("status", "active")`.

#### 3. Catalog ordering

**File**: `src/pages/people/index.astro`

**Intent**: Deactivated people stay visible in the grid (per the design mock) but sort after every active person.

**Contract**: The query at `people/index.astro:20-26` gains a leading `.order("status", { ascending: true })` before its existing `weight`/`created_at` ordering. No `.eq()` filter is added — both statuses are still fetched.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Existing ranking path still passes end-to-end: `npm run verify:ranking -- <preview-or-local-url>`

#### Manual Verification:

- Deactivating a person and re-running the ranking (`Dziś`) produces a hierarchy that no longer mentions them.
- The dashboard's people count drops by one immediately after deactivation, with no page other than a refresh needed.
- `/people` shows a deactivated person's card after every active person's card, not filtered out.

---

## Phase 4: Person detail page and lifecycle UI

### Overview

The `/people/[id]` page and its actions: view, edit, deactivate/reactivate, delete.

### Changes Required:

#### 1. `AlertDialog` primitive

**Command**: `npx shadcn add alert-dialog`

**Intent**: Get the semantically-correct confirmation primitive for the one genuinely irreversible action in the app.

**Contract**: Generates `src/components/ui/alert-dialog.tsx` against the project's existing `radix-ui` dependency and `new-york` style/token config (`components.json`) — no new npm package, no manual theming beyond what shadcn generates.

#### 2. Detail page

**File**: `src/pages/people/[id].astro`

**Intent**: Server-rendered entry point that loads the person and their contact facts, and gates on ownership the same way every other page in this app does.

**Contract**: Fetches `people` row by `id` scoped to `owner_id = user.id` (mirroring `people/index.astro`'s query shape) plus `loadPersonContactFacts`; redirects to `/people` if no matching row is found (same posture as the API routes' `404` — a foreign id looks identical to a missing one). Renders inside `AppShell` and mounts `PersonDetailView` with the person row and facts as initial props, `client:load`.

#### 3. `PersonDetailView` component

**File**: `src/components/people/PersonDetailView/` (new folder: `PersonDetailView.tsx`, `types.ts`, `index.ts`, per the established component-folder convention in `lessons.md`)

**Intent**: Owns the view/edit toggle and the three lifecycle actions.

**Contract**: `mode: "view" | "editing"` local state. View mode renders identity (name, relationship type + osoba/grupa, weight via the existing `WeightIndicator`), `relationship_context`, `context_tags`, the last-contact fact (reusing the same `formatLastContact` shape `PersonCard` already has), a "Historia" trigger that opens the existing `ContactHistorySheet` via `openContactHistory` (same helper `people/index.astro` already imports — no duplicated history rendering), an "Edytuj" button (switches to edit mode), a Dezaktywuj/Aktywuj button (`PATCH` with `{ status }`, label and action flip based on current `status`), and — only when `status === "deactivated"` — a "Usuń" button that opens the new `AlertDialog` ("Nie można cofnąć tej operacji" / similar irreversibility copy), whose confirm action calls `DELETE` and redirects to `/people` on success. Edit mode renders `PersonEditForm` pre-filled from the current row; on successful save, returns to view mode with the updated row.

#### 4. `PersonEditForm` component

**File**: `src/components/people/PersonEditForm/` (new folder, same convention)

**Intent**: Single-person edit form, built for exactly one person rather than `PersonForm`'s row-array shape.

**Contract**: Validates against `personSchema` directly (not `peopleFormSchema`); submits as a `PATCH` (JSON body) to `/api/people/[id]`, not a native form POST — this is a `fetch`-driven island update, matching the JSON-route convention this whole slice follows, unlike `PersonForm`'s multipart-POST-and-redirect shape. Reuses the same field components `PersonForm` already imports (`TextField`, `SelectField`, `WeightSelector`, `ChoiceChips`, `SegmentedToggle`, `TagChipsField`) so the two forms look identical field-for-field.

#### 5. `PersonCard` updates

**File**: `src/components/people/PersonCard/PersonCard.tsx`

**Intent**: Surface the deactivated state per the design mock, and give every card a way into the new detail page.

**Contract**: When `person.status === "deactivated"`, apply the mock's treatment (`InTouch.dc.html:495-505`): reduced-opacity card background, a muted "Nieaktywna" pill badge in the same top-right slot the weight meter otherwise occupies, and the last-contact line replaced with "Pominięty w podpowiedziach, historia zachowana". The whole card becomes a link (or gains a clear "Zobacz" affordance) to `/people/[id]` — stays server-rendered, no new hydration, consistent with the component's existing un-hydrated design.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Opening a person from `/people` lands on `/people/[id]` showing their current data.
- Edytuj → change a field → save returns to view mode with the change reflected, and the same change is visible back on `/people`.
- Dezaktywuj immediately shows the deactivated treatment on this page and back on `/people`'s card.
- Aktywuj reverses it.
- Usuń is not rendered/reachable while the person is active.
- Deactivate, then Usuń → AlertDialog appears with clear irreversibility copy → confirm → redirected to `/people`, the person is gone from the grid.
- Historia still opens the existing contact-history sheet from this page, showing the same events as before.
- Visiting `/people/[id]` for another user's id (or a nonexistent id) redirects to `/people`, not an error page.

---

## Phase 5: Erasure verification

### Overview

A repeatable, automated proof that deletion is fully and irreversibly honored — the binary NFR this whole slice exists to satisfy.

### Changes Required:

#### 1. Verification script

**File**: `scripts/verify-erasure.ts`

**Intent**: Prove, the same way `verify-rls.ts` proves isolation, that deleting a person leaves zero trace anywhere in the schema.

**Contract**: Follows `verify-rls.ts`'s shape — local-only guard, one throwaway user via the service-role admin client, a real anon-key session for that user (not service role) to exercise the app's own posture. Seeds one `people` row, one `contact_events` row referencing it, and one `rankings` + `ranking_entries` row referencing it (so all three dependent tables have something to lose). Calls the app's own `PATCH .../people/[id]` with `{ status: "deactivated" }`, asserts the person is excluded from a fresh ranking run's input (or, more simply, asserts `status` reflects `'deactivated'` and that a direct re-query of the ranking's people-selection filter — `.eq("status","active")` — excludes it). Then calls `DELETE .../people/[id]` and asserts, via a follow-up `select`, that the `people` row, the `contact_events` row, and the `ranking_entries` row are all gone. Also asserts the earlier `DELETE` attempt against the still-`active` seeded person (before deactivation) returned `409` and left the row intact — covering the sequencing rule, not just the end state. `finally` block deletes the throwaway user, mirroring `verify-rls.ts:295-299`.

#### 2. npm script

**File**: `package.json`

**Intent**: Match the existing `verify:*` script convention.

**Contract**: `"verify:erasure": "tsx scripts/verify-erasure.ts"` alongside the existing `verify:rls`/`verify:ranking`/`verify:feedback-loop` entries.

### Success Criteria:

#### Automated Verification:

- `npm run verify:erasure` passes against a local Supabase instance.
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- None — this phase is itself the verification for the rest of the slice; nothing new is user-facing.

---

## Testing Strategy

### Unit Tests:

- None — no test framework exists in this repo (see `## What We're NOT Doing`).

### Integration Tests:

- `scripts/verify-erasure.ts` (Phase 5) is the integration-level proof for this slice, mirroring `verify-rls.ts` and `verify-ranking.ts`.

### Manual Testing Steps:

1. Add a test person, open their detail page, edit a field, confirm the change persists and shows on `/people`.
2. Deactivate them; confirm they drop out of the dashboard's people count and out of a re-run AI ranking, while still showing (dimmed, badged) on `/people` and still opening their contact history.
3. Reactivate them; confirm they return to the active count and the AI ranking.
4. Deactivate again, then delete; confirm the AlertDialog's copy is unambiguous about irreversibility, and that after confirming, the person is gone from every screen.
5. Attempt a `DELETE` via a direct request against a still-active person's id; confirm `409`, not a silent success.

## Performance Considerations

None beyond what already exists — this slice adds one filtered column read to two existing queries and one new indexed-by-primary-key lookup per detail-page view. No new N+1, no new per-request AI/network calls.

## Migration Notes

The `status` migration (Phase 1) is purely additive with a `DEFAULT`, so it is forward-compatible per `CLAUDE.md`: a `wrangler rollback` to pre-this-slice code after this migration ships leaves an unused `status` column behind, which is harmless. No backfill is needed since the column is `NOT NULL DEFAULT 'active'`.

## References

- Roadmap: `context/foundation/roadmap.md` (S-05)
- Change identity: `context/changes/person-lifecycle-and-erasure/change.md`
- JSON-route convention: `src/pages/api/contact-events/[id].ts:1-107`
- Singular-entity schema convention: `src/lib/validation/profile.ts`
- RLS/isolation verification template: `scripts/verify-rls.ts`
- Design reference for deactivated-card treatment: `.ai/intouch-design-preparation/project/InTouch.dc.html:495-505`, `:531-534`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data model

#### Automated

- [x] 1.1 Migration applies cleanly against a local Supabase: `supabase db reset`
- [x] 1.2 Generated types include `people.status` and produce no diff on a second run: `npm run db:types`
- [x] 1.3 Type checking passes: `npx astro check`
- [x] 1.4 Linting passes: `npm run lint`
- [x] 1.5 Build passes: `npm run build`

#### Manual

- [x] 1.6 A row inserted without specifying `status` reads back as `'active'`

### Phase 2: API routes

#### Automated

- [ ] 2.1 Type checking passes: `npx astro check`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Build passes: `npm run build`

#### Manual

- [ ] 2.4 `PATCH` with a field change updates the row and returns it
- [ ] 2.5 `PATCH` with `{ "status": "deactivated" }` then `{ "status": "active" }` round-trips correctly
- [ ] 2.6 `DELETE` on an `active` person returns `409` and the row still exists
- [ ] 2.7 `DELETE` on a `deactivated` person returns success and the row is gone
- [ ] 2.8 `PATCH`/`DELETE` against another user's person id, and against a nonexistent id, both return `404`

### Phase 3: AI exclusion and counts

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`
- [ ] 3.4 Existing ranking path still passes end-to-end: `npm run verify:ranking -- <preview-or-local-url>`

#### Manual

- [ ] 3.5 Deactivating a person and re-running the ranking produces a hierarchy that no longer mentions them
- [ ] 3.6 The dashboard's people count drops by one immediately after deactivation
- [ ] 3.7 `/people` shows a deactivated person's card after every active person's card, not filtered out

### Phase 4: Person detail page and lifecycle UI

#### Automated

- [ ] 4.1 Type checking passes: `npx astro check`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Build passes: `npm run build`

#### Manual

- [ ] 4.4 Opening a person from `/people` lands on `/people/[id]` showing their current data
- [ ] 4.5 Edytuj → change a field → save returns to view mode with the change reflected, and the same change shows on `/people`
- [ ] 4.6 Dezaktywuj immediately shows the deactivated treatment on this page and on `/people`'s card
- [ ] 4.7 Aktywuj reverses it
- [ ] 4.8 Usuń is not rendered/reachable while the person is active
- [ ] 4.9 Deactivate, then Usuń → AlertDialog appears with clear irreversibility copy → confirm → redirected to `/people`, person is gone
- [ ] 4.10 Historia still opens the existing contact-history sheet from this page
- [ ] 4.11 Visiting `/people/[id]` for another user's id, or a nonexistent id, redirects to `/people`

### Phase 5: Erasure verification

#### Automated

- [ ] 5.1 `npm run verify:erasure` passes against a local Supabase instance
- [ ] 5.2 Type checking passes: `npx astro check`
- [ ] 5.3 Linting passes: `npm run lint`
- [ ] 5.4 Build passes: `npm run build`
