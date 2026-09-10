<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: E2E Browser Layer Implementation Plan

- **Plan**: context/changes/e2e-browser-layer/plan.md
- **Scope**: Phases 1–4 of 4 (all phases, Progress fully closed)
- **Date**: 2026-09-10
- **Verdict**: NEEDS ATTENTION (triaged 2026-09-10 — 4 fixed, 2 skipped)
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Every behaviour the plan specified is implemented and correct, including the two
details singled out as hard to get right: the poll-count-frozen-at-the-bound
assertion for Risk #4 and the four-route name-absence assertion for Risk #5. The
findings are concentrated in failure-path robustness, one dead config line, and
bookkeeping.

## Success criteria verification (2026-09-10)

| Check | Result |
|---|---|
| `npm run test:e2e`, twice consecutively | 7 passed, 7 passed |
| Each Risk #4 test in isolation | pass, pass |
| `auth-gate.spec.ts` with `--workers=1` (mixed storageState) | 4 passed |
| `npm run lint` | exit 0 |
| `npx astro check` | 0 errors, 0 warnings |
| `npm test` (Vitest) | 174 passed, 14 skipped |
| `npm run build` | exit 0 |
| No `waitForTimeout`, `.only`, `test.skip` in `tests/e2e/` | none |
| CSS selectors in `tests/e2e/` | one, the documented hydration barrier |

Manual criteria carry evidence in the plan's Progress section: three deliberate
breaks were run, each turned its spec red, and each was reverted.

## Findings

### F1 — Throwaway user leaks if seeding fails after the user is created

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: tests/e2e/fixtures/test-user.ts:42-73
- **Detail**: `createTestUser()` creates a real user at line 42, then runs two
  more fallible steps (the `profiles` insert, the `people` insert) before writing
  the record to `TEST_USER_PATH` at line 73. That file is the only thing
  `destroyTestUser()` can read. If either insert throws, a real user exists in the
  local `auth.users` with nothing recording it, and the teardown project fails
  with "No E2E test user on disk" — a message that reads as if nothing was ever
  created. This is the same bug class `tests/rls/fixture.ts:74-81` already hit and
  fixed, and its own comment names it: "a failure between the two creations used
  to leave user A in auth.users with nothing recording it, and teardown then
  no-opped on a null admin. The leak was permanent and silent." The fix was not
  carried across to the new fixture.
- **Fix A ⭐ Recommended**: Write `{ userId }` to `TEST_USER_PATH` immediately after
  the user is created, then rewrite the full record once seeding succeeds.
  - Strength: Mirrors the sibling fixture's own remedy (register for teardown
    before the next fallible step) and leaves the teardown project able to clean
    up regardless of where seeding died.
  - Tradeoff: A partial record briefly exists on disk; `readTestUser()` callers
    that expect `peopleNames` would get `undefined` if they ran against it, so the
    type or the read needs to acknowledge the partial state.
  - Confidence: HIGH — the identical pattern is in the repo and documented.
  - Blind spot: None significant.
- **Fix B**: Wrap the seeding steps in try/catch and delete the user on failure.
  - Strength: Nothing partial ever reaches disk; the failure is self-cleaning.
  - Tradeoff: If the delete itself fails, the leak returns with no record — which
    is exactly the state `tests/rls/fixture.ts` moved away from.
  - Confidence: MEDIUM — correct in the common case, weaker in the nested-failure
    case the sibling fixture explicitly designed against.
  - Blind spot: Have not checked whether a failed `deleteUser` here would mask the
    original seeding error in the reported stack.
- **Decision**: SKIPPED — accepted as-is; the leak is local-stack only and recoverable by hand.

