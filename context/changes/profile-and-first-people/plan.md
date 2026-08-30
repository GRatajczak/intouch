# Self-Profile and First People Implementation Plan

## Overview

Implements roadmap slice `S-01`: a user can fill a short structured self-profile,
add people to their private circle with a structured description, a
single-vs-collective marker, and a 1–10 relationship weight, and see the people
they've added. This is the first slice to give the AI ranking (`S-02`) anything
to rank, and the first product screens the app has beyond auth and the bare
dashboard.

## Current State Analysis

- `supabase/migrations/20260824192356_create_people_table.sql` creates `public.people`
  with only `id`, `owner_id`, `created_at` and full owner-scoped RLS
  (select/insert/update/delete, one policy per command, `(select auth.uid())`
  pattern). No structured fields exist yet — F-01 deliberately scoped to proving
  the isolation pattern on a minimal table.
- No `profiles` table exists.
- `src/db/database.types.ts` reflects only the bare `people` shape; `scripts/verify-rls.ts`
  inserts `{ owner_id }` only.
- F-03 (design system) restyled every *existing* screen (auth, dashboard, landing)
  onto the new token layer in `src/styles/global.css`, but explicitly did not build
  new form/list primitives beyond what auth already needed — its plan-brief lists
  "add-person form, people catalog" as out of scope.
- The only form pattern in the codebase is `src/components/auth/{FormField,SubmitButton,ServerError,PasswordToggle}.tsx`
  plus `SignInForm.tsx`/`SignUpForm.tsx`: a client React island holding `useState`
  for each field, manual validation on submit, native `<form method="POST" action="/api/...">`
  submission, and an Astro API route (`src/pages/api/auth/*.ts`) that re-validates,
  and on success/failure `context.redirect()`s back to the page with `?error=` in
  the query string. There is no schema-validation library (Zod, etc.) yet.
- `src/middleware.ts` guards routes via a `PROTECTED_ROUTES` prefix array and
  `context.locals.user`; it has no concept of gating on anything beyond
  authentication today.
- `src/pages/dashboard.astro` is a single welcome/sign-out card with no navigation
  to other product areas (there are none yet).
- Postgres best practices (loaded for this plan): CHECK constraints belong inline
  on `CREATE TABLE`/`ADD COLUMN` — `ADD CONSTRAINT IF NOT EXISTS` isn't valid
  Postgres syntax, so idempotent constraint-adding only matters when altering a
  table that might already have the constraint, which isn't the case here.

## Desired End State

A signed-in user who has not yet filled a profile is redirected to `/profile`
whenever they try to reach `/people` or `/people/new`; there they fill name, age
range, and life context, which upserts into `public.profiles`. From there they
reach `/people`, initially showing an illustrated empty state with a link to
`/people/new`. Filling that form (name, relationship type, description,
single-vs-collective dropdown, 1–10 weight) inserts a row into `public.people` and
returns to `/people`, which now lists it as a card showing the person's name,
relationship type, description, collective marker, and a 10-segment weight
indicator. The dashboard links to both `/profile` and `/people`.

**Verification**: `npm run verify:rls` (extended for the new columns) passes;
manually walk sign-up → forced `/profile` fill → `/people` empty state →
add a person → see it listed → add a second person with a tied weight to confirm
both render distinctly.

### Key Discoveries:

- `people` currently has zero real-world rows (only `verify-rls.ts`'s throwaway
  test users, cleaned up in its own run) — this is what makes it safe to add
  `NOT NULL` columns without a `DEFAULT` in this slice; Postgres validates
  `NOT NULL` against existing rows at `ADD COLUMN` time, and an empty table has
  none to violate. This is a one-time window: once real users have rows, any
  future `NOT NULL` column addition to `people` needs a `DEFAULT`.
- `lessons.md`'s per-table cascade decision note means `profiles.owner_id`'s
  `ON DELETE CASCADE` needs its own explicit call, not an inherited copy —
  resolved during questioning: cascade, matching `people`.
- FR-005 (edit/deactivate/delete a person) is roadmap slice `S-05`, not this one.
  This plan is add + list only; no edit/delete UI or API for people.
