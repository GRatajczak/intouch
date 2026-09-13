---
change_id: testing-ai-boundary-job-states
title: AI boundary contract and job terminal states (test-plan Phase 3)
status: archived
created: 2026-09-10
updated: 2026-09-13
archived_at: 2026-09-13T13:45:10Z
---

## Notes

Rollout Phase 3 of `context/foundation/test-plan.md` §3.

Risks covered: #3, #4. Test types planned: unit/contract on fixtures + integration + one AI-native sanity judge.

Risk response intent:
- Risk #3: prove a malformed, empty or partial provider response produces an explicit error state; every rendered entry carries a suggested time window; two people on the same weight are not treated identically; a response that contradicts a fact already on record does not render as authoritative; one unchanged input yields a stable window across repeated runs.
- Risk #4: prove a failed, expired or never-settled job reaches a terminal state the view renders as an error, within a bounded time.

After creating this folder, follow the downstream continuation rule (research → plan → implement) unless a blocker surfaces.

## Closed

All five phases done and committed (`8278213`, `a5f475a`, `12dd15a`, `4c1bab5`, `460f7da`, epilogue `3ce3359`). Progress row 2.6 confirmed 2026-09-13 against a running `npm run dev`: forcing a recompute on a 2-person sparse `VERIFY_EMAIL` account produced `[ranking] job c973b28e-9326-4d81-b370-cf2d8778a531 done in 3105ms, source=app, recency floor applied to 0 entries, 0 entries fell back to a placeholder` — the extended log line renders correctly in a live run; the model addressed both people so the observed count was 0, and the positive-count path stays covered by `ranking-terminal-states.test.ts`'s deterministic partial-match case.
