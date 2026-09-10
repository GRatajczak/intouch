# Test-plan refresh (§2/§3) Implementation Plan

## Overview

A scoped revision of `context/foundation/test-plan.md`. `§2`'s risk map is
restructured — one consolidation, one retirement, one widening, one rewording,
two admissions — landing back at 7 rows, inside the 5–7 budget. `§3`'s phase
statuses are reconciled with work that shipped **outside** the rollout (S-04 and
S-05 delivered two phases' worth of tests without touching `§3`), and the two new
risks are sequenced. `§1` principles stay frozen; `§7` negative space is confirmed
unchanged.

This is a documentation change. No source file under `src/` is touched.

## Current State Analysis

`§2` holds 7 rows and is at its budget ceiling. `§3` holds 5 rollout phases, of
which only Phase 1 is marked `complete`. Both sections have drifted from the
tree.

**What the research doc established and this plan accepts** (research is anchored
at `177efb6`; verified still true at `0d1acd0`):

- The add-person write path is **one atomic multi-row `INSERT`** behind a
  server-side Zod parse and a full set of DB CHECK constraints. The partial-write,
  inert-context, and misreported-outcome scenarios in `change.md` are all
  structurally unreachable. Three of the four proposed findings are rejected.
- The real, unproposed defect: `PersonForm.tsx:196` clears the saved draft
  **before** the native POST is issued, so any server rejection lands the user on
  a blank form with everything they typed gone. Confirmed still present.
- `peopleFormSchema` (`person.ts:56`) is `z.array(personSchema).min(1)` with **no
  `.max()`**, and `parseForm` loops while indexed fields exist. One request drives
  an unbounded bulk insert.
- Risk #6's "must challenge" cell describes a bug that does not exist: both write
  routes run the shared Zod module server-side, with DB CHECKs underneath.
- The hot-spot "staleness" finding is a **measurement artifact** — counted by
  distinct commits rather than file touches, `src/pages/api` is still the hottest
  directory, exactly as `§2` already cites. No existing likelihood rating is
  contradicted by churn.

**What has changed since the research doc was written, and it did not see** — 25
commits landed between `177efb6` and `0d1acd0`, three of which invalidate its
conclusions:

- **PostHog shipped and archived.** Research recommended deferring the row because
  "no surface exists in code today". `src/lib/analytics/` now holds five modules,
  five live events, a consent gate and an opt-out control, with **zero tests**.
  The recommendation is stale; the row is admitted.
- **`§3` Phase 2 (erasure) was delivered by S-05**, as `tests/routes/erasure.test.ts`
  — five tests covering the full deactivate → history → ranking-input → delete →
  404 sequence. `§3` still says `not started`.
- **`§3` Phase 5's delivery half was delivered by S-04**, as four test files over
  the sweep's cadence, recipient and failure-recording. Its local-gates half landed
  as `.husky/pre-commit` + `.claude/hooks/`. What genuinely remains is the CI gate:
  `.github/workflows/ci.yml:29-30` and `deploy.yml:33-34` run `npm run lint` and
  `npm run build` — **no `vitest`**, so the suite blocks nothing.
- The suite grew from 7 files to 14.

**Evidence neither upstream document saw.** `context/changes/feedback-triage-2026-09-08/`
records production tester feedback, which `§1` principle #2 makes first-class. It
documents a failure Risk #3 does not cover: a **schema-valid** ranking response that
contradicted a fact the system itself held — the card rendered "Ostatni kontakt dziś"
and "szacunkowo 2–6 miesięcy temu" three lines apart — and returned three different
answers to one unchanged input. Risk #3 is scoped to *malformed / partial / nonsense*
responses; "parsed fine, contradicts our own data" falls through it, and it reached
production.

### Key Discoveries

- Risk numbers are **load-bearing outside this document**. `.claude/hooks/` scope
  their `vitest related` run to "the Risk #1 surface", `§5` reads "wired for Risk #1
  only", and roadmap `F-07` plus the archived Phase 1 change cite phase numbers.
  Renumbering the map would silently invalidate hook configuration.
- `applyRecencyFloor` shipped with 14 unit tests (`tests/unit/recency-floor.test.ts`),
  which closes the *specific* production bug but not the class: the floor is a lower
  bound on one field, and does not touch the frozen-prose contradiction (triage F-3)
  or any future fact/output disagreement.
- The opt-out inversion lives in exactly one place (`src/lib/validation/settings.ts:55`)
  — the UI's positive "analytics on" maps to the DB's negative `analytics_opt_out`.
  A single-place inversion is a single-place inversion *bug* surface, and no test
  covers it.
- `capture()` never throws by design, and `hasAnalyticsConsent` fails **open to
  silence** on a query error. Both are correct choices that also mean a broken
  analytics path is invisible without a test asserting it.

## Desired End State

`context/foundation/test-plan.md` `§2` holds 7 risk rows whose numbering is
unchanged for every surviving row, each with a matching Risk Response Guidance row.
`§3` records what is actually left to do — one CI gate, one input/recovery phase,
one AI-contract phase, one analytics-privacy phase — and attributes the phases that
shipped elsewhere to the slice that shipped them. `§8` carries refreshed dates plus
a written threshold governing when a risk row may be retired.

Verify by reading the document: the map has 7 rows, no `§3`/`§5`/`§6` text cites a
risk number that no longer exists, and every admitted row traces to evidence in
`change.md`, `research.md`, or `feedback-triage-2026-09-08/`.

## What We're NOT Doing

- **Not renumbering `§2` or `§3`.** Stable ids; the map goes non-contiguous (1, 3,
  4, 6, 7, 8, 9) on purpose.
- **Not touching `§1`.** Principles stay frozen, as `change.md` requires.
- **Not changing `§7`.** Re-read against the new rows; the e2e exclusion still holds
  — every admitted row is reachable at the integration layer. Confirmed, not edited.
- **Not writing any test.** This plan revises the map and the rollout. The tests are
  written by the phases `§3` schedules.
- **Not touching `src/`.** The draft-loss defect and the missing `.max()` are recorded
  as risks here; fixing them belongs to the phases that cover them.
- **Not promoting the prompt-wording question** ("should the system message name
  `Kontekst` and `Tagi`?"). Research routed it to a product change: its only oracle
  is a judgment about model behaviour, and `§7` already excludes judging suggestion
  quality.
- **Not re-running the hot-spot scan.** Research established the churn numbers and
  the counting-convention correction; this plan cites them.

## Implementation Approach

Three passes over one file, each leaving the document internally consistent by its
end. `§2` first, because `§3`'s sequencing depends on which rows exist; then `§3`;
then the ripple into `§5`/`§7`/`§8`.

The budget arithmetic is the spine of Phase 1: 7 rows, minus one consolidation
(#1+#5), minus one retirement (#2), plus two admissions (#8, #9) = 7. Every move is
recorded with its reasoning in the document itself, so a future reader can see why
the map is shaped this way without reading this plan.

## Critical Implementation Details

**Ordering.** Phase 1 leaves the document in a knowingly inconsistent intermediate
state: `§3` Phase 1's "Risks covered" cell still reads `#1, #5` after `#5` has been
merged away. Phase 2 fixes it. Do not stop between phases and treat the document as
shippable.

**Stable ids.** When merging #1 and #5, the surviving row keeps id **#1** and absorbs
#5's evidence and guidance. Id #5 is not reused, and no row is renumbered to close
the gap. Add a one-line note under the map explaining the non-contiguity, or the next
reader will "fix" it.

## Phase 1: Rebuild the §2 risk map

### Overview

Apply the five structural moves to the risk table and bring the Risk Response
Guidance table back into one-to-one correspondence with it.

### Changes Required:

#### 1. The risk table

**File**: `context/foundation/test-plan.md` (`§2`, the main risk table)

**Intent**: Consolidate #1 and #5, retire #2, widen #3, reword #6, and admit two new
rows — landing at 7 rows with stable ids.

**Contract**: The table keeps its five columns (`#`, Risk, Impact, Likelihood,
Source). Row-by-row:

- **#1 absorbs #5.** New scenario text covers both callers — a signed-in user reaching
  another user's data, and a caller with no valid session (unauthenticated, expired,
  or a replayed recovery token). Impact High / Likelihood Medium. Source cell unions
  both rows' citations, losing none.
- **#2 removed** from the table. Its retirement is recorded in `§8` (Phase 3).
- **#3 widened** to cover a well-formed response that contradicts a fact the system
  already holds, or that varies run-to-run on identical input — keeping the existing
  malformed/partial clause. Likelihood Medium → **High**. Source cell gains
  `context/changes/feedback-triage-2026-09-08/` (production tester report, screenshot
  20:54, three refreshes / three answers).
- **#4, #7 unchanged.**
- **#6 reworded.** Scenario becomes the unbounded bulk insert plus instruction-shaped
  free text steering the ranking output. Its old scenario ("stores out-of-bounds data
  the form would have blocked") is dropped — two layers defend it.
- **#8 admitted** (new): a rejected add-person submit discards everything the user
  typed, so a multi-person entry session is lost to one constraint violation. Impact
  Medium / Likelihood Medium. Source: interview 2026-09-07; archive
  `2026-09-04-add-person-context-fields` (multi-row form kept); hot-spot dirs
  `src/components/people` (10 commits/30d), `src/pages/people` (11 commits/30d).
- **#9 admitted** (new): a person's name, description, context or free text leaves in
  an analytics event payload, or an opt-out does not actually suppress sending. Impact
  High / Likelihood Low–Medium. Source: PRD NFR-privacy (binary, GDPR-adjacent);
  roadmap F-06 outcome; archive `2026-09-04-product-analytics-posthog`.

Source cells cite evidence only — interview dates, PRD/roadmap lines, archive slice
ids, hot-spot **directories** with churn counts. No `file:line`, no function or schema
names (`§1` principle #3).

#### 2. The non-contiguity note

**File**: `context/foundation/test-plan.md` (`§2`, prose under the table)

**Intent**: Explain why ids skip 2 and 5, so a future reader does not renumber and
break `.claude/hooks/` and `§5`.

**Contract**: Two or three sentences after the existing resource-abuse paragraph.
States that ids are stable identifiers cited from outside this file, that #5 was
merged into #1, and that #2 was retired to `§8`.

#### 3. Risk Response Guidance

**File**: `context/foundation/test-plan.md` (`§2`, the guidance table)

**Intent**: Restore one-to-one correspondence with the risk table — merge two rows,
drop one, revise two, add two.

**Contract**: Same six columns (Risk, What would prove protection, Must challenge,
Context research must ground, Likely cheapest layer, Anti-pattern to avoid). Changes:

- **#1** merges the two existing guidance rows, keeping both "must challenge" clauses
  ("it is authenticated, therefore it is authorized" and "middleware guards the page,
  so the API beneath it is guarded too") and both anti-patterns. Recovery-token
  single-use and expiry semantics survive as a clause in the "must ground" cell.
- **#2** removed.
- **#3** gains: proof that a response contradicting a recorded fact does not render as
  authoritative, and that identical input yields a stable window across repeated runs.
  New "must challenge": *"the response parsed and matched the schema, so it is
  trustworthy."* Must ground: which recorded facts reach the prompt and which the model
  may override.
- **#6** "must challenge" becomes *"the boundary is defended, therefore it is proven"*
  — the honest state: two layers hold, zero tests say so. Proof cell gains a bounded
  row count per request.
- **#8** (new). Proves protection: the rows the user typed are still on the form after
  a server rejection. Must challenge: *"the error banner rendered, so the user can
  recover."* Must ground: the draft-persistence seam and the redirect-driven remount.
  Cheapest layer: component-level test over the draft store plus one route test on the
  rejection branch. Anti-pattern: asserting the banner and never asserting the form's
  contents.
- **#9** (new). Proves protection: no event payload carries a person's name,
  description, context, tags or the user's email; an opted-out user's action produces
  no outgoing call. Must challenge: *"the payload type is a closed union, so nothing
  personal can get in"* — true at compile time, silent about the consent gate and the
  opt-out inversion. Must ground: every emission point, the consent read's failure
  mode, and where the UI's positive maps to the column's negative. Cheapest layer: unit
  over the payload builder and the consent predicate, plus one route test with the
  transport stubbed at the network edge. Anti-pattern: asserting the SDK was called
  instead of asserting what the payload contained, and testing consent only in the
  consented direction.

### Success Criteria:

#### Automated Verification:

- `§2` risk table has exactly 7 data rows: `grep -c '^| [0-9]' ` over the risk table range
- Every risk id in the risk table appears in the guidance table, and vice versa
- No `file:line` pattern (`\.tsx\?:[0-9]`) appears in any `§2` Source cell
- Markdown renders without table breakage: `npm run lint` passes

#### Manual Verification:

- The merged #1 reads as one failure scenario, not two stapled together
- The widened #3 still names the malformed-response case it originally covered
- #6's new scenario is distinguishable from the resource-abuse case the map declined, and the distinction is stated
- Each new Source cell cites evidence a reader can locate, and no cell names a function or schema

**Implementation Note**: After this phase, `§3` still cites risk `#5`. That is expected — Phase 2 fixes it. Pause for confirmation on the map's shape before sequencing it.

---

## Phase 2: Reconcile §3 with what actually shipped

### Overview

Correct the phase statuses in both directions, split Phase 5 into its delivered and
remaining halves, and place the two new risks.

### Changes Required:

#### 1. Phase statuses

**File**: `context/foundation/test-plan.md` (`§3`, the rollout table)

**Intent**: Record that Phases 2 and 5-minus-CI were delivered by product slices
rather than by the rollout, and attribute them.

**Contract**: The table keeps its seven columns. Phase 1's "Risks covered" cell
becomes `#1` (was `#1, #5`). Phase 2 → `complete`, Change folder cell →
`context/archive/2026-09-04-person-lifecycle-and-erasure/` with a "delivered outside
the rollout" marker. Phase 3 keeps `#3, #4` and stays `not started`, with its goal
line extended to name the fact-contradiction and determinism half now that #3 is
wider. Phase 4 gains `#8` alongside `#6`. Phase 5's scope narrows to the CI gate
alone; its delivery half is marked complete and attributed to
`context/archive/2026-09-08-decay-driven-reminders/`, its local-gates half to
`.husky/pre-commit` + `.claude/hooks/`.

#### 2. Phase 6

**File**: `context/foundation/test-plan.md` (`§3`, new table row)

**Intent**: Give #9 its own phase — its oracle (what left the process) and its layer
(payload builder + stubbed network edge) share nothing with Phase 4's.

**Contract**: One row. Goal: no event payload carries third-party personal data, and
an opt-out actually suppresses sending. Risks covered `#9`. Test types: unit +
integration with the transport stubbed at the network edge. Status `not started`.

#### 3. Sequencing prose

**File**: `context/foundation/test-plan.md` (`§3`, prose under the table)

**Intent**: Replace the now-obsolete note about Phase 5's delivery half being gated
on S-04, and state that phase numbers are identifiers rather than execution order.

**Contract**: Short paragraph. The S-04 gate note goes (it shipped). States what
remains: Phase 3, Phase 4, Phase 5's CI gate, Phase 6 — and that Phase 1's harness is
the prerequisite all of them inherit, already met.

### Success Criteria:

#### Automated Verification:

- Every risk id cited in `§3` exists in `§2`: no `#5` or `#2` reference survives anywhere in the file
- Every `§2` risk id appears in at least one `§3` phase's "Risks covered" cell
- `npm run lint` passes

#### Manual Verification:

- The rollout table read top to bottom answers "what is left?" without cross-referencing
- Phase 5's remaining scope is unambiguously the CI gate and nothing else
- Phase 4's three concerns (bounds, prompt injection, draft recovery) read as one phase with one prerequisite, not three unrelated jobs

**Implementation Note**: Pause for confirmation that the phase attribution is right before the ripple pass.

---

## Phase 3: Ripple into §5, §7 and §8

### Overview

Bring the sections that cite `§3` phase numbers back into agreement, and record the
retirement threshold that Phase 1's removal of #2 established.

### Changes Required:

#### 1. Quality gates

**File**: `context/foundation/test-plan.md` (`§5`)

**Intent**: The two rows reading "required after §3 Phase 5" now describe the one
thing Phase 5 still is — the CI gate — and the local layers are recorded as wired.

**Contract**: The `unit + integration` and `suite blocks deploy` rows keep their
"required after §3 Phase 5" wording, which is now precise rather than approximate.
The prose below gains one line naming what CI runs today (`lint` + `build`, no
`vitest`) so the gap is stated rather than implied. The "wired for Risk #1 only" cell
is left exactly as-is — it names a hook configuration, and #1 still exists.

#### 2. Negative space

**File**: `context/foundation/test-plan.md` (`§7`)

**Intent**: Confirm the exclusions still hold against the two new rows. No edit
expected.

**Contract**: Re-read the e2e exclusion against #8 and #9. #8 is reachable at the
component + route layer (draft store, rejection branch); #9 at unit + stubbed
transport. Neither needs a browser, so the exclusion stands. If both are indeed
reachable, change nothing and note the confirmation in `§8`.

#### 3. Freshness ledger and the retirement threshold

**File**: `context/foundation/test-plan.md` (`§8`)

**Intent**: Refresh the dates, record #2's retirement with its evidence, and write
down the threshold so the precedent cannot be stretched.

**Contract**: Ledger dates bump to 2026-09-08 for the sections this revision touched;
untouched sections keep their existing dates. Two additions:

- A retirement entry: risk #2 (erasure) retired from the map on 2026-09-08, covered by
  `tests/routes/erasure.test.ts`, delivered by S-05.
- The threshold, stated as a rule: **a risk row may leave the map only when a test
  covers the entire end-to-end scenario named in its "what would prove protection"
  cell, AND the corresponding `§3` phase is complete.** Partial coverage leaves the row
  on the map. Note explicitly that #7 does *not* meet this bar — its coverage is unit
  tests over the sweep, and the S-04 roadmap question about RLS for an absent-user read
  is still open — so #7 stays.

### Success Criteria:

#### Automated Verification:

- No `§3` phase number cited anywhere in the file points at a phase that no longer exists
- `§8` contains the retirement threshold as a stated rule
- `npm run lint` passes
- Full suite still green: `npm test` (nothing in this change touches `src/` or `tests/`, so a red suite means an unrelated break worth knowing about)

#### Manual Verification:

- The threshold is written strictly enough that applying it to #7 today yields "stays on the map"
- `§7`'s exclusions were genuinely re-read against #8 and #9, not assumed
- The document reads as one coherent revision, not three passes stapled together
- `change.md` status stamped `planned`

## Testing Strategy

This change edits one Markdown file, so "testing" is document-consistency checking.

### Automated checks:

- Risk-id referential integrity in both directions between `§2`'s two tables
- No risk id cited in `§3`/`§5`/`§6` that `§2` does not define
- Row count within the 5–7 budget
- No `file:line` in `§2` Source cells (`§1` principle #3)
- `npm run lint`, and `npm test` as a control that the tree was untouched

### Manual review:

1. Read `§2` end to end — does each row name a failure a user or the business would
   recognise, rather than a test?
2. Read `§3` end to end — does it answer "what is left?"
3. Check each new Source cell resolves to a real document
4. Confirm no `src/` file changed: `git diff --name-only` lists only `context/`

## Migration Notes

None — no schema, no data, no deployed artifact. The document is the deliverable.

One consumer to be aware of: `.claude/hooks/` scope their `vitest related` run to "the
Risk #1 surface" (`src/pages/api`, `src/pages/auth`, `src/middleware.ts`, `src/db`,
`src/lib/supabase.ts`). Merging #5 into #1 widens what "#1" means but not that path
list, which already covered both callers. No hook edit is needed — but if `#1` is ever
renumbered, that config breaks silently.

## References

- Change identity: `context/changes/test-plan-refresh-2026-09-07/change.md`
- Research: `context/changes/test-plan-refresh-2026-09-07/research.md`
- Production feedback that widened #3: `context/changes/feedback-triage-2026-09-08/triage.md`
- Target document: `context/foundation/test-plan.md`
- Erasure coverage retiring #2: `tests/routes/erasure.test.ts`
- Analytics surface behind #9: `src/lib/analytics/events.ts` (the closed union and its extension rule)
- CI gap behind Phase 5: `.github/workflows/ci.yml:29-30`, `.github/workflows/deploy.yml:33-34`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Rebuild the §2 risk map

#### Automated

- [x] 1.1 §2 risk table has exactly 7 data rows — 034ca6f
- [x] 1.2 Risk ids correspond one-to-one between the risk table and the guidance table — 034ca6f
- [x] 1.3 No `file:line` pattern in any §2 Source cell — 034ca6f
- [x] 1.4 `npm run lint` passes — 034ca6f

#### Manual

- [x] 1.5 Merged #1 reads as one failure scenario — 034ca6f
- [x] 1.6 Widened #3 still names the malformed-response case — 034ca6f
- [x] 1.7 #6's scenario is distinguishable from the declined resource-abuse case, and the distinction is stated — 034ca6f
- [x] 1.8 New Source cells cite locatable evidence, naming no function or schema — 034ca6f

### Phase 2: Reconcile §3 with what actually shipped

#### Automated

- [x] 2.1 No `#5` or `#2` risk reference survives anywhere in the file
- [x] 2.2 Every §2 risk id appears in at least one §3 "Risks covered" cell
- [x] 2.3 `npm run lint` passes

#### Manual

- [x] 2.4 The rollout table answers "what is left?" on its own
- [x] 2.5 Phase 5's remaining scope is unambiguously the CI gate
- [x] 2.6 Phase 4's three concerns read as one phase

### Phase 3: Ripple into §5, §7 and §8

#### Automated

- [ ] 3.1 No cited §3 phase number points at a phase that no longer exists
- [ ] 3.2 §8 contains the retirement threshold as a stated rule
- [ ] 3.3 `npm run lint` passes
- [ ] 3.4 `npm test` still green (control — nothing outside `context/` changed)

#### Manual

- [ ] 3.5 Applying the threshold to #7 today yields "stays on the map"
- [ ] 3.6 §7's exclusions re-read against #8 and #9
- [ ] 3.7 The document reads as one coherent revision
- [ ] 3.8 `change.md` stamped `planned`