### F2 — The signed-out test reaches /dashboard without the /api/rankings guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/auth-gate.spec.ts:19-43
- **Detail**: The signed-out test loops over `PROTECTED_ROUTES`, which includes
  `/dashboard`, and registers no route handler. It is safe today only because
  middleware redirects before the page renders — which is the exact behaviour the
  test exists to catch regressing. If the gate ever fails, `HierarchyView` mounts
  unguarded and the run makes a real, paid OpenAI call, violating the invariant
  this project wrote down for itself in `tests/e2e/E2E_RULES.md`: "/api/rankings
  must never reach the server unmocked." Every other spec that can reach
  `/dashboard` guards the route unconditionally; this is the only one that makes
  the invariant conditional on the code under test already being correct.
- **Fix**: Register `page.route("**/api/rankings*", (route) => route.abort())`
  before the loop, so the guard holds whether or not the gate works.
- **Decision**: FIXED — guard registered before the loop in tests/e2e/auth-gate.spec.ts.

### F3 — `trace: "on-first-retry"` can never fire with `retries: 0`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: playwright.config.ts:48 and :54
- **Detail**: `retries` is 0 unconditionally, and deliberately so — the comment
  argues a retry hides the signal this layer exists to produce. But `trace` is set
  to `"on-first-retry"`, which Playwright's docs define as recording only on the
  first retry. With no retries there is never a first retry, so no trace is ever
  written and the setting is dead. When a spec fails in CI, the one artifact that
  would explain it is absent.
- **Fix**: Keep `retries: 0` and change `trace` to `"retain-on-failure"`, which
  records every run and keeps the trace only for failures.
- **Decision**: FIXED — trace switched to "retain-on-failure"; retries stays 0.

### F4 — change.md is stale: status and the closing note contradict git

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/e2e-browser-layer/change.md:4 and :67
- **Detail**: Phase 4 item 4 of the plan says to advance `change.md` to a
  completed status. The frontmatter still reads `status: implementing`, and the
  body's closing line still says "Not committed. The phase-end commit ritual is
  still open" — untrue since `067f526` and `a23c1ed`. Anyone reading the folder
  gets a picture two steps behind the repo.
- **Fix**: Set the frontmatter status (this review sets it to `impl_reviewed`) and
  replace the closing note with the two commit SHAs.
- **Decision**: FIXED — closing note replaced with the two commit SHAs and a pointer to this review.

### F5 — local-stack.ts gives the wrong reason for duplicating a safety guard

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/fixtures/local-stack.ts:33-34
- **Detail**: The comment says `readLocalStatus()` is duplicated "because tests/rls
  is a Vitest module tree and this one runs under Playwright's own transform". The
  real reason is simpler: the function is not exported from `tests/rls/fixture.ts`.
  The transform claim is undercut by this same file importing `@/db/database.types`
  successfully under Playwright. That matters because the duplicated code is the
  non-local-URL guard, the one thing standing between a test run and deleting real
  users. A wrong rationale invites the next reader to leave the copies diverging.
- **Fix**: Correct the comment to state that the function is unexported, and note
  that the two copies of the guard must be hardened together.
- **Decision**: FIXED — comment corrected to name the real reason (unexported) and to require hardening both copies together.

### F6 — Three benign mismatches between the plan's wording and the code

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/e2e-browser-layer/plan.md, Phase 1 items 1, 2, 8
- **Detail**: The plan says two Playwright projects; three exist, because the
  teardown became its own `cleanup` project — real, load-bearing, and the standard
  idiom, just not what the item described. The plan says the dependency would be
  "pinned to the resolved version"; it is caret-ranged like every other
  devDependency here. The plan predicted `eslint.config.js` would need changes for
  `tests/e2e/**`; it needed none, and the file was never touched. The plan also
  says the config would "resolve the `@/` alias", which it does not do explicitly —
  the alias works through the root `tsconfig.json` paths that Playwright honours.
  All four are the plan being more speculative than reality required.
- **Fix**: Add a short addendum to the plan recording these four, so a later reader
  does not treat the plan text as the source of truth about the config.
- **Decision**: SKIPPED — recorded in this report; plan text left unamended.
