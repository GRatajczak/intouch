# E2E Browser Layer Implementation Plan

## Overview

Stand up the project's first Playwright layer and use it for exactly two risks
from `context/foundation/test-plan.md` §2 — Risk #4 (a deferred ranking job never
reaches a terminal state and the view polls forever) and Risk #5 (an unauthenticated
visitor reaches relationship data). Both are driven through the `/10x-e2e` loop
(PLAN → GENERATE → REVIEW → VERIFY), one risk at a time, with a seed test and an
E2E rules file as the two quality levers.

The deliverable is not "E2E coverage". It is two reviewed tests that go **red when
their named risk materializes**, plus the minimum infrastructure they need, plus a
test plan that no longer contradicts what is on disk.

## Current State Analysis

- **No Playwright at all.** No `@playwright/test` in `package.json`, no
  `playwright.config.*`, no `*.spec.ts` anywhere, no `tests/e2e/`. A global
  `playwright-cli` binary exists (from the M3L4 exercise) and `npx playwright --version`
  resolves 1.63.0, but neither is a project dependency.
- **`context/foundation/test-plan.md` §7 explicitly excludes this layer** —
  "End-to-end browser flows — no Playwright layer" — and §4 records
  `e2e | not planned`. The same §7 entry carries the re-evaluation clause this
  change invokes: *"Re-evaluate if a risk surfaces that only the deployed shape
  can reproduce (a cookie/session crossing the Workers boundary is the likeliest
  candidate)."*
- **Risk #4's protective behavior lives only in the browser.** `HierarchyView.tsx`
  holds the whole polling state machine: `POLL_INTERVAL_MS = 2000`,
  `MAX_POLL_ATTEMPTS = 60`, a `setInterval` that fetches `/api/rankings?jobId=…`,
  and three exits — `done` → render the ranking, `failed` → `setStatus("failed")`,
  and `attempts >= MAX_POLL_ATTEMPTS` → the same failed state. None of that is
  reachable from a route-level test; `tests/routes` invokes handlers directly and
  never mounts the island.
- **Both `/api/rankings` calls are browser-side fetches**, so `page.route()` can
  intercept them deterministically. The OpenAI call is *not* — it happens inside
  `runRanking()` on the server, behind `waitUntil`. That asymmetry is why Risk #3
  is out of scope here (see below).
- **Risk #5's chain is real middleware.** `src/middleware.ts` gates
  `/dashboard`, `/profile`, `/people`, `/settings` on `context.locals.user`, which
  comes from `supabase.auth.getUser()` reading the chunked `sb-<ref>-auth-token.*`
  cookies. `tests/http` proves the cookie → `locals.user` chain with a hand-driven
  `fetch`; nothing proves it through a real browser's cookie jar and a real SSR
  page load.
- **The user-minting pattern already exists.** `tests/rls/fixture.ts` creates
  confirmed throwaway users with the service-role key and does nothing else with
  it; every assertion runs through an anon-key client carrying a real JWT.
  `tests/http/fixture.ts` mints cookie jars by POSTing the app's own
  `/api/auth/signin`. Playwright's `storageState` is the same idea with the
  browser doing the harvesting.
- **The suite never starts a server** (§6.1) and `tests/http` self-skips on an
  unset `TEST_BASE_URL`. The E2E layer inherits both conventions.
- Local Supabase stack and a dev server on `:4321` were both reachable during
  planning (2026-09-10).

## Desired End State

`npm run test:e2e`, run against a dev server the developer started, executes three
spec files against the real app and the local Supabase stack:

| Spec | Risk | What it proves |
| --- | --- | --- |
| `tests/e2e/seed.spec.ts` | — (exemplar) | A person created through the UI survives a real page reload |
| `tests/e2e/ranking-job-terminal-state.spec.ts` | #4 | A job that fails, and a job that never settles, both reach a visible error state with a retry affordance |
| `tests/e2e/auth-gate.spec.ts` | #5 | No session reaches no relationship data on any protected route; a real session survives a real reload |

Each spec uses role-based locators, waits for state rather than time, carries
unique test data, cleans up after itself, and has been proven to go red when the
production behavior it protects is deliberately broken.

`context/foundation/test-plan.md` §4 and §7 describe this layer accurately, and
§6 gains a cookbook section for adding the next E2E test.

