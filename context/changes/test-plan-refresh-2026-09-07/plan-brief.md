# Test-plan refresh (§2/§3) — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-09-07/plan.md`
> Research: `context/changes/test-plan-refresh-2026-09-07/research.md`

## What & Why

`context/foundation/test-plan.md` has drifted from the repository in both
directions: it still lists risks that are now fully covered, it misses a failure
that reached production, and its rollout table records two phases as `not started`
that product slices already delivered. This revises `§2` and `§3` to match reality —
scoped, not a rewrite. `§1` stays frozen; `§7` is re-confirmed, not edited.

## Starting Point

`§2` holds 7 risk rows at its 5–7 budget ceiling. `§3` holds 5 phases, only one
marked complete. Since the research doc was written (25 commits back), PostHog
shipped with zero tests, S-05 delivered `§3` Phase 2's erasure coverage, and S-04
delivered Phase 5's delivery half — none of it reflected in the document. Separately,
`context/changes/feedback-triage-2026-09-08/` records a production failure that Risk
#3 does not cover.

## Desired End State

`§2` holds 7 rows — every surviving row keeping its original number — each with a
matching Risk Response Guidance row. `§3` says what is genuinely left: one CI gate,
one input/recovery phase, one AI-contract phase, one analytics-privacy phase, with the
phases that shipped elsewhere attributed to the slice that shipped them. `§8` carries
refreshed dates plus a written rule for when a risk row may be retired.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Findings 1–3 from `change.md` | Rejected | One atomic multi-row insert behind server-side Zod + DB CHECKs; the scenarios are structurally unreachable | Research |
| The real write-path defect | Admitted as #8 | Draft cleared before the POST — deterministic, observable today, oracle is a user statement | Research |
| Production AI failure | Widen #3, no new row | Schema-valid response contradicting a held fact is the same user-visible failure (a wrong order stated as fact); Likelihood Medium → High | Plan |
| PostHog PII | Admitted as #9 | Research's "no surface exists, defer" is stale — analytics shipped with zero tests; the closed union binds compile time, not the consent gate or the opt-out inversion | Plan |
| First freed slot | Merge #1 + #5 | Same failure at two callers, one phase, one instrument, both already delivered | Research |
| Second freed slot | Retire #2 to `§8` | Full end-to-end coverage exists (`erasure.test.ts`); the map tracks open risk, not history | Plan |
| Risk #6 | Reworded | Its stated bug does not exist — two layers defend it; the real gap is the missing row-count cap | Research |
| Hot-spot "staleness" | Rejected as a measurement artifact | Counted by distinct commits, `src/pages/api` is still hottest — exactly what `§2` cites | Research |
| Risk numbering | Stable, non-contiguous | `.claude/hooks/` and `§5` cite "Risk #1"; renumbering breaks hook config silently | Plan |
| Retirement precedent | Written threshold in `§8` | Full end-to-end coverage **and** a complete `§3` phase — a bar #7 does not meet, so #7 stays | Plan |

## Scope

**In scope:** `§2` risk table and Risk Response Guidance; `§3` phase statuses,
sequencing and one new phase; the ripple into `§5`, `§7` and `§8`.

**Out of scope:** `§1` principles; any file under `src/` or `tests/`; writing the
tests these phases schedule; fixing the draft-loss defect or the missing `.max()`;
the prompt-wording question (routed to a product change); re-running the hot-spot scan.

## Architecture / Approach

Three passes over one Markdown file. `§2` first, because `§3`'s sequencing depends on
which rows exist; then `§3`; then the ripple. The budget arithmetic is the spine:
7 rows − 1 consolidation − 1 retirement + 2 admissions = 7.

Resulting map: **#1** (access boundary, both callers), **#3** (AI output contradicts a
held fact or varies run-to-run), **#4** (stuck job), **#6** (unbounded bulk insert /
prompt injection), **#7** (scheduled sweep), **#8** (draft loss), **#9** (analytics PII).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Rebuild `§2` | 7-row map + matching guidance rows | Merged #1 reads as two rows stapled together; document left citing `#5` until Phase 2 |
| 2. Reconcile `§3` | True phase statuses, new Phase 6, attribution | Attributing a phase to a slice that only partly delivered it |
| 3. Ripple `§5`/`§7`/`§8` | Refreshed ledger + retirement threshold | A threshold loose enough to justify retiring #7 next time |

**Prerequisites:** None. Research is complete; every claim in it has been re-verified
against the current tree.
**Estimated effort:** One session, three phases, one file.

## Open Risks & Assumptions

- The research doc is anchored at `177efb6` and its PostHog and `§3`-status
  conclusions are superseded here. Anyone reading it later should read this plan's
  "Current State Analysis" alongside it.
- Widening #3 makes Phase 3 broad — fixture contract *and* determinism. If that phase
  proves too large when planned, the split happens there, not in the map.
- #9 is admitted against a surface that is currently correct. Its value is pinning an
  invariant, not closing a hole — the same shape as the reworded #6, and it should be
  judged on that basis rather than on defect count.

## Success Criteria (Summary)

- `§2` answers "what could still fail?" in 7 rows, each traceable to evidence
- `§3` answers "what is left to build?" without cross-referencing the archive
- A future refresh has a written rule for retiring a row, strict enough that applying
  it to #7 today keeps #7 on the map
