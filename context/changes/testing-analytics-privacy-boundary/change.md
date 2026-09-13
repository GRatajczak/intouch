---
change_id: testing-analytics-privacy-boundary
title: Analytics privacy boundary (test-plan Phase 6)
status: preparing
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Rollout Phase 6 of `context/foundation/test-plan.md` §3 — the last rollout phase for F-07 (`automated-test-harness`).

Risk covered: #9. Test types planned: unit + integration with the transport stubbed at the network edge.

Risk response intent (from the test-plan's Risk Response Guidance table):
- No event payload carries a person's name, description, context, tags or the user's email; an opted-out user's action produces no outgoing call.
- Must challenge: "the payload type is a closed union, so nothing personal can get in" — true at compile time, silent about the consent gate and the opt-out inversion.
- Context to ground: every emission point; the failure mode of the consent read; where the UI's positive maps to the column's negative (`analytics_opt_out`).
- Anti-pattern to avoid: asserting that the SDK was called instead of asserting what the payload contained; testing consent only in the consented direction.

After creating this folder, follow the downstream continuation rule (research → plan → implement) unless a blocker surfaces.
