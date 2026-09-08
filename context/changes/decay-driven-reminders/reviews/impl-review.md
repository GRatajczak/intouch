<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Decay-Driven Reminders (S-04)

- **Plan**: `context/changes/decay-driven-reminders/plan.md`
- **Scope**: Full plan — phases 1–7 (47/49 Progress items complete)
- **Date**: 2026-09-08
- **Verdict**: NEEDS ATTENTION → resolved (all findings triaged, see Decisions)
- **Findings**: 0 critical, 3 warnings, 4 observations — all triaged 2026-09-08 (F1–F5 fixed, F6–F7 accepted)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## What was verified clean

- **Service-role reachability.** Import graph traced across `src/`, `scripts/`, `tests/`: `supabase-admin.ts` is imported only by `src/lib/reminders/run-sweep.ts`, which is imported only by `worker.ts`'s `scheduled` handler — never `fetch`. No HTTP path reaches the RLS bypass.
- **SECURITY DEFINER hardening.** Both functions carry `set search_path = ''`, fully-qualified table names, `revoke all … from public, anon, authenticated`, `grant execute … to service_role`. `record_reminder_send` uses parameterized plpgsql, no dynamic SQL.
- **Email escaping.** Every user- or model-authored value passes through `escapeHtml`: person names, `reason`, factor text, headline, and the shell's `<title>`. `bodyHtml`/`footerNote` deliberately unescaped (caller-assembled markup). Subject correctly *not* HTML-escaped (MIME header) but stripped of CR/LF against header injection.
- **Migration forward-compatibility.** `reminders_enabled` additive with default; `reminder_sends` wholly new. Per-table `ON DELETE` decisions explicitly reasoned per `lessons.md`, not inherited.
- **Scope discipline.** Every "What We're NOT Doing" boundary held: no follow-up email, no action tokens, no frequency control, no per-person rotation, no timezone field, no ranking-prompt change, no reminder-history UI.
- **Plan's behavioural claims.** All eight verified in code: cheapest-first ordering, failed-send recorded, silence records nothing, per-owner failure isolation, constant values and their actual use, cookie-client-only settings route, queue capped at 2 and omitted when empty.
- **Automated success criteria.** `npm test` 168 passed / 14 skipped · `astro check` 0 errors (187 files) · `lint` 0 errors · `build` Complete · migrations local == remote · `verify:reminders` all assertions passed.

## Findings

### F1 — Settings route reports success on a zero-row update

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Reliability
- **Location**: src/pages/api/settings/reminders.ts:49-58
- **Detail**: The route does `.update(...).eq("owner_id", user.id)` and checks only `error`. In PostgREST an UPDATE matching zero rows returns `error: null`, so a signed-in user with no `profiles` row gets `200 { enabled: false }` and a success toast while nothing is written. This repo documents that exact trap in `tests/rls/isolation.test.ts`'s header ("RLS filters, it does not reject"), and both sibling update routes — `src/pages/api/people/[id].ts:75` and `src/pages/api/contact-events/[id].ts:52` — carry the comment "updates zero rows -- 404, never 403" and use `.select().maybeSingle()` with an explicit `if (!updated)` 404. This route is the one that does not.
- **Blast radius (verified, and why this is not CRITICAL)**: `public.reminder_candidates` inner-joins `public.profiles`, so a user with no profile row is never a candidate and would receive no email regardless. The harm is a misleading success message, not unwanted mail. The durable problem is the pattern deviation: this route is the newest example future settings routes will copy.
- **Fix**: Add `.select("reminders_enabled").maybeSingle()` to the update chain; return 404 when the result is null, mirroring `contact-events/[id].ts:52-66`.
- **Decision**: FIXED — applied as described, plus a regression test in `tests/routes/reminders-toggle.test.ts` ("reports 404 rather than success when there is no profile row"). Verified non-vacuous: removing the 404 branch fails 2 tests.

### F2 — Dry-run script hardcodes the cadence constants

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: scripts/verify-reminders.ts:79
- **Detail**: Calls `reminder_candidates` with literal `{ cooldown_days: 3, max_rows: 25 }` instead of importing `REMINDER_COOLDOWN_DAYS` and `MAX_REFRESHES_PER_RUN` from `src/lib/reminders/select.ts`. The values match today, so the script passes — but the whole point of naming those constants was that retuning them is one edit. The moment the cooldown changes, the dry run silently answers a different question than the sweep, and nothing fails.
- **Fix**: Import both constants and pass them, matching what `sweep.ts:193-196` does.
- **Decision**: FIXED — `scripts/verify-reminders.ts` now imports `REMINDER_COOLDOWN_DAYS` and `MAX_REFRESHES_PER_RUN` from `select.ts`.

