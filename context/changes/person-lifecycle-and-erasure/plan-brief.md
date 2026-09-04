# Person Lifecycle and Erasure — Plan Brief

> Full plan: `context/changes/person-lifecycle-and-erasure/plan.md`

## What & Why

A user can edit an existing person, deactivate them so the AI stops considering them while their contact history is retained, reactivate them, and — only once deactivated — permanently and irreversibly delete them. This is roadmap slice `S-05`, PRD `FR-005`, and closes the binary, GDPR-adjacent erasure NFR: "deleting a person's data is fully and irreversibly honored."

## Starting Point

`people` has no lifecycle state today — every owned row is implicitly active, and only `POST /api/people.ts` exists (bulk create only; no read-one, update, or delete route for a person). The AI ranking query, the dashboard's people count, and the `/people` catalog all read every owned person unfiltered. Critically, the two FK chains erasure depends on — `ranking_entries.person_id` and `contact_events.person_id`, both `ON DELETE CASCADE` onto `people` — already exist and are already correct; a real row delete already wipes all derived data. What's missing is everything upstream: the lifecycle state, the routes, and the UI.

## Desired End State

From `/people`, a user opens a person's detail page, can edit any field, flip them between active and deactivated with one click each way, and — once deactivated — delete them behind a clear "this cannot be undone" confirmation. Deactivated people stay visible in the catalog (dimmed, badged, demoted to the end) but vanish from AI ranking runs and the dashboard's count. Deletion is proven irreversible by a repeatable verification script.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Lifecycle column shape | `status` enum (`text` + check constraint: `active`/`deactivated`) | Matches every other enum-as-text-check column already on `people`; leaves room for a future third state without a column-type migration. |
| Deactivated-person visibility | Same `/people` grid, visually demoted (dimmed + "nieaktywna" badge) | The design mock (`InTouch.dc.html:495-505`) already specifies exactly this treatment — no filter chip / hidden-toggle needed. |
| Where actions live | Dedicated `/people/[id]` detail page | Matches the mock's own profile-card layout; gives the destructive actions room apart from the browsing grid. |
| Edit form | New single-person `PersonEditForm`, built on `personSchema` directly | Keeps the JSON-PATCH convention (`contact-events/[id].ts`) clean rather than retrofitting `PersonForm`'s bulk-add, multipart-POST state machine. |
| Delete confirmation | New shadcn `AlertDialog` | Semantically the right primitive for a genuinely irreversible action; `radix-ui` is already a dependency, so this adds zero new packages. |
| Reactivation | Allowed, one click back to active | FR-005 never frames deactivation as a dead end, and this MVP has no support channel to recover from an accidental one-way deactivation. |
| Deletion audit trail | None — not even a content-free timestamp log | The NFR says "fully and irreversibly honored"; any record that a specific person existed and was deleted is itself residual personal data. |
| Dashboard people count | Active people only | "How many people are in your circle" should mean people still being tracked/ranked, not everyone ever added. |

## Scope

**In scope:**
- `people.status` migration + regenerated types
- `PATCH`/`DELETE /api/people/[id]` (edit, deactivate, reactivate, delete — with server-side sequencing enforcement)
- Ranking query, dashboard count, and catalog ordering all respecting `status`
- `/people/[id]` detail page, `PersonDetailView`, `PersonEditForm`, updated `PersonCard`
- `scripts/verify-erasure.ts`

**Out of scope:**
- Bulk deactivate/delete, undo-delete
- Any deletion audit trail
- Account-level deletion (`S-07`'s open question)
- The design mock's "Nieaktywni · N" filter chip / category chips (`FR-006`, parked)
- Rebuilding the contact-history timeline on the detail page (reuses `ContactHistorySheet`)

## Architecture / Approach

One PATCH route, one DELETE route, following `contact-events/[id].ts`'s exact JSON-route shape (double owner-scoping, 404-not-403, Polish error strings). `PATCH` handles both field edits and status transitions since both are "update this person"; `DELETE` is the sole place the deactivate-before-delete rule is enforced server-side, independent of UI gating. No FK or cascade changes — the erasure guarantee already exists in the schema; this slice only adds the state and the paths that reach it. UI-side, a single `/people/[id]` page toggles between a view mode and an edit mode in one React island, rather than a second edit route.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data model | `people.status` column + regenerated types | Low — purely additive, defaulted |
| 2. API routes | `PATCH`/`DELETE /api/people/[id]` | Business-rule enforcement must live server-side, not just in UI gating |
| 3. AI exclusion + counts | Ranking/dashboard/catalog filters | Easy to miss one of the three read sites |
| 4. Detail page + UI | `/people/[id]`, edit form, actions, `AlertDialog` | Largest phase — new page, two new components, one new shadcn primitive |
| 5. Erasure verification | `scripts/verify-erasure.ts` | Must prove the binary NFR, not just spot-check it |

**Prerequisites:** `S-01` (done) — the `people` table and its owner-scoped RLS pattern this slice extends.
**Estimated effort:** ~2-3 sessions across 5 phases.

## Open Risks & Assumptions

- The design mock never shows a delete button or a deactivated person's own detail view — the delete UX and the reactivated-state copy are designed fresh in this plan, not transcribed from the mock.
- `npm run verify:erasure` (Phase 5) requires a local Supabase instance, same precondition every other `verify:*` script already carries.

## Success Criteria (Summary)

- A user can complete edit → deactivate → reactivate → deactivate → delete on a real person end-to-end in the browser.
- A deactivated person is provably absent from the next AI ranking run and the dashboard's count.
- `npm run verify:erasure` proves zero rows survive anywhere after deletion, and that deletion is rejected before deactivation.
