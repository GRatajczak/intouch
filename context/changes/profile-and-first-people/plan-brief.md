# Self-Profile and First People — Plan Brief

> Full plan: `context/changes/profile-and-first-people/plan.md`

## What & Why

Implements roadmap slice `S-01`: a user fills a short structured self-profile,
adds people to their private circle with a structured description, a
single-vs-collective marker, and a relationship weight, and sees them listed.
This is the first data the AI ranking (`S-02`) will have anything to work with —
without it, nothing downstream in the roadmap has data to run on.

## Starting Point

`public.people` exists but is bare (`id`, `owner_id`, `created_at` only) with
full owner-scoped RLS already proven by `per-user-data-isolation` (F-01). No
`profiles` table exists. The design system (F-03) restyled every existing
screen but explicitly left "add-person form, people catalog" out of scope — so
this slice also builds the first non-auth form/list UI primitives the app has.
The only form precedent in the repo is the auth flow's plain `useState` +
manual-validation + native-POST pattern; no schema-validation library exists
yet.

## Desired End State

A signed-in user without a profile is redirected to `/profile` the moment they
try to reach `/people`. Filling that form unlocks `/people`, which shows an
illustrated empty state until they add someone via `/people/new` — after which
their circle renders as cards with name, relationship type, description, a
collective marker, and a 1–10 weight indicator. The dashboard links to both new
routes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Weight scale | **1–10**, amending PRD FR-004 from its original 1–5 | User's explicit call during questioning; PRD amended in-session so `S-02`/`S-03` don't inherit a stale spec |
| Self-profile fields | Name, age range (3-bucket enum), life context (4-value enum + "other" detail) | Selectable fields per FR-002's structured-form intent, gives the AI concrete framing signal without free text |
| Person fields | Name, relationship type (5-value enum), description, single/collective dropdown, weight | Relationship type gives the AI a categorical prior before it even reads the description |
| Data model | New `profiles` table (owner_id PK) + typed columns added to `people` | Typed/constrained columns are queryable and sortable; matches F-01's per-table RLS pattern |
| Weight input | 10-segment clickable selector (interactive) / indicator (display) | More legible than a native select, matches the "weight indicator" primitive named in the roadmap |
| Profile gate | **Hard gate** — `/people*` redirects to `/profile` until a profile row exists | User's explicit call; guarantees `S-02`'s ranking always has self-profile context to work with |
| Validation | New shared Zod schemas (`src/lib/validation/`) used by both form and API route | User's explicit call; first schema-validation library in the repo, scoped to just these two forms |
| Cascade | `profiles.owner_id` gets `ON DELETE CASCADE`, matching `people` | Consistent with the existing pattern; no competing soft-delete requirement exists yet |
| Routing | Dedicated pages: `/profile`, `/people`, `/people/new` | Matches the existing Astro page-per-route pattern from the auth flow |

## Scope

**In scope:**
- `profiles` table + `people` schema extension, RLS, regenerated types, extended `verify:rls`
- Self-profile form (create + edit via upsert) at `/profile`, gating middleware
- Add-person form at `/people/new`
- People list at `/people` (empty state + cards), dashboard nav links
- New shared UI primitives: `TextField`, `SelectField`, `WeightSelector`/`WeightIndicator`, `PersonCard`, `EmptyState`

**Out of scope:**
- Editing, deactivating, or deleting a person (`S-05`)
- AI contact hierarchy / ranking (`S-02`)
- Categories/tabs for browsing people (`FR-006`, nice-to-have, unroadmapped)
- Any change to the existing auth forms or their validation approach
- CI wiring for `verify:rls`, automated production migration push (stay manual)

## Architecture / Approach

Four phases, schema → self-profile → add-person → list. New product-form
primitives live under `src/components/forms/` and `src/components/people/`,
kept separate from `src/components/auth/` so the working auth flow is never
touched. Both new forms follow the exact shape of `SignUpForm.tsx`: client
React island + `useState`, native POST to an Astro API route, redirect with
`?error=` on failure — the only change is validation now runs through a shared
Zod schema instead of hand-written checks.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data model | `profiles` table, extended `people` columns, regenerated types, extended `verify:rls` | `NOT NULL` columns without a `DEFAULT` only work because `people` is still empty — a one-time window, called out in Migration Notes |
| 2. Self-profile flow | `/profile` page + form + API route, middleware hard gate | Gate must exclude `/profile` itself or an incomplete profile loops against its own redirect target |
| 3. Add-person flow | `/people/new` page + form + API route, `WeightSelector`, `SelectField`, `TextField` | New form primitives are shared with Phase 4's display components — keep the segment styling in one place so they don't drift |
| 4. People list + navigation | `/people` list, empty state, `PersonCard`, `WeightIndicator`, dashboard links | Tied-weight rendering is also the manual precondition `S-02`'s tie-breaking acceptance criterion later depends on |

**Prerequisites:** F-01 (`per-user-data-isolation`, done) and F-03 (`design-system-foundation`, done) — both satisfied.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- `life_context_detail`'s "required only when life_context = other" rule is
  enforced in Zod, not a DB constraint — a direct API call bypassing the form
  could in principle write a null detail for "other"; acceptable since this is
  a single-user-writes-their-own-row table with no adversarial multi-tenant
  surface here.
- The people list's default sort (weight desc, then created_at asc as tiebreak)
  is a plan-time choice, not a PRD requirement — revisit if `S-02`'s ranking
  view wants a different default ordering for the same data.

## Success Criteria (Summary)

- A profile-complete user can add a person and see them listed with all
  submitted fields rendered correctly, including a tied-weight case rendering
  as distinct cards.
- A profile-incomplete user cannot reach `/people` or `/people/new` without
  first being routed through `/profile`.
- `npm run verify:rls` passes for both `profiles` and the extended `people` schema.