### F3 — `supabase-admin.ts`'s stated import restriction is neither true nor enforced

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/lib/supabase-admin.ts:1-22
- **Detail**: Two problems in the file's own header. (a) It opens "The ONLY file in this repo that reads SUPABASE_SERVICE_ROLE_KEY", which is now false — `scripts/verify-reminders.ts:45` reads the same secret via `process.env` and builds an equivalent service-role client independently rather than importing `createAdminClient`. (b) The stated IMPORT RESTRICTION is a comment, not a rule. Today's graph honours it, but this is the repository's first RLS bypass and nothing fails if a future API route imports it "just to fetch one thing" — the safety argument in the comment would be silently void.
- **Fix A ⭐ Recommended**: Add an ESLint `no-restricted-imports` rule confining `@/lib/supabase-admin` to `src/lib/reminders/**`, and have `verify-reminders.ts` import `createAdminClient` so the header's claim becomes true again.
  - Strength: Makes the boundary mechanical rather than aspirational, and collapses two service-role client constructions into one.
  - Tradeoff: `verify-reminders.ts` runs under `tsx`, where `astro:env/server` does not resolve — importing `createAdminClient` may not work there, which is likely why it was written this way. Needs checking before committing to it.
  - Confidence: MEDIUM — the lint rule is certain; the script half depends on that resolution question.
  - Blind spot: RESOLVED — verified that `astro:env/server` does NOT resolve under `tsx` (`ERR_UNSUPPORTED_ESM_URL_SCHEME`), so the script genuinely cannot import `createAdminClient`. Only the lint rule and a corrected comment were achievable.
- **Fix B**: Correct the header comment only — state that the script reads the secret separately and why.
  - Strength: Honest immediately, zero risk.
  - Tradeoff: Leaves the boundary unenforced; the next importer still gets no signal.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED — both halves applied. `no-restricted-imports` rule added in `eslint.config.js` confining `@/lib/supabase-admin` to `src/lib/reminders/**`; verified it fires by injecting an import into an API route. Header comment corrected to state the truth about `verify-reminders.ts` and why it has no alternative.

### F4 — Progress row 1.5 records a sender domain that was never used

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/decay-driven-reminders/plan.md (Progress, row 1.5)
- **Detail**: Row 1.5 is checked as "Resend dashboard shows `mail.get-in-touch.pl` as Verified". That subdomain does not exist in the Resend account; the shipped sender is `przypomnienia@get-in-touch.pl` on the apex. The divergence is documented in `plan-brief.md`, in `astro.config.mjs`'s comment, in commit `88380ac` and in the Linear comment — but the plan's own Progress record, which `/10x-archive` reads, asserts something untrue.
- **Fix**: Since Progress step titles are not renamed by convention, add a one-line divergence note under the plan's References section pointing at `88380ac`.
- **Decision**: FIXED — plan.md now carries a `## Divergences from this plan` section covering all four deviations.

### F5 — `APP_BASE_URL` duplicates `site` with no guard against drift

- **Severity**: OBSERVATION
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Architecture
- **Location**: astro.config.mjs (env schema), src/lib/reminders/run-sweep.ts:1
- **Detail**: Phase 4's contract said `baseUrl` "comes from `astro.config.mjs`'s `site` value, never a hardcoded domain (CLAUDE.md)". The implementation reads a separate `APP_BASE_URL` secret instead, because `src/worker.ts` is bundled by wrangler rather than Astro and `astro:config/*` could not be relied on there. The reasoning is sound and recorded in code, but CLAUDE.md still states the canonical domain lives in exactly one place, and nothing detects the two falling out of sync — a stale `APP_BASE_URL` produces emails whose links point at the wrong host, and every automated check stays green.
- **Fix**: Add the exception to CLAUDE.md's canonical-domain rule so the written rule matches reality, and consider a build-time assertion comparing the two.
- **Decision**: FIXED (documentation half) — CLAUDE.md now records the exception and the keep-in-sync obligation. No build-time assertion added: the two values live in different systems (a config file and a Workers secret) with no build step that sees both.

### F6 — Person name reaches `console.log` on the dry-run path

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/reminders/sweep.ts:137
- **Detail**: `console.log(\`[reminders] would send to owner ${ownerId}: ${subject}\`)` — the subject embeds the hero's name. Only fires under `dryRun: true`, which only `scripts/verify-reminders.ts` passes; the production `scheduled` path logs UUIDs and counts only. Worth naming because it is the single place a third party's name reaches a log line in this feature, and `F-06`'s privacy constraint forbids exactly that in event payloads.
- **Fix**: None required while it stays dry-run-only. Revisit if the dry run is ever wired into anything that ships logs off the machine.
- **Decision**: ACCEPTED — left as is. The line is the dry run's entire value (it names who would be emailed), it only reaches a developer's own terminal, and `dryRun: true` is passed by nothing but the local script. Revisit if that ever changes.

### F7 — Sweep split across two files rather than the planned one

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/reminders/sweep.ts, src/lib/reminders/run-sweep.ts
- **Detail**: The plan named `runReminderSweep({dryRun})` in `sweep.ts`. Implementation exports a dependency-injected `runSweep(deps, options)` from `sweep.ts` and puts the real-client wiring in a new `run-sweep.ts`. Functionally equivalent, and the split is what makes the eight hermetic failure-branch tests possible without `vi.mock` — consistent with the explicit-seam convention in `tests/routes/route-client.ts`.
- **Fix**: None — the divergence improves on the plan. Recorded so the next reader is not surprised.
- **Decision**: ACCEPTED — recorded in plan.md's new `## Divergences` section.
