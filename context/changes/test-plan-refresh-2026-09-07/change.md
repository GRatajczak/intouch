---
change_id: test-plan-refresh-2026-09-07
title: "Test plan refresh: add-person write-path risk and stale likelihood weighting"
status: implementing
created: 2026-09-07
updated: 2026-09-10
archived_at: null
---

## Notes

Scoped `§2`/`§3` revision of `context/foundation/test-plan.md`, not a rewrite:
`§1` principles stay frozen, `§7` negative space stays as agreed unless a
finding below contradicts it.

### Trigger

User concern raised 2026-09-07 after reading the plan: the add-person form's
write path is unprotected. Confirmed by interview — all four scenarios
selected:

1. **Partial multi-row write.** The form submits several people per submit
   (decision frozen in `context/archive/2026-09-04-add-person-context-fields/`:
   "multi-row form kept"). One row rejected by the DB while the others land,
   reported to the user as success: silent data loss.
2. **Captured context never reaches the ranking input.** `S-10` added
   `relationship_context`, a capped tag array and a last-contact bucket — all
   optional, all meant to feed the ranking prompt. Stored but inert is
   indistinguishable from working, from the user's side.
3. **A rejected write reported as success** — or a successful write reported
   as an error, causing the user to add the person twice.
4. **Client-only bounds** — ALREADY COVERED by Risk #6 / `§3` Phase 4. Do not
   open a new row for this; confirm Phase 4's scope covers the `S-10` columns
   (tag cap 5, relationship-context length, bucket enum) and not only weight
   1–10 and description ≤500.

### Stale evidence found during refresh discovery (2026-09-07)

- Hot-spot scan re-run over `src/`, `scripts/`, `supabase/` — 61 commits/30d.
  `src/components/people` is now the top-churn directory at 35 commits/30d and
  appears in NO `§2` Source cell. `src/components/hierarchy` 29,
  `src/pages/api` 23, `src/components/forms` 21, `src/pages/people` 12,
  `src/lib/validation` 12. The person-authoring surface is the hottest area in
  the repo, and `§2` weights it through a single Medium row.
- The `§2` likelihood ratings were set against the 2026-09-04 scan and are
  measurably out of date.

### Secondary finding — user decides whether to promote

Roadmap `F-06` (`product-analytics-posthog`) moved `ready` → `planning` and its
change folder is open. The roadmap entry names privacy leakage as its own top
risk: an event carrying a person's name or description breaks the binary
NFR-privacy guardrail inside a vendor's database and negates `F-01`'s RLS work.
`§2` has no row for personal data escaping to a third-party vendor. Same
surface as the concern above — the funnel's core event is "person added".
Propose it as a candidate row; do not assume it in.

### Constraints on the revision

- `§2` must stay within 5–7 risks. Adding rows means consolidating or dropping
  existing ones under the challenger pass, with the reasoning recorded. Do not
  let the map grow to 9.
- Judge whether findings 1–3 are one risk ("the add-person submit reports
  success while what the user entered is partial, lost, or inert") or two
  (write-path integrity vs. the write → ranking-input contract). Argue the
  call; do not split for symmetry.
- Source cells cite evidence only: interview 2026-09-07, PRD/roadmap lines,
  archive slice ids, hot-spot **directories** with churn counts. No `file:line`,
  no function or schema names — `§1` principle #3 still binds.
- Every new row needs its Risk Response Guidance row too: what proves
  protection, what to challenge, what research must ground, cheapest layer,
  anti-pattern.
- `§3` sequencing: Phase 1 (runner bootstrap + access boundary, #1/#5) is a
  prerequisite for anything here and its scope does not change — the
  two-real-user integration harness it builds is what the new risk needs.
  Decide where the new risk lands relative to Phases 2–5, and whether it earns
  its own phase or joins Phase 4.
- Update `§8` freshness ledger dates.
