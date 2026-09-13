---
change_id: testing-ai-boundary-job-states
title: AI boundary contract and job terminal states (test-plan Phase 3)
status: implemented
created: 2026-09-10
updated: 2026-09-13
archived_at: null
---

## Notes

Rollout Phase 3 of `context/foundation/test-plan.md` §3.

Risks covered: #3, #4. Test types planned: unit/contract on fixtures + integration + one AI-native sanity judge.

Risk response intent:
- Risk #3: prove a malformed, empty or partial provider response produces an explicit error state; every rendered entry carries a suggested time window; two people on the same weight are not treated identically; a response that contradicts a fact already on record does not render as authoritative; one unchanged input yields a stable window across repeated runs.
- Risk #4: prove a failed, expired or never-settled job reaches a terminal state the view renders as an error, within a bounded time.

After creating this folder, follow the downstream continuation rule (research → plan → implement) unless a blocker surfaces.

## Outstanding manual check

Progress row 2.6 (`wrangler tail` / local log shows the new `fallbackCount` segment on a real partial-fallback run) is deliberately left open — it needs a running `npm run dev` instance and a deliberately sparse test account, which is the developer's own action per this repo's dev-server convention. Everything else in all five phases is done and committed (`8278213`, `a5f475a`, `12dd15a`, `4c1bab5`, `460f7da`).