**Verification**: `npm run test:e2e` passes twice in a row from a clean tree with
the stack and a dev server up; `npm run lint`, `npx astro check` and `npm run build`
still pass; every deliberate-break check in Phases 2 and 3 is recorded and reverted.

### Key Discoveries

- **`page.clock` is what makes Risk #4 testable at all.** The never-settling
  branch is bounded at `60 × 2000ms = 120s`. Waiting that out would be a two-minute
  test and, worse, a *time-based* one — the fourth anti-pattern wearing a disguise.
  Playwright's clock API installs a fake timer before the island mounts, so the
  test fast-forwards the poll loop deterministically and still asserts on state.
- **A fresh user does not reach `HierarchyView` at all.** `dashboard.astro`
  renders `HierarchyEmptyState` when there is no profile row or zero active
  people. The E2E fixture must seed a profile and at least one person, or every
  Risk #4 assertion runs against an empty state and passes for the wrong reason.
- **The seeded ranking's `createdAt` decides the mount state.** `isStale()` uses
  a 24h window, and `staleOnLoad` is what makes `HierarchyView` dispatch a refresh
  on mount. Seeding no ranking at all (`ranking === null` → `staleOnLoad === true`)
  gives the deterministic "first-ever run" path with the spinner, which is the
  exact state Risk #4 describes as indistinguishable from stuck.
- **`service_role` holds no table grants in this schema** (§6.3, and Phase 1's
  own lesson). Seeding rows must go through an anon-key client carrying the test
  user's session. Service-role is for `auth.admin` user creation and deletion only.
- **`supabase/config.toml` caps `sign_in_sign_ups` at 30 per 5 minutes per IP.**
  A Playwright `setup` project that signs in once per run, plus the Vitest suite's
  ~18, is comfortable. A per-test sign-in would not be — which is the practical
  reason `storageState` is not optional here.
- **Astro's origin check runs before routing.** The seed test drives a real form
  in a real browser, so it sends a matching `Origin` for free. Any future spec
  that reaches for `request.post()` instead of the UI must send
  `Content-Type: application/json` or an explicit `Origin`.

## What We're NOT Doing

- **Risk #3 (malformed AI response rendered as an authoritative hierarchy).** The
  provider call is server-side, so a browser-level route mock cannot reach it; the
  only interception point left is `/api/rankings`, which is the same seam Risk #4's
  test already owns. It stays on the contract layer — `test-plan.md` §3 Phase 3.
- **Risks #1, #2, #6, #7.** All provable against real routes plus the local stack,
  which is cheaper to run and to keep green. §1 principle 1 stands.
- **Visual regression and vision mode.** §7 excludes both on their own merits and
  this change does not touch that. If pixel regression is ever wanted, the answer
  is `toMatchSnapshot`, not a vision model.
- **CI wiring.** Phase 4 records the decision and the command; it does not add a
  workflow job or promote E2E into a blocking gate. E2E is the slowest, most
  flake-prone layer and gets a soak period first.
- **Playwright's planner/generator/healer agents.** The two flows here are small
  and fully understood from the code read during planning, so `/10x-e2e` takes the
  prompt-template path. `references/browser-driven-generation.md` stays available
  for the next, less obvious risk.
- **A Page Object Model.** Three specs do not need one. Composable fixtures cover
  setup/teardown; extract page objects only when duplicated interaction logic
  becomes an obvious cost.
- **Testing the landing page, or any second browser engine.** Chromium only.

## Implementation Approach

Infrastructure first, then one risk per phase, then documentation. `/10x-e2e`
refuses to run without Playwright in place, so Phase 1 is a prerequisite rather
than part of the loop — but its two artifacts (the seed test and the rules file)
*are* the levers the loop depends on, and their quality propagates into everything
generated afterwards.

Phases 2 and 3 each run the full loop and each end with a deliberate break: the
production behavior the risk names is temporarily inverted, the spec must go red,
and the break is reverted before the commit. A green test that stays green through
its own break protects nothing.

## Critical Implementation Details

