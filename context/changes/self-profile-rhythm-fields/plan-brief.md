# Self-Profile Rhythm Fields — Plan Brief

> Full plan: `context/changes/self-profile-rhythm-fields/plan.md`

## What & Why

Roadmap slice `S-09` adds three optional rhythm selectors to the existing `/profile` form — how much time the user realistically has in a week, how they prefer to reach out, and when in the week they have space for it. They are the sole source of the `Twój rytm` factor the design shows in its hierarchy card and reminder email. Without them `S-02`'s ranking can produce a *who* and a *how urgent*, but has nothing to derive a channel, a slot, or a realistic weekly cap from.

## Starting Point

`S-01` shipped the `profiles` table and the `/profile` form (name, birth date, life context) under the `F-01` owner-scoped RLS contract. The form is a React island posting natively to `src/pages/api/profile.ts`. There is no test runner in the repo — verification is `eslint`, `astro check`, standalone `tsx` scripts, and manual checks.

The complication: **an implementation of this slice already exists, uncommitted, and its migration is already applied to the remote database.** It passes lint and typecheck. The planning session chose to discard it and re-derive the slice fresh from the design bundle — which means the plan has to unwind a production schema change before it can build anything.

## Desired End State

A signed-in user opening `/profile` sees the existing fields plus an optional "Twój rytm" section with three chip-selector groups. They fill none, some, or all; save; return, and see their answers still selected. A user who filled their profile before this slice sees the section empty and is never blocked or bounced back through the form. Screen readers announce each chip group by its label rather than reading orphaned controls.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Existing implementation | Revert and re-derive from scratch | Run the real research→plan→implement chain rather than ratify code that arrived without one. | Plan |
| Fidelity of re-derivation | Fully fresh | Column names, enum values and Polish copy come from the design bundle, not from the discarded code. | Plan |
| Prematurely-applied remote schema | Unwind remote too | "Fully fresh" is only honest if the live columns go — safe because the code reading them was never committed or deployed. | Plan |
| Field set | The three design fields 1:1 | A fourth `weekly_contact_goal` candidate duplicates the time budget and lengthens a form the persona is expected to abandon. | change.md |
| Placement | Single card on `/profile` | The design's "krok 2 z 3" wizard needs inter-step state and abandonment handling — separate work. | change.md |
| Requiredness | Optional, never gated | Profiles filled before this slice keep working; `S-02` degrades gracefully when the fields are empty. | change.md |
| Availability windows | Multi-select | An array tolerates one element; the reverse doesn't — even though the mock shows one pill selected. | change.md |
| Chip a11y | Built correct in Phase 2 | `role="radiogroup"`/`"group"` + `aria-labelledby` is a build requirement, not a follow-up — `jsx-a11y` won't catch its absence. | Plan |
| Design bundle | Commit, minus `project/uploads/` | Source comments cite `InTouch.dc.html` line numbers; the `uploads/` copies duplicate `context/foundation/` docs at stale versions. | Plan |
| "No answer" modelling | Left inconsistent (null vs `[]`) | Unifying it needs a second migration against a live column under the add-then-drop rule — deferred, `S-02` handles both. | Plan |

## Scope

**In scope:** three optional columns on `profiles`; a reusable a11y-correct `ChoiceChips` component; the "Twój rytm" section on `/profile`; extended RLS verification seeds; the design bundle committed; roadmap and Linear synced.

**Out of scope:** the 3-step onboarding wizard; a fourth `weekly_contact_goal` field; the design's `Push` channel (FR-008 is email-only); anything on the *person* form; wiring these fields into any prompt, ranking or reminder; deploying the Worker.

## Architecture / Approach

Unwind first, then rebuild bottom-up in the order this repo's data features already follow:

```
Phase 0  drop remote columns → repair history → delete migration → db reset → revert src/
Phase 1  migration → db:types → verify-rls seeds
Phase 2  validation contract (enums, labels, parseForm/toRow) + ChoiceChips component
Phase 3  ProfileForm section → profile.astro hydration
Phase 4  design bundle → commit → roadmap → Linear
```

`src/pages/api/profile.ts` needs no change — the new fields ride behind the existing `parseForm` / `toRow` calls. PRD and roadmap amendments from the planning session survive Phase 0; only `src/`, `scripts/` and `supabase/migrations/` are reverted.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 0. Unwind | Both databases and the tree back to pre-slice | Destructive DDL against production; drop must precede history repair |
| 1. Schema | Three columns re-derived, applied local + remote, types regenerated | Fresh derivation lands values that differ from the discarded version |
| 2. Contract + component | Validation contract and an a11y-correct `ChoiceChips` | ARIA grouping is invisible to lint — skipping it goes unnoticed |
| 3. Form + page | The section live on `/profile`, hydrating from the saved row | Three chip groups crowding a card sized for three text fields |
| 4. Close-out | Commit, design bundle, roadmap + Linear synced | The Linear mirror is the step `lessons.md` exists because `F-05` skipped |

**Prerequisites:** `S-01` shipped; linked Supabase project reachable (`supabase migration list` works); a human available to authorize Phase 0's production DDL.
**Estimated effort:** ~1–2 sessions across five phases; Phase 0 is minutes of commands plus a confirmation, Phases 1–3 are the real work.

## Open Risks & Assumptions

- **Phase 0 runs DDL against the live database.** Safe only because the code reading those columns was never committed or deployed — re-verify with `git log origin/main -1` immediately before running, since it stops being true once this slice ships.
- **Discarding known-green code is a deliberate cost.** The reverted implementation passes lint and typecheck today; the fresh pass may land different labels or component internals. A recoverable patch is saved in this session's scratchpad, but that location is session-scoped — copy it somewhere durable if it may be wanted later.
- **`migration repair` rewrites remote migration history.** If the drop succeeds and the repair fails, `supabase migration list` reports the inconsistency plainly; the reverse order would leave silent orphan columns.
- **No test runner** means Phases 2–3 lean on manual verification, including the screen-reader check that is the only real proof of the a11y contract.

## Success Criteria (Summary)

- A user can fill any subset of the three rhythm fields on `/profile`, save, and find them still selected on return — and can clear a single-answer chip back to "no answer".
- A profile filled before this slice opens with the section empty, saves cleanly, and is never bounced back through the form.
- Each chip group is announced by its visible label with correct selected state, and is fully operable by keyboard.