- FR-003 originally specified the single-vs-collective field as *free text*
  naming the collective ("part of the family from the mountains"). It was
  amended on 2026-08-30 to a two-option marker, matching this plan's
  `is_collective` boolean — so the PRD example is no longer a field of its own.
  The collective's identity is expected to appear in `description`, which is the
  text `S-02` reads for tie-breaking. If that turns out to be too weak a signal,
  the recorded fallback is a nullable `collective_label` column, not a change to
  this slice.

## What We're NOT Doing

- Editing, deactivating, or deleting a person (`S-05`).
- The AI contact hierarchy or any ranking logic (`S-02`).
- Editing the self-profile is in scope (the same `/profile` form doubles as
  create/edit via upsert), but there is no separate "edit profile" entry point
  or history of prior values — it's just re-filling the same form.
- Categories/tabs for browsing people (`FR-006`, nice-to-have, not roadmapped yet).
- A schema-validation library beyond Zod for these two forms — no broader
  refactor of the existing auth forms to also use Zod.
- CI wiring for `verify:rls` or automated production migration application —
  both stay manual, consistent with `per-user-data-isolation`'s precedent and
  `CLAUDE.md`'s human-only treatment of production database/secret operations.

## Implementation Approach

Four phases, each independently shippable and manually verifiable:

1. **Data model** — schema first, since nothing else can be built without it.
2. **Self-profile flow** — the hard gate that every subsequent `/people` visit
   depends on, so it must exist before `/people` is reachable in practice.
3. **Add-person flow** — introduces the new shared form primitives (`SelectField`,
   `WeightSelector`) that the list view's `WeightIndicator` (Phase 4) reuses the
   same token/visual language for.
4. **People list + navigation** — the visible payoff: empty state, listing,
   dashboard links tying it all together.

New product-facing form/display primitives live under `src/components/forms/`
and `src/components/people/` — **not** inside `src/components/auth/` — so the
already-working, already-styled auth flow is never touched by this plan.

## Critical Implementation Details

**Validation architecture**: New file `src/lib/validation/profile.ts` and
`src/lib/validation/person.ts` each own the *whole* boundary between the form
and the database, exporting three things:

1. The Zod schema itself, in camelCase, over real JS types (`z.number()` for
   `weight`, `z.boolean()` for `isCollective`). The React form component imports
   this for inline, on-submit field errors (UX only — mirrors the existing
   `errors` state pattern in `SignUpForm.tsx`, just backed by
   `schema.safeParse()` instead of hand-written checks), since client state
   already holds real numbers and booleans.
2. `parseForm(form: FormData)` — the server's entry point. **`FormData` values
   are always strings**, so the schema cannot be applied to them directly:
   `parseForm` reads each field and converts the two non-string ones
   (`weight` via `Number(...)`, `isCollective` via `=== "true"`) before calling
   `schema.safeParse()`. It returns the `SafeParseReturnType` unchanged, so the
   route branches on `.success` exactly like it would on a bare schema call.
3. `toRow(values, ownerId)` — maps the validated camelCase object to the
   snake_case column names (`ageRange` → `age_range`, `relationshipType` →
   `relationship_type`, `isCollective` → `is_collective`, …) and adds
   `owner_id`. **Do not spread the validated object into an insert/upsert** —
   the camelCase keys are not columns, and `createServerClient<Database>`'s
   generated `TablesInsert` types will reject it at `astro check`.

The API route treats `parseForm`'s result as authoritative — the client-side
check is a courtesy, not a security boundary. The reverse direction (a
snake_case row read back from the DB into a camelCase `initialValues` prop)
needs the same care: see Phase 2 §5.

This is the first use of a schema-validation library in the repo; keep it scoped
to these two schemas, don't retrofit the auth forms. The dependency is **Zod 4**
(`zod@^4.5.4`, added to `package.json` on 2026-08-30) — write v4 syntax, and
verify any error-customization option against the installed package rather than
against v3 examples, per `lessons.md`'s "verify exact config API in
node_modules" rule. Note `eslint-plugin-react-compiler` pulls a nested `zod@3`
into the tree; it is a devDependency of a lint plugin and must never be the copy
app code resolves.