- **The suite never starts a server.** `playwright.config.ts` gets no `webServer`
  block. `baseURL` comes from `E2E_BASE_URL`, defaulting to `http://localhost:4321`.
  A run against an unreachable base URL fails loudly rather than skipping — the
  E2E layer is opt-in by *invocation* (`npm run test:e2e`), not by env var, so
  the `tests/http` skip-on-unset rule does not apply.
- **Auth without the UI, except once.** The `setup` project signs in through the
  real form exactly once and writes `playwright/.auth/user.json`. Every other spec
  starts signed in. The two specs that must exercise sign-in state directly
  (`auth-gate`) opt out with an explicit empty `storageState`.
- **Unique test data, always.** Every seeded person, profile and deck name carries
  a `Date.now()`-derived suffix so parallel workers and re-runs never collide.
  Cleanup per test plus unique ids, not one or the other.
- **Teardown must run as the owner.** RLS filters rather than rejects, so a
  teardown client without the creating user's session sees empty tables and
  silently deletes nothing. Delete the user with `auth.admin` and let
  `ON DELETE CASCADE` do the rest, exactly as `destroyRlsFixture()` does.
- **`page.route()` is registered before navigation.** A route handler installed
  after `page.goto()` misses the island's first fetch, which is precisely the
  fetch under test.
- **`page.clock.install()` must precede the island mounting**, i.e. before
  `page.goto()`. Installed later, the already-scheduled `setInterval` keeps the
  real timer and the test silently waits two real minutes.

---

## Phase 1: Playwright Infrastructure and the Two Quality Levers

### Overview

Install Playwright, configure it against the project's conventions, and create
the seed test and rules file that shape every test generated afterwards. Nothing
here protects a risk; everything here decides how well the next two phases do.

### Changes Required:

#### 1. Dependencies

`@playwright/test` as a devDependency, pinned to the resolved version. Browser
binaries: Chromium only (`npx playwright install chromium`). No other engine.

#### 2. `playwright.config.ts`

`testDir: "tests/e2e"`, Chromium only, `baseURL` from `E2E_BASE_URL` with a
`http://localhost:4321` default, no `webServer`, `fullyParallel: true`,
`forbidOnly` under CI, zero retries locally. Two projects: `setup`
(`testMatch: /auth\.setup\.ts/`) and `chromium`
(`use: { storageState: "playwright/.auth/user.json" }`, `dependencies: ["setup"]`).
`trace: "on-first-retry"`. Resolve the `@/` alias so specs and fixtures can import
from `src/`.

#### 3. `tests/e2e/fixtures/test-user.ts`

One throwaway user per run, seeded with a profile and two people so the dashboard
reaches `HierarchyView` rather than an empty state. Service-role creates and
deletes the user and does nothing else; the profile and people rows are inserted
through an anon-key client carrying that user's real session. Exports the
credentials plus a teardown that deletes the user. Reuse `readLocalStatus()`'s
approach from `tests/rls/fixture.ts` rather than duplicating the `supabase status`
parsing, if it can be imported cleanly; otherwise mirror it with a comment naming
the original.

#### 4. `tests/e2e/auth.setup.ts`

Creates the run's user via the fixture, drives the real sign-in form
(`getByLabel("Adres e-mail")`, `getByLabel("Hasło")`, the submit button), waits
for the post-login URL, and writes `playwright/.auth/user.json`. This is the one
place the sign-in UI is a dependency; every other spec is insulated from it.

#### 5. `tests/e2e/seed.spec.ts` — the exemplar

`test("a person added through the form is still there after a page reload")`.
Full cycle in one test: unique name via `Date.now()`, create through
`/people/new` with role-based locators, assert the person is visible, `page.reload()`,
assert again, then delete as cleanup. No `waitForTimeout` anywhere. The test name
binds to the behavior, not to a number.

#### 6. `tests/e2e/E2E_RULES.md` — the rules lever

