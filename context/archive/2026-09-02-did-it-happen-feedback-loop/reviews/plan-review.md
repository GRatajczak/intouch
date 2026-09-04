<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Did-It-Happen Feedback Loop

- **Plan**: context/changes/did-it-happen-feedback-loop/plan.md
- **Mode**: Deep
- **Date**: 2026-09-02
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 2 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict (initial) | After triage |
|-----------|-------------------|--------------|
| End-State Alignment | FAIL | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | FAIL | WARNING (F3 skipped) |
| Plan Completeness | WARNING | PASS |

Two FAILs would read RETHINK by the mechanical rubric, but the approach was sound — both were
targeted fixes (move one endpoint earlier; add an ownership check), not structural rework.

## Grounding

13/13 paths ✓, 11/11 cited line refs ✓, brief↔plan ✓, Progress format ✓.
Blast radius verified: `buildRankingPrompt` has 1 caller (`run.ts:99`), `PersonCard` 1
(`people/index.astro:51`), `HierarchyCard` and `RefreshBanner` 1 each (`HierarchyView.tsx`) —
all named in the plan. Post-triage re-check: 5 phases, 46 Progress items, 0 mismatches,
sequential numbering 1.1–5.7.

## Findings

### F1 — Phase 3 cannot satisfy its own success criterion 3.5

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §2 (ContactMarker) vs. criterion 3.5; Phase 4 §2
- **Detail**: Criterion 3.5 requires the note to be addable *after* answering, but Phase 3's contract had it riding on the initial POST, and PATCH — the only endpoint that could attach a note to an existing event — landed in Phase 4. The contract text was also self-contradictory ("a bounded optional note that PATCHes nothing… sent with a second POST-less update only in Phase 4"), leaving the implementer no coherent instruction. They would have pulled PATCH forward undocumented, or moved the note ahead of the answer, silently reverting the frictionless decision.
- **Fix A ⭐ Recommended**: Move `PATCH /api/contact-events/[id]` into Phase 1.
  - Strength: ~15 lines beside the POST it shares validation and the 404 rule with; Phase 3 becomes self-contained.
  - Tradeoff: Phase 1 grows slightly; PATCH ships one phase before the sheet that is its other consumer.
  - Confidence: HIGH — same file, same auth shape, no new concepts.
  - Blind spot: None significant.
- **Fix B**: Note field visible (collapsed) before the answer, one POST.
  - Strength: No endpoint moves; the write path stays a single insert.
  - Tradeoff: Reverts the "answer commits alone" decision.
  - Confidence: HIGH — mechanically simple.
  - Blind spot: Whether a collapsed field reads as optional is untested.
- **Decision**: FIXED via Fix A — new Phase 1 §5 (note-attachment endpoint), Phase 3 §2 contract rewritten, Phase 4 §2 narrowed to GET + DELETE + widening PATCH, criteria 1.9/1.10 added.

### F2 — POST accepts another user's personId; criterion 1.8 asserted otherwise

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (migration) and §4 (create endpoint); criterion 1.8
- **Detail**: `owner_id` comes from the session and `person_id` from the body. RLS on `contact_events` only checks `owner_id`, and Postgres does not apply RLS when validating a foreign key — so the `people(id)` reference succeeds even for a row the caller cannot read. User A could write an A-owned event pointing at user B's person. Nothing leaks (A must already know the UUID), but the row's `person_id` resolves to nothing under A's own RLS, corrupting the facts fold. Criterion 1.8 asserted this "fails rather than writing a row"; nothing in the plan made that true.
- **Fix A ⭐ Recommended**: Endpoint validates the person under the caller's RLS before insert, 404 if absent.
  - Strength: Reuses the 404-not-403 rule already specified for `[id].ts`; no change to an existing table.
  - Tradeoff: One extra round-trip; a future endpoint that forgets the check reopens the hole.
  - Confidence: HIGH — same posture as `src/pages/api/rankings.ts`.
  - Blind spot: None significant.
- **Fix B**: Composite FK `(person_id, owner_id)` → `people(id, owner_id)`.
  - Strength: Database-enforced; no endpoint can bypass it.
  - Tradeoff: Needs `UNIQUE (id, owner_id)` on `people`, touching an existing table.
  - Confidence: MEDIUM — correct in principle, unchecked against S-05's needs.
  - Blind spot: Whether S-05 assumes anything about `people`'s constraint set.
- **Decision**: FIXED via Fix A — Phase 1 §4 contract extended, and recorded in "Critical Implementation Details" as "A foreign key is not an authorization check" so it survives a phase-by-phase read.