**Profile-gate timing**: The gate check (does `profiles` have a row for this
user?) runs in `src/middleware.ts`, scoped to a `PROFILE_GATED_ROUTES = ["/people"]`
prefix list — never on `/profile` itself, or a completed-profile user visiting
`/profile` to edit would be fine, but an incomplete-profile user would loop
against `/people`'s redirect target. The check only fires when `context.locals.user`
is already set, so it costs one extra `profiles` select per request, only on
`/people*` routes, only for authenticated users — acceptable at this project's
`qps: low` target scale.

**The gate is not an auth check and must not be mistaken for one.** Because it
no-ops when `context.locals.user` is null, `/people*` is only protected if it is
*also* in `PROTECTED_ROUTES` — the existing auth check must run first and
redirect anonymous visitors to `/auth/signin`, leaving the gate to handle the
authenticated-but-profileless case only. `PROFILE_GATED_ROUTES` is therefore
always a subset of `PROTECTED_ROUTES`, never a replacement for it.

**Auth on the new API routes**: middleware's `PROTECTED_ROUTES` matches on path
prefix, and `/api/profile` / `/api/people` do not start with any protected
prefix — so neither route is covered by it. Each must guard on
`context.locals.user` itself before touching Supabase; without it an
unauthenticated POST throws on `user.id` and returns a 500 instead of a
redirect. (RLS still refuses the write for the `anon` role, so this is a broken
response, not a data leak — but it's still a 500 on a reachable endpoint.)

## Phase 1: Data model

### Overview

Adds `public.profiles` and extends `public.people` with the structured fields
FR-002/FR-003/FR-004 need, regenerates DB types, and extends the RLS
verification script to cover both.

### Changes Required:

#### 1. Migration: profiles table + people columns

**File**: `supabase/migrations/<timestamp>_add_profiles_and_people_fields.sql`
(create via `supabase migration new add_profiles_and_people_fields` for a
correctly ordered timestamp)

**Intent**: Give the self-profile its own owner-scoped table, and extend
`people` with the fields the add-person form collects, so both are backed by
typed, constrained columns rather than free text.

**Contract**:
- `public.profiles`: `owner_id uuid primary key references auth.users(id) on delete cascade`,
  `name text not null check (char_length(name) <= 100)`,
  `age_range text not null check (age_range in ('20s','30s','40s+'))`,
  `life_context text not null check (life_context in ('busy_parent','frequent_traveler','remote_worker','other'))`,
  `life_context_detail text check (char_length(life_context_detail) <= 80)` (nullable;
  populated only when `life_context = 'other'` — enforced at the Zod/app layer,
  not a DB constraint, since cross-column conditional checks add migration
  complexity this slice doesn't need), `updated_at timestamptz not null default now()`.
  RLS enabled; policies for `select`/`insert`/`update` only (no `delete` — nothing
  in this slice deletes a profile), each following F-01's `to authenticated` +
  `(select auth.uid()) = owner_id` pattern.
- `public.people` gains: `name text not null check (char_length(name) <= 100)`,
  `relationship_type text not null check (relationship_type in ('family','friend','colleague','acquaintance','other'))`,
  `description text not null check (char_length(description) <= 500)`,
  `is_collective boolean not null default false`,
  `weight smallint not null check (weight between 1 and 10)`.
  No new RLS policies needed — the existing four already cover every command
  regardless of column set.

#### 2. Regenerate DB types

**File**: `src/db/database.types.ts`

**Intent**: Keep the generated types in sync so `src/lib/supabase.ts`'s typed
client covers the new columns.

**Contract**: Regenerated via `npm run db:types` (requires `supabase start`
running locally first). Generated file, not hand-edited.

#### 3. Extend the RLS verification script

**File**: `scripts/verify-rls.ts`

**Intent**: The script's existing `people` insert (`{ owner_id }` only) now
violates the new `NOT NULL` constraints — it must supply all required columns,
and gains a parallel set of assertions for `profiles` mirroring the existing
own-row-visible / cross-row-invisible checks already written for `people`.

**Contract**: Insert payloads for `people` include `name`, `relationship_type`,
`description`, `weight` (valid enum/range values). Add equivalent seed +
assertion blocks for `profiles` (insert own row, select own row, cross-user
select returns empty, cross-user update/delete denied) using the same
`clientA`/`clientB`/`anonClient` already set up in the script.

### Success Criteria:

#### Automated Verification:

- `supabase start` boots local Postgres cleanly: `supabase start`
- Migration applies without error: `supabase db reset`
- Types generate without error: `npm run db:types`
- Type checking passes: `npx astro check`
- Verification script passes: `npm run verify:rls` (exits 0)
- Linting passes: `npm run lint`

#### Manual Verification:

- `supabase db reset` output shows `profiles` created with RLS enabled and 3
  policies, and `people` showing the 5 new columns with their check constraints.
- `npm run verify:rls` console output shows both the existing `people`
  assertions and the new `profiles` assertions passing.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Self-profile flow

### Overview

The `/profile` page, its form, validation, API route, and the middleware gate
that sends incomplete-profile users here before they can reach `/people`.

### Changes Required:

#### 1. Zod schema for the profile form

**File**: `src/lib/validation/profile.ts`

**Intent**: Single source of truth for what a valid profile submission looks
like, shared by the client form and the API route.

**Contract**: Exports three things (per Critical Implementation Details):

- `profileSchema` — validates `name` (1–100 chars, trimmed non-empty),
  `ageRange` (one of the 3 enum values), `lifeContext` (one of the 4 enum
  values), and `lifeContextDetail` (required, 1–80 chars, trimmed non-empty,
  *only* when `lifeContext === "other"`, otherwise absent/ignored) via
  `.superRefine()` or `.refine()` on the object.
- `parseForm(form: FormData)` — pulls the four fields out of `FormData` and
  runs `profileSchema.safeParse()` on them. All four are strings here, so no
  type conversion is needed for this schema (unlike `person.ts`); the function
  exists anyway so both routes have the same shape and the field-name list
  lives next to the schema.
- `toRow(values, ownerId)` — returns
  `{ owner_id, name, age_range, life_context, life_context_detail }`, mapping
  camelCase → snake_case. `life_context_detail` is `null` (not `undefined`)
  when `lifeContext !== "other"`, so an edit that switches away from "other"
  clears the previously-saved detail instead of leaving it stale.

#### 2. Profile form component

**File**: `src/components/profile/ProfileForm.tsx`

**Intent**: Client React island collecting the four fields, following
`SignUpForm.tsx`'s shape (local `useState` per field, inline errors from the
shared Zod schema on submit, native form POST to `/api/profile`, a
conditionally-rendered short text input for `lifeContextDetail` that only
appears when `lifeContext` is `"other"`).

**Contract**: Props: `initialValues?: { name, ageRange, lifeContext, lifeContextDetail }`,
`serverError?: string | null` (for prefill when editing an existing profile).
Uses new `src/components/forms/TextField.tsx` and `src/components/forms/SelectField.tsx`
(see Phase 3 — built here first since this phase needs them first) instead of
the auth-specific `FormField`.

#### 3. Shared text/select field primitives

**File**: `src/components/forms/TextField.tsx`, `src/components/forms/SelectField.tsx`

**Intent**: A label+input(+error) primitive and a label+native-select(+error)
primitive, visually consistent with `FormField.tsx`'s token usage but without
requiring an `icon` prop (product forms don't need one on every field).

**Contract**: Same `{ id, label, value, onChange, error, hint }` shape as
`FormField`, `icon` optional instead of required; `SelectField` additionally
takes `options: { value: string; label: string }[]`.

#### 4. Profile API route

**File**: `src/pages/api/profile.ts`

**Intent**: Authoritative validation and persistence — parses the form,
re-validates with the shared schema, upserts into `profiles` scoped to
`context.locals.user.id`, and redirects.

**Contract**: `POST`, mirrors `signup.ts`'s shape (build `authCookieHeaders`,
create the request-scoped Supabase client, redirect with `?error=` on
validation or DB failure). Order of operations:

1. Guard auth first: `const user = context.locals.user; if (!user) return context.redirect("/auth/signin");`
   — this route is *not* covered by `PROTECTED_ROUTES` (see Critical
   Implementation Details).
2. `const parsed = parseForm(await context.request.formData())`; on
   `!parsed.success`, redirect back to `/profile?error=...`.
3. On success: `supabase.from("profiles").upsert({ ...toRow(parsed.data, user.id), updated_at: new Date().toISOString() })`,
   then `context.redirect("/people")`.

Note the `toRow(...)` call — do **not** spread `parsed.data` directly; its keys
are camelCase and are not columns.

#### 5. Profile page

**File**: `src/pages/profile.astro`

**Intent**: Renders the form, pre-filled if a profile row already exists (so
re-visiting `/profile` to edit works, not just first-fill).

**Contract**: Server-side, fetch `supabase.from("profiles").select("*").eq("owner_id", user.id).maybeSingle()`.
The row comes back in **snake_case**, but `ProfileForm`'s `initialValues` prop is
camelCase — map it explicitly before passing it down
(`{ name: row.name, ageRange: row.age_range, lifeContext: row.life_context, lifeContextDetail: row.life_context_detail ?? "" }`),
or `initialValues` silently arrives all-`undefined` and the "pre-fill on edit"
criterion (2.7) fails while everything still typechecks. Reads `?error=` from
`Astro.url.searchParams` like `signin.astro`/`signup.astro` do.

#### 6. Middleware: protect `/profile`, gate `/people`

**File**: `src/middleware.ts`

**Intent**: `/profile` requires auth (like `/dashboard`); `/people*` requires
auth *and* a completed profile.

**Contract**: `PROTECTED_ROUTES` becomes `["/dashboard", "/profile", "/people"]`
— **both** new routes, not just `/profile`. `/people` must be in this list:
the profile gate below no-ops for anonymous visitors by design, so without the
auth entry an unauthenticated GET `/people` reaches `people/index.astro` and
throws on `user.id` (a 500, not a redirect).

Then add a `PROFILE_GATED_ROUTES = ["/people"]` prefix check that runs *after*
the existing auth check, only when `context.locals.user` is set and the path
matches: query `profiles` for `owner_id = user.id`, `maybeSingle()`; if no row,
`return context.redirect("/profile")` before calling `next()`. `createClient`
returns `null` when Supabase env vars are absent, so the gate needs the same
`if (supabase)` narrowing the existing `getUser()` block uses.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Signed-in user with no profile visiting `/dashboard` and manually navigating
  to `/people` is redirected to `/profile`.
- Filling the profile form with `lifeContext` set to a non-"other" value hides
  the detail field and submits successfully, redirecting to `/people`.
- Setting `lifeContext` to "other" without filling the detail field shows an
  inline validation error and does not submit.
- Re-visiting `/profile` after a successful fill shows the previously-saved
  values pre-filled.
- Signed *out* (private window), visiting `/people`, `/people/new` and
  `/profile` each redirects to `/auth/signin` — no 500, no rendered page. A
  signed-out `curl -X POST` to `/api/profile` likewise redirects rather than
  erroring.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Add-person flow

### Overview

The `/people/new` page, its form, the new weight/collective UI, validation, and
the API route that inserts a person.

### Changes Required:

#### 1. Zod schema for the person form

**File**: `src/lib/validation/person.ts`

**Intent**: Single source of truth for a valid person submission, shared by
form and API route.

**Contract**: Exports three things (per Critical Implementation Details):

- `personSchema` — validates `name` (1–100 chars, trimmed non-empty),
  `relationshipType` (one of the 5 enum values), `description` (1–500 chars,
  trimmed non-empty), `isCollective` (`z.boolean()`), `weight`
  (`z.number().int().min(1).max(10)`).
- `parseForm(form: FormData)` — this is the schema that actually needs the
  conversion step, since two of its five fields are not strings on the wire:
  `isCollective: form.get("isCollective") === "true"` and
  `weight: Number(form.get("weight") ?? NaN)`. Use `Number(...)` with a `NaN`
  fallback rather than `z.coerce.number()`, which turns a missing field's `""`
  into a valid-looking `0` — `NaN` fails `.int()` and surfaces as a real
  validation error.
- `toRow(values, ownerId)` — returns
  `{ owner_id, name, relationship_type, description, is_collective, weight }`.

#### 2. Weight selector component

**File**: `src/components/forms/WeightSelector.tsx`

**Intent**: The interactive 1–10 weight input — a row of 10 clickable segments,
click-to-set, replacing a plain number input per the questioning decision.

**Contract**: Controlled component: `{ value: number; onChange: (n: number) => void; label: string; error?: string }`.
Renders 10 buttons (not a native input) so it's directly clickable; keyboard
users can Tab+Enter/Space each segment (no custom arrow-key roving needed at
this size).

Two things this component lives inside a `<form method="POST">` and therefore
must get right:

- **Every segment needs `type="button"`.** A bare `<button>` inside a form
  defaults to `type="submit"`, so clicking a weight would submit the
  half-filled form instead of setting the value.
- **Buttons submit nothing**, so the component also renders
  `<input type="hidden" name="weight" value={value} />` alongside the segments.
  Without it the POST body has no `weight` field at all and `parseForm` fails
  on every submission — this is what criterion 3.6 actually verifies.

Default `value` to something outside 1–10 (e.g. `0`) in `PersonForm`'s initial
state so an untouched selector fails validation rather than silently submitting
a 1.

#### 3. Person form component

**File**: `src/components/people/PersonForm.tsx`

**Intent**: Client React island collecting all five fields, following the same
shape as `ProfileForm.tsx`/`SignUpForm.tsx`. The single-vs-collective marker is
a two-option dropdown reusing `SelectField` (not a separate component — no new
primitive needed beyond what relationship type already uses).

**Contract**: Props: `serverError?: string | null`. Uses `TextField` (name),
`SelectField` (relationship type), a plain `<textarea>` wrapped in `TextField`-equivalent
styling for `description`, a second `SelectField` for `isCollective` (options
`"Osoba"` → `false` / `"Grupa"` → `true`; since native `<select>` values are
always strings, the form maps `"true"`/`"false"` to/from the boolean at the
`onChange`/submit boundary), and `WeightSelector` for `weight`. Submits via
native POST to `/api/people`.

#### 4. People API route

**File**: `src/pages/api/people.ts`

**Intent**: Authoritative validation and insert, scoped to the authenticated
owner.

**Contract**: `POST`, same four-step shape as `profile.ts`'s route:

1. Guard auth first (`if (!user) return context.redirect("/auth/signin")`) —
   like `/api/profile`, this route is not covered by `PROTECTED_ROUTES`.
2. `const parsed = parseForm(await context.request.formData())`.
3. On success: `supabase.from("people").insert(toRow(parsed.data, user.id))`,
   then `context.redirect("/people")`.
4. On validation/DB failure: `context.redirect("/people/new?error=...")`.

#### 5. Add-person page

**File**: `src/pages/people/new.astro`

**Intent**: Renders the form. No prefill — this is add-only, per FR-005/`S-05`
owning edit.

**Contract**: Server-side auth and the profile gate are both already covered by
Phase 2's middleware — `"/people"` is in `PROTECTED_ROUTES` *and* in
`PROFILE_GATED_ROUTES`, and both match on prefix, so `/people/new` inherits
each. (This only holds because Phase 2 §6 adds `"/people"` to
`PROTECTED_ROUTES`; the gate alone would let anonymous visitors through.) Reads
`?error=` like the other pages.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Submitting the form with all fields valid inserts a row and redirects to
  `/people`.
- Leaving `description` empty shows an inline error and does not submit.
- The weight selector visibly reflects the clicked segment and submits the
  correct 1–10 value (spot-check by reading the row back via Supabase Studio
  or `psql`).
- Clicking a weight segment does *not* submit the form — the page stays on
  `/people/new` and only the selected segment changes.
- A profile-incomplete user cannot reach `/people/new` directly (redirected to
  `/profile`, reusing Phase 2's gate).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: People list + navigation

### Overview

The `/people` list page — empty state or a card per person — and dashboard
links tying `/profile` and `/people` into the app's existing navigation (there
is none today beyond the auth flow).

### Changes Required:

#### 1. Weight indicator (display-only)

**File**: `src/components/people/WeightIndicator.tsx`

**Intent**: The read-only counterpart to `WeightSelector` — renders the same
10-segment visual language for a card, but non-interactive.

**Contract**: `{ value: number }`, no `onChange`. Shares the segment styling
constants with `WeightSelector` (import the shared class strings/constants from
one place so the two never visually drift apart).

#### 2. Person card

**File**: `src/components/people/PersonCard.tsx`

**Intent**: One row/card per person in the list: name, relationship-type badge,
description, a collective marker (shown only when `is_collective` is true), and
the weight indicator.

**Contract**: `{ person: Tables<"people"> }` (using the generated `Tables` helper
from `database.types.ts`).

#### 3. Empty state

**File**: `src/components/people/EmptyState.tsx`

**Intent**: First-run illustrated empty state directing the user to add their
first person.

**Contract**: A centered icon (e.g. `lucide-react`'s `UsersRound`), a heading,
one sentence of explanatory copy, and a link/button to `/people/new`. No props
needed — static content.

#### 4. People list page

**File**: `src/pages/people/index.astro`

**Intent**: Fetches the signed-in user's people and renders either the empty
state or a list of cards, plus a persistent "add person" entry point.

**Contract**: Server-side `supabase.from("people").select("*").eq("owner_id", user.id).order("weight", { ascending: false }).order("created_at", { ascending: true })`.
Renders `EmptyState` when the result is empty, otherwise maps rows through
`PersonCard`. Always renders a link to `/people/new` (as the empty state's CTA,
or as a persistent header button when the list is non-empty).

#### 5. Dashboard navigation

**File**: `src/pages/dashboard.astro`

**Intent**: The dashboard is currently a dead end — add the two links this
slice's routes need to be reachable without typing a URL.

**Contract**: Two links/buttons: "Uzupełnij profil" → `/profile`, "Twoi bliscy" → `/people`,
placed alongside the existing sign-out form, following the page's existing
Polish-language convention.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- A profile-complete user with zero people sees the illustrated empty state at
  `/people`, and its CTA reaches `/people/new`.
- After adding one person, `/people` shows their card with the correct
  relationship type, description, collective marker (if set), and weight
  indicator matching what was submitted.
- Adding a second person with the same weight as the first confirms both
  render as distinct cards (no dedup/collapse bug) — this is also the manual
  precondition `S-02`'s tie-breaking acceptance criterion will later depend on.
- Dashboard's two new links navigate to `/profile` and `/people` respectively.
- Full walk: sign up → confirm email → sign in → redirected dashboard →
  navigate to `/people` → redirected to `/profile` (gate) → fill profile →
  land on `/people` empty state → add a person → see it listed.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No unit test runner exists in this repo yet; this slice doesn't introduce one.
  Correctness is covered by `npx astro check` (types), `npm run verify:rls`
  (data isolation), and the manual verification steps per phase.

### Integration Tests:

- `scripts/verify-rls.ts` (extended in Phase 1) is the only automated
  cross-cutting check: it proves `profiles` and the extended `people` schema
  hold the same per-user isolation guarantee F-01 established.

### Manual Testing Steps:

1. Sign up a fresh account, confirm email, sign in.
2. From the dashboard, click through to `/people` — confirm the profile gate
   redirects to `/profile`.
3. Submit the profile form with `lifeContext = "other"` and no detail text —
   confirm the inline validation error blocks submission.
4. Fill and submit the profile form validly — confirm redirect to `/people`
   and the empty state renders.
5. Add two people, one with a tied weight against the other — confirm both
   render as separate cards with correct field values.
6. Re-visit `/profile` — confirm the form is pre-filled with the values just
   saved.

## Performance Considerations

None beyond the one extra `profiles` lookup per `/people*` request noted in
Critical Implementation Details — negligible at this project's `qps: low`
target scale.

## Migration Notes

The Phase 1 migration adds `NOT NULL` columns without a `DEFAULT`, which is
only safe because `people` currently holds no real rows (see Key Discoveries).
This migration must ship before any user has added a person through the app —
which is guaranteed here, since this slice is what first exposes `people` to
real user input. No backfill step is needed.

## References

- Related roadmap slice: `context/foundation/roadmap.md` (`S-01`)
- RLS pattern to follow: `supabase/migrations/20260824192356_create_people_table.sql`
- Form pattern to follow: `src/components/auth/SignUpForm.tsx`, `src/components/auth/FormField.tsx`
- Prior isolation-proof plan: `context/changes/per-user-data-isolation/plan.md`
- Design tokens to build on: `src/styles/global.css`, `context/changes/design-system-foundation/plan-brief.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data model

#### Automated

- [x] 1.1 `supabase start` boots local Postgres cleanly — 4ac61e6
- [x] 1.2 Migration applies without error (`supabase db reset`) — 4ac61e6
- [x] 1.3 Types generate without error (`npm run db:types`) — 4ac61e6
- [x] 1.4 Type checking passes (`npx astro check`) — 4ac61e6
- [x] 1.5 Verification script passes (`npm run verify:rls`) — 4ac61e6
- [x] 1.6 Linting passes (`npm run lint`) — 4ac61e6

#### Manual

- [x] 1.7 `supabase db reset` shows `profiles` (3 policies) and `people`'s 5 new columns with constraints — 4ac61e6
- [x] 1.8 `npm run verify:rls` output shows both `people` and new `profiles` assertions passing — 4ac61e6

### Phase 2: Self-profile flow

#### Automated

- [x] 2.1 Type checking passes (`npx astro check`) — b9e1fa4
- [x] 2.2 Build succeeds (`npm run build`) — b9e1fa4
- [x] 2.3 Linting passes (`npm run lint`) — b9e1fa4

> Note (applies to both Automated and Manual criteria in this phase): FR-002 was amended mid-phase (see `change.md` Notes) — `ageRange`/`lifeContext` enum fields became `birthDate` (exact date) and a free-text `lifeContext`. Contract text above describes the original design; the shipped code matches the amendment. 2.5/2.6 below were verified against the amended fields: empty `birthDate`/`lifeContext` or a future `birthDate` blocks submission with an inline error; a valid free-text `lifeContext` submits successfully — there is no more "other"/detail-field distinction.

#### Manual

- [x] 2.4 Profile-incomplete user redirected from `/people` to `/profile` — b9e1fa4
- [x] 2.5 Non-"other" `lifeContext` hides detail field and submits successfully — b9e1fa4
- [x] 2.6 "other" `lifeContext` without detail text blocks submission with inline error — b9e1fa4
- [x] 2.7 Re-visiting `/profile` pre-fills previously-saved values — b9e1fa4
- [x] 2.8 Signed-out visits to `/people`, `/people/new`, `/profile` and `POST /api/profile` all redirect to `/auth/signin` (no 500) — b9e1fa4

### Phase 3: Add-person flow

#### Automated

- [x] 3.1 Type checking passes (`npx astro check`) — 8050274
- [x] 3.2 Build succeeds (`npm run build`) — 8050274
- [x] 3.3 Linting passes (`npm run lint`) — 8050274

> Note: Phase 3 was expanded mid-implementation (see `change.md` Notes) — `/people/new` now supports adding multiple people/groups in one view (dynamic rows, one bulk insert) instead of one person per submission. Contract text above describes the original single-row design; 3.4 below was verified against the shipped multi-row behavior (each row inserts as a separate people row in the same request).

#### Manual

- [x] 3.4 Valid submission inserts a row and redirects to `/people` — 8050274
- [x] 3.5 Empty `description` blocks submission with inline error — 8050274
- [x] 3.6 Weight selector reflects and submits the correct 1–10 value — 8050274
- [x] 3.7 Clicking a weight segment does not submit the form — 8050274
- [x] 3.8 Profile-incomplete user cannot reach `/people/new` directly — 8050274

### Phase 4: People list + navigation

#### Automated

- [x] 4.1 Type checking passes (`npx astro check`) — 7d957db
- [x] 4.2 Build succeeds (`npm run build`) — 7d957db
- [x] 4.3 Linting passes (`npm run lint`) — 7d957db

#### Manual

- [x] 4.4 Empty state renders for a profile-complete user with zero people, CTA reaches `/people/new` — 7d957db
- [x] 4.5 Added person's card shows correct relationship type, description, collective marker, weight — 7d957db
- [x] 4.6 Two people with tied weight render as distinct cards — 7d957db
- [x] 4.7 Dashboard's two new links navigate correctly — 7d957db
- [x] 4.8 Full walk (sign up → confirm → sign in → gate → profile → empty state → add person → see it listed) succeeds end to end — 7d957db
