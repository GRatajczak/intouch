---
change_id: testing-ai-boundary-job-states
title: AI boundary contract and job terminal states (test-plan Phase 3)
status: implementing
created: 2026-09-10
updated: 2026-09-11
archived_at: null
---

## Notes

Rollout Phase 3 of `context/foundation/test-plan.md` §3.

Risks covered: #3, #4. Test types planned: unit/contract on fixtures + integration + one AI-native sanity judge.

Risk response intent:
- Risk #3: prove a malformed, empty or partial provider response produces an explicit error state; every rendered entry carries a suggested time window; two people on the same weight are not treated identically; a response that contradicts a fact already on record does not render as authoritative; one unchanged input yields a stable window across repeated runs.
- Risk #4: prove a failed, expired or never-settled job reaches a terminal state the view renders as an error, within a bounded time.

After creating this folder, follow the downstream continuation rule (research → plan → implement) unless a blocker surfaces.