### F3 — No phase pushes the migration to the hosted Supabase project

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 criteria 1.1–1.3; Phase 2 criterion 2.4; Migration Notes
- **Detail**: Every Phase 1 automated criterion runs against the local stack. Phase 2's 2.4 and all of Phase 5 run against a deployed Worker pointing at the hosted project. Migration Notes mentions pushing to hosted in prose, but no phase has it as a step or criterion. It fails quietly rather than loudly: a facts-load failure degrades to an empty map by design, so `verify:ranking` would pass at Phase 2 while proving nothing about history.
- **Fix**: Add an explicit step and criterion to Phase 1 — push the migration to the hosted project and confirm `contact_events` exists there — before any phase verifies against a deployed URL.
- **Decision**: SKIPPED — the user chose to leave this to implementation time.

### F4 — Per-card sheet hydration ignored the repo's single-island pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 §4 (sheet entry points), §5 (catalog facts)
- **Detail**: The plan hydrated `PersonCard` with `client:visible` so each card could open its own sheet — turning a grid of N people into N islands, each with its own Radix dialog subtree. The repo already solved this: `Toaster` is mounted once in `src/layouts/Layout.astro:70` and driven from anywhere by a `CustomEvent` (`src/components/layout/Toaster/toast.ts:9-17`), whose own comment states the reasoning. Ignoring it introduced a second way to do overlays. Separately, `client:visible` appears nowhere in this codebase — all five hydrated components use `client:load`.
- **Fix A ⭐ Recommended**: One `ContactHistorySheet` island opened by a `CustomEvent`.
  - Strength: Reuses the documented Toaster seam; `PersonCard` stays static server-rendered HTML; the same sheet serves the hierarchy card with no second mount.
  - Tradeoff: The open-event payload has to be typed and kept in sync, as `toast.ts` does.
  - Confidence: HIGH — the pattern is already proven in this repo.
  - Blind spot: Whether the sheet needs card-local React state an event payload can't carry.
- **Fix B**: Keep per-card islands, switch `client:visible` → `client:load`.
  - Strength: Minimal edit; consistent with the five existing directives.
  - Tradeoff: Still N islands and a second overlay pattern.
  - Confidence: MEDIUM — works, but trades the wrong thing away.
  - Blind spot: Grid size at realistic circle sizes unmeasured.
- **Decision**: FIXED via Fix A — Phase 4 §3 now mounts once and adds an `openContactHistory` module mirroring `toast.ts`; §4 mounts it in `Layout.astro`; §5 states `PersonCard` stays un-hydrated; criterion 4.10 now also asserts no per-card island.

### F5 — Criterion 3.8 needed wrangler tail, which Phase 3 cannot produce

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 criterion 3.8
- **Detail**: 3.8 asked to confirm "no OpenAI call fires on a mark" via `wrangler tail` against a deployed version, but Phase 3 has no deploy in its criteria, and `lessons.md` records that tail streams nothing until a `versions deploy` syncs the non-versioned observability setting. It also aimed at something provable far more cheaply — the mark path is `/api/contact-events`, which imports no OpenAI code at all.
- **Fix**: Restate 3.8 as a browser network-tab check; leave tail-based assertions to Phase 5.
- **Decision**: FIXED — 3.8 now asserts one request to `/api/contact-events` with no `POST /api/rankings` following.

### F6 — hasPendingAnswers was never cleared after a recompute

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §5 (view state), §6 (banner line)
- **Detail**: The plan set the flag when a mark returned but never cleared it. Once a recompute lands, `HierarchyView`'s poll "done" branch swaps in a ranking that already incorporates the answers, while the banner keeps promising an update that has happened — so the one line carrying the whole "loop worked" signal would go permanently stale after first use.
- **Fix**: Clear the flag in the poll's `done` branch alongside `setRanking`.
- **Decision**: FIXED — Phase 3 §5 contract now specifies it.

### F7 — Criterion 2.7 asserted monotonicity on a stochastic model

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 criterion 2.7
- **Detail**: "A person whose last attempt failed ranks no lower than before that attempt was recorded" can fail for legitimate reasons — the plan deliberately leaves ordering to the model, and two runs differ even on identical input. As written it could block a phase on model whim while proving nothing.
- **Fix**: Reword to assert citation rather than rank monotonicity.
- **Decision**: FIXED — 2.7 now reads "has that attempt cited in their `Dlaczego teraz`, named as a reason to reach out sooner".

### F8 — Two Progress entries drifted from their Success Criteria text

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress items 3.8 and 5.5
- **Detail**: Structurally the Progress block was valid — one heading, five phases matching by name, every criterion mirrored, no checkboxes in phase bodies. But 3.8 dropped a `**not**` emphasis and 5.5 dropped its `lessons.md` parenthetical, so the texts were not verbatim copies. A fidelity nit only; `/10x-implement` parses either way.
- **Fix**: Sync both strings to their Success Criteria wording.
- **Decision**: FIXED — 3.8 synced as a side effect of F5; 5.5 synced directly. Post-triage check: 46 items, 0 mismatches.