Adapted from `.claude/skills/10x-e2e/references/e2e-quality-rules.md` to this
project: locator hierarchy (`getByRole` / `getByLabel` / `getByText`, `getByTestId`
only when accessibility attributes are ambiguous, never CSS or XPath), no
`page.waitForTimeout`, test independence with unique ids and cleanup,
`storageState` for auth, real-vs-mocked boundaries (auth, routing and DB stay
real; only the browser-side `/api/rankings` fetch is mocked, and only where the
risk is the client's own state machine), and the Polish-UI note that accessible
names are Polish strings.

#### 7. `tests/e2e/fixtures/hydration.ts` (added during Phase 1, not foreseen in planning)

Every interactive surface is an Astro island. Between the SSR paint and React
attaching handlers, a button is present, visible and enabled -- Playwright clicks
it and nothing happens, silently. Astro's island element carries an `ssr`
attribute that its client runtime removes on hydration, so waiting for
`astro-island[ssr]` to reach zero is a state-based barrier. Exported as
`waitForHydration(page)` and `gotoHydrated(page, url)`. This is the single place
in the suite where a CSS selector is permitted, and the rules file says so.

#### 8. Ignore and script wiring

`.gitignore` gains `playwright/.auth/`, `test-results/`, `playwright-report/`.
`package.json` gains `test:e2e` and `test:e2e:ui`. `eslint.config.js` gains
whatever `tests/e2e/**` needs to lint cleanly.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e` runs the `setup` project and `seed.spec.ts`, and exits 0
- Running it a second time immediately afterwards also exits 0 (no unique-constraint
  or leftover-state failure)
- `npm run lint` passes with the new files present
- `npx astro check` passes
- `npm run build` still passes

#### Manual Verification:

- `playwright/.auth/user.json` is written and is git-ignored
- `git status` shows no `test-results/` or `playwright-report/` noise
- The seed test contains no CSS selector, no `waitForTimeout`, and no data name
  without a unique suffix — it is about to be copied by everything downstream
- The throwaway user is gone from the local stack after the run

**Implementation Note**: pause here for manual confirmation. Phases 2 and 3 inherit
this phase's conventions verbatim; a flaw in the seed becomes a flaw in both.

---

## Phase 2: Risk #4 — A Ranking Job Must Reach a Terminal State

### Overview

Risk #4: *"A deferred ranking job never reaches a terminal state and the view polls
forever — stuck is indistinguishable from slow."* Impact Medium, Likelihood High,
and it already happened once (interview Q2). The protective behavior is entirely
client-side and entirely invisible to every existing test layer.

### Changes Required:

#### 1. `tests/e2e/ranking-job-terminal-state.spec.ts`

Two tests under one `describe`, both tied to the same risk, both independent:

- **A failed job renders an explicit error, not a spinner.** Route `/api/rankings`
  so `POST` returns `202 { jobId }` and `GET` returns `{ status: "failed" }`.
  Assert the heading `Nie udało się wygenerować kolejności` is visible and the
  `Spróbuj ponownie` button is enabled. Assert the loading copy
  `Układamy Twoją kolejność kontaktów…` is gone.
- **A job that never settles is bounded.** `page.clock.install()` before
  `page.goto()`. Route `GET` to answer `{ status: "pending" }` forever. Fast-forward
  past `MAX_POLL_ATTEMPTS × POLL_INTERVAL_MS`. Assert the same terminal error state
  and — the part that matters — that polling has *stopped*: the request count
  taken after a further fast-forward equals the count at the bound.

#### 2. Route registration and mock shape

Handlers registered before navigation. The mocked bodies match
`GetRankingsResponse` / `PostRankingsResponse` exactly, including
`Content-Type: application/json`, so the test fails if the client contract changes
rather than passing on a body the app would reject.

#### 3. Real versus mocked, stated in the spec header

Auth, routing, SSR and the database are real. Only the browser's own
`/api/rankings` fetch is intercepted, because the risk *is* the client state
machine — mocking it is what makes "never settles" reproducible at all.

### Success Criteria:

#### Automated Verification:

- `npx playwright test tests/e2e/ranking-job-terminal-state.spec.ts` passes
- Both tests pass when run in isolation and in either order
- Neither test takes more than a few seconds despite covering a 120-second bound
- `npm run test:e2e` (whole suite) passes

#### Manual Verification:

- **Deliberate break A**: in `HierarchyView.tsx`, make the `body.status === "failed"`
  branch a no-op. The first test goes red. Revert.
- **Deliberate break B**: remove the `attempts >= MAX_POLL_ATTEMPTS` guard. The
  second test goes red. Revert.
- Neither break is present in the tree at commit time
- Review against the five anti-patterns is recorded: no assertion on a page title
  or a URL standing in for the real outcome, no CSS selector, no shared state
  between the two tests, no `waitForTimeout`, cleanup present

**Implementation Note**: pause for manual confirmation before Phase 3.

---

## Phase 3: Risk #5 — No Session Reaches No Relationship Data

### Overview

Risk #5: *"An unauthenticated visitor, or a stale/replayed password-recovery token,
reaches relationship data."* Impact High. The recovery-token half is already covered
at the route layer (`tests/routes/recovery-token.test.ts`); this phase covers the
half that only the deployed shape reproduces — a real browser cookie jar crossing
middleware on a real SSR page load. That is verbatim the case §7 named as its
re-evaluation trigger.

### Changes Required:

#### 1. `tests/e2e/auth-gate.spec.ts`

- **No session reaches no protected route.** `test.use({ storageState: { cookies: [], origins: [] } })`
  for this test only. Visit `/dashboard`, `/people`, `/profile`, `/settings` in
  turn; each must land on `/auth/signin` with the `Zaloguj się` heading visible.
  Assert positively on the *absence* of relationship data: the seeded person's
  name must not appear anywhere in the rendered page.
- **A real session survives a real reload.** Runs under the default
  `storageState`. Load `/dashboard`, confirm the signed-in shell renders, `page.reload()`,
  confirm it still does and did not bounce to `/auth/signin`. Without this control,
  the first test would pass just as happily against a completely broken app.

#### 2. Seeded-person visibility

The absence assertion needs something that *would* be visible if the gate failed.
Use the fixture's seeded person name, so the assertion is about this user's real
data rather than about a generic string.

### Success Criteria:

#### Automated Verification:

- `npx playwright test tests/e2e/auth-gate.spec.ts` passes
- Both tests pass in isolation and in either order, including the mixed
  `storageState` (a signed-out test must not leak into the signed-in one)
- `npm run test:e2e` (whole suite) passes, twice in a row

#### Manual Verification:

- **Deliberate break**: remove `/dashboard` from `PROTECTED_ROUTES` in
  `src/middleware.ts`. The signed-out test goes red on the `/dashboard` case.
  Revert.
- **Second deliberate break**: make the signed-in control meaningful by confirming
  it goes red if `storageState` is pointed at an empty state
- Neither break is present at commit time
- Anti-pattern review recorded, with particular attention to assertion naivety:
  asserting the redirect alone is not enough, the data-absence assertion is what
  binds the test to the risk

**Implementation Note**: pause for manual confirmation before Phase 4.

---

## Phase 4: Reconcile the Test Plan and Record the Layer

### Overview

The test plan currently says this layer does not exist and will not. Two tests on
disk make that false. Fix the document rather than leaving a reader to discover the
contradiction.

### Changes Required:

#### 1. `context/foundation/test-plan.md` §4

Replace the `e2e | not planned | —` row with Playwright at its installed version,
scoped in the Notes column to Risks #4 and #5 only, naming `E2E_BASE_URL` and the
"suite never starts a server" convention.

#### 2. `context/foundation/test-plan.md` §7

Rewrite the "End-to-end browser flows" exclusion so it describes what is now true:
the layer exists, it is deliberately two risks wide, and everything else stays at
the integration layer. Keep the cost × signal reasoning and cite this change folder
as the re-evaluation that opened it.

#### 3. `context/foundation/test-plan.md` §5 and §6

§5: record that E2E is **not** a blocking gate and say why (soak period first, and
it needs both a running server and the local stack). §6: add a cookbook section for
adding an E2E test — where specs live, how to run one, how auth arrives, what
`E2E_BASE_URL` expects, and the rule that a new spec ships only after a deliberate
break has been shown to turn it red.

#### 4. §8 freshness ledger and `change.md`

Stamp the ledger with the review date. Advance `change.md` to `status: complete`
and update `updated:`.

#### 5. CI decision, recorded not wired

One paragraph in §5 stating how the suite would run in CI (a job that starts the
stack and a preview server, then `npm run test:e2e`) and that it is deliberately
deferred until the layer has soaked locally.

### Success Criteria:

#### Automated Verification:

- No sentence in `test-plan.md` claims there is no Playwright layer
- `npm test` (Vitest) still passes — the E2E layer is not inside `test.include`
- `npm run lint`, `npx astro check`, `npm run build` pass

#### Manual Verification:

- A reader who was not part of this work can add a third E2E spec from §6 alone
- §7 still reads as a deliberate boundary, not as an apology for a gap
- The two-risk scope and the reason for it survive in the document, so the next
  person does not read the layer as an invitation to grow it

---

## Testing Strategy

This plan's deliverable is tests, so the strategy is about what they must prove.

### What the E2E layer must prove

- A ranking job that fails, and one that never settles, both end in a state a user
  can see and act on — never an unbounded spinner
- Polling actually stops at the bound rather than merely rendering an error
- No browser without a session reaches any protected route or any relationship data
- A real session survives a real SSR reload, so the negative test cannot pass
  against a broken app

### What stays out of the E2E layer

- Every route contract, ownership boundary and erasure guarantee — `tests/routes`,
  `tests/rls`, `tests/http`
- Provider response validation — contract tests over recorded fixtures, §3 Phase 3
- Anything an isolated function proves

### How each test is verified

Green is a precondition, not the verification. Every spec is verified by inverting
the production behavior it protects and confirming it turns red. A spec that stays
green through its own break goes back to GENERATE.

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Playwright Infrastructure and the Two Quality Levers

#### Automated

- [x] 1.1 `npm run test:e2e` runs the setup project and `seed.spec.ts` and exits 0 — 067f526
- [x] 1.2 A second consecutive run also exits 0 (four consecutive runs green) — 067f526
- [x] 1.3 `npm run lint` passes with the new files present (0 errors; only the repo's pre-existing `no-console` warnings) — 067f526
- [x] 1.4 `npx astro check` passes (0 errors, 0 warnings) — 067f526
- [x] 1.5 `npm run build` still passes — 067f526

#### Manual

- [x] 1.6 `playwright/.auth/user.json` written and git-ignored; no `test-results/` noise — 067f526
- [x] 1.7 Seed test carries no CSS selector, no `waitForTimeout`, no non-unique test data — 067f526
- [x] 1.8 Throwaway user removed from the local stack after the run (teardown project) — 067f526

### Phase 2: Risk #4 — A Ranking Job Must Reach a Terminal State

#### Automated

- [x] 2.1 `ranking-job-terminal-state.spec.ts` passes — 067f526
- [x] 2.2 Both tests pass in isolation and in either order — 067f526
- [x] 2.3 Neither test takes more than a few seconds despite covering a 120s bound (~3s each) — 067f526
- [x] 2.4 `npm run test:e2e` passes as a whole — 067f526

#### Manual

- [x] 2.5 Deliberate break A — dropped `setStatus("failed")` from the `body.status === "failed"` branch in `HierarchyView.tsx`, keeping `clearInterval` so the bound could not cover for it. Test 1 red. Reverted. — 067f526
- [x] 2.6 Deliberate break B — removed the `attempts >= MAX_POLL_ATTEMPTS` guard from the success path. Test 2 red. Reverted. — 067f526
- [x] 2.7 Five-anti-pattern review recorded (see Review Notes below) — 067f526

### Phase 3: Risk #5 — No Session Reaches No Relationship Data

#### Automated

- [x] 3.1 `auth-gate.spec.ts` passes — 067f526
- [x] 3.2 Both tests pass in isolation and in either order across mixed `storageState` — 067f526
- [x] 3.3 `npm run test:e2e` passes twice in a row — 067f526

#### Manual

- [x] 3.4 Deliberate break — `/dashboard` removed from `PROTECTED_ROUTES`, dev server restarted so the change actually loaded (`curl` confirmed: anonymous `/dashboard` went 302→200 while `/people` still redirected). The signed-out test went red on the `/dashboard` case: expected `/auth/signin`, received `/dashboard`. Break reverted, dev server restarted again. First attempt reported a false all-clear because `src/middleware.ts` does not hot-reload — see Findings. — 067f526
- [x] 3.5 Data-absence assertion examined, and the honest answer is that **a single-layer break cannot exercise it**. With the middleware gate gone, an anonymous `/dashboard` renders `HierarchyEmptyState` and an anonymous `/people` renders `EmptyState`, because both pages guard on `Astro.locals.user` themselves; and even past that guard the sessionless Supabase client is filtered to zero rows by RLS. Three layers stand between "no session" and "a person's name on screen", so the break landed on the URL assertion instead. The data-absence assertion stays as the net that catches a future regression in any one of the three — it is not decorative, it is just not reachable by breaking only the outermost layer. — 067f526
- [x] 3.6 Five-anti-pattern review recorded (see Review Notes below) — 067f526

### Phase 4: Reconcile the Test Plan and Record the Layer

#### Automated

- [x] 4.1 No sentence in `test-plan.md` claims there is no Playwright layer — 067f526
- [x] 4.2 `npm test` (Vitest) still passes — 174 passed, 14 skipped — 067f526
- [x] 4.3 `npm run lint`, `npx astro check`, `npm run build` pass — 067f526

#### Manual

- [x] 4.4 §6.7 cookbook added, carrying the three traps this change paid to find — 067f526
- [x] 4.5 Two-risk scope and its reasoning survive in §7 — 067f526
- [x] 4.6 §8 ledger stamped; `change.md` advanced — 067f526


---

## Review Notes — the five anti-patterns

Applied to both risk specs (`.claude/skills/10x-e2e/references/e2e-anti-patterns.md`).

| Anti-pattern | Finding |
| --- | --- |
| 1. Naive assertion | **Caught one, in the seed test.** `getByRole("button", { name: "Aktywuj" })` matched **"Dezaktywuj"** — accessible-name matching is a case-insensitive substring — so the assertion that the status flipped passed against the button that never changed. Fixed with `{ exact: true }`. Both risk specs assert on business outcomes: the error heading plus the retry button, the *absence* of the spinner, the poll count frozen at the bound, the seeded person's name absent while signed out. |
| 2. Brittle selector | None. Every locator is `getByRole` / `getByLabel` / `getByText`. The one CSS selector in the suite is the hydration barrier in `fixtures/hydration.ts`, which addresses Astro's island element rather than a UI control, and the rules file says so explicitly. |
| 3. Shared state | None. Each test owns setup, action, assertion and cleanup. `fullyParallel` is on and the specs pass in either order, including the mixed signed-in / signed-out `storageState`. |
| 4. `waitForTimeout` | None, and the 120-second bound is the reason to check: it is asserted with `page.clock` fast-forwarding, not by sleeping. `fastForward` was rejected in favour of `runFor` — it fires a due timer at most once, which would advance past the bound without ever counting the ticks. |
| 5. No cleanup | Covered twice over. Unique `Date.now()` suffixes prevent collisions, the seed test deletes its own person through the UI, and the `cleanup` teardown project deletes the run's user so `ON DELETE CASCADE` removes anything a crashed test left behind. |

## Findings this change paid for

Three things the plan did not anticipate, all now written into `tests/e2e/E2E_RULES.md`
and `test-plan.md` §6.7:

1. **Unhydrated islands swallow clicks.** Visible, enabled, and no handler attached
   yet — the click reports success and does nothing. Intermittent, and it presents
   as a failure several steps later. Fixed with a state-based barrier on Astro's
   own `astro-island[ssr]` attribute.
2. **`/dashboard` was making real, paid OpenAI calls from the test suite.** The
   seeded user has people but no ranking, so `HierarchyView` mounts stale and POSTs
   `/api/rankings` on every run, and the dev server holds a real key. Roughly eight
   runs went out before it was caught. Every spec that loads `/dashboard` now
   intercepts that route.
3. **`src/middleware.ts` does not hot-reload**, so the first deliberate-break
   check on Risk #5 reported a false all-clear. This is the most dangerous of the
   three because it makes verification itself lie: the break was in the tree, the
   spec was green, and nothing on screen said the server was running last week's
   middleware. Re-run against a restarted dev server, it went red as it should.
   Recorded in `E2E_RULES.md` and test-plan §6.7, and confirmed a second time by
   a controlled probe: with the server freshly restarted, applying the break and
   waiting left anonymous `/dashboard` still redirecting, while the identical
   break took effect immediately after a restart.
4. **The auth gate is three layers deep, not one.** Middleware redirects,
   each page guards on `Astro.locals.user` anyway, and RLS filters a sessionless
   client to zero rows. Good news for Risk #5, and the reason the data-absence
   assertion cannot be made to fire by breaking a single layer (Progress 3.5).
