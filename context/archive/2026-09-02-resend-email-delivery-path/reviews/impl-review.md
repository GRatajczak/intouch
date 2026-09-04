<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Resend Email Delivery Path — Implementation Plan

- **Plan**: context/changes/resend-email-delivery-path/plan.md
- **Scope**: Phase 3 of 3 (full plan review)
- **Date**: 2026-09-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Unplanned CI fix not recorded in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` (commit `8befb3b`)
- **Detail**: Both workflow files carry a second `env:` block on the `npx astro sync` step, added in commit `8befb3b028` ("fix(ci): pass env secrets to astro sync step"). This was a real, necessary fix (discovered live: `astro sync` validates `env.schema` and was failing with "SUPABASE_URL is missing" without it) but it's outside Phase 1's contract, which only specified the `npm run build` step's env block — and it isn't referenced anywhere in the plan's Progress section or file list.
- **Fix**: Add a one-line addendum note to the plan (e.g. under Phase 1 or a new "Out-of-band fixes" note) recording commit `8befb3b` and why it was needed, so the plan stays an accurate record of what shipped alongside this change.
- **Decision**: FIXED — added `## Addenda` section to plan.md recording commit `8befb3b`

### F2 — Resend failures don't fail the Cron Trigger's own health status

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/worker.ts:29-36`
- **Detail**: On both the `error` branch (Resend returned an error) and the `catch` branch (thrown exception), the handler logs via `console.error` and returns normally — it never rethrows. Cloudflare derives a Cron Trigger invocation's success/failure status from whether the returned promise throws, so a real Resend outage or auth failure (exactly the kind we hit live during this implementation — an invalid `RESEND_API_KEY`) will always show as a **successful** invocation in the dashboard's Trigger Events. Only Workers Logs (`wrangler tail` / `observability`) reveal the real outcome. Given this repo already has a separate `did-it-happen-feedback-loop` change in flight, this blind spot is directly relevant to that theme.
- **Fix A ⭐ Recommended**: Rethrow after logging (`throw error` / `throw err`) so Cloudflare's native Cron Trigger health status reflects reality, while keeping the `console.error` calls for detail.
  - Strength: Makes failures visible in the dashboard without any new infrastructure — exactly the failure mode this session just spent ~2 hours diagnosing blind.
  - Tradeoff: A transient Resend hiccup now shows as a "failed" Cron Trigger invocation in the dashboard, which could look alarming for what's still a low-stakes proof send.
  - Confidence: HIGH — confirmed via Cloudflare's docs that `scheduled()`'s returned promise controls invocation status; this is a standard, well-understood mechanism.
  - Blind spot: Haven't checked whether anything downstream (alerting, `S-04`'s future sweep) will treat a "failed" Cron Trigger as actionable noise vs. signal — worth a quick gut-check before relying on this for alerting later.
- **Fix B**: Leave as-is (log-only), accept that the CF dashboard's health status is not a reliable failure indicator for this handler.
  - Strength: No behavior change; zero risk of new "failed invocation" noise in the dashboard.
  - Tradeoff: Reproduces exactly the blind spot that made this session's live debugging so slow — the dashboard said "Ok" while the send was actually failing.
  - Confidence: MEDIUM — safe, but leaves a known gap in place.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — added `throw error` / `throw err` after logging in both branches

### O1 — `console.error` used for the "not configured" skip path

- **Location**: `src/worker.ts:12-14`
- **Detail**: The missing-config early-return also logs via `console.error`, conflating "nothing to do, not set up" with "attempted and failed." Consider `console.warn` for that branch to keep the two cases distinguishable in Workers Logs.
- **Decision**: FIXED — changed to `console.warn`

### O2 — Hardcoded `onboarding@resend.dev` sender will need to become configurable

- **Location**: `src/worker.ts:24`
- **Detail**: Correct and intentional for now (matches Resend's test-sender restriction, documented in `astro.config.mjs`'s comment), but once a verified sending domain exists for the real reminder feature (`S-04`), this hardcoded `from` will need to move to config. Worth a `context/foundation/lessons.md` entry or a tracked follow-up rather than action now.
- **Decision**: ACCEPTED-AS-RULE — recorded in `context/foundation/lessons.md` ("Resend's onboarding@resend.dev sender is a placeholder, not final config"); code left unchanged, deferred to `S-04`
