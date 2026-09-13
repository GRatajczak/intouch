---
change_id: testing-input-boundary-and-prompt-composition
title: Input boundary and prompt composition (test-plan Phase 4)
status: preparing
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Rollout Phase 4 of `context/foundation/test-plan.md` §3.

Risks covered: #6, #8. Test types planned: integration + unit.

Risk response intent (from the test-plan's Risk Response Guidance table):
- Risk #6: the server bounds how many rows one request may insert, whatever the client sent; instruction-shaped description text does not change the output contract. Must challenge: "the boundary is defended, therefore it is proven" — two layers hold today and no test says so. Context to ground: where the per-request row count is capped, if anywhere; how free text is composed into the prompt.
- Risk #8: the rows the user typed are still on the form after the server rejects the submit. Must challenge: "the error banner rendered, so the user can recover". Context to ground: the draft-persistence seam and the redirect-driven remount — what clears the draft, and when relative to the request.

After creating this folder, follow the downstream continuation rule (research → plan → implement) unless a blocker surfaces.
