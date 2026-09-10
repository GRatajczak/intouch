# E2E rules for this project

Read before generating or editing anything under `tests/e2e/`. Adapted from
`.claude/skills/10x-e2e/references/e2e-quality-rules.md` to this codebase.
`seed.spec.ts` is the worked example; these rules are what it demonstrates.

## Scope — this layer is deliberately two risks wide

E2E is the slowest and most brittle layer in the project. It exists here only
for risks that cross several system boundaries or live only in the rendered UI:

| Risk (`context/foundation/test-plan.md` §2) | Spec |
| --- | --- |
| #4 — a deferred ranking job never reaches a terminal state and the view polls forever | `ranking-job-terminal-state.spec.ts` |
| #5 — an unauthenticated visitor reaches relationship data | `auth-gate.spec.ts` |

Anything an isolated function, a route handler test, or an RLS test can prove
belongs in `tests/unit`, `tests/routes` or `tests/rls` instead. Adding a third
spec means first arguing, in the change folder, why the cheaper layer would lie.

## Locators

1. `getByRole` first, then `getByLabel`, then `getByText`.
2. `getByTestId` only when accessibility attributes are genuinely ambiguous.
3. Never a CSS selector, never XPath, never DOM structure.

The UI is Polish, so accessible names are Polish strings — `getByRole("button",
{ name: "Zapisz osoby" })`. That is a feature: a name that changes is a
user-visible change and deserves to break a test.

Where a control appears twice for responsive reasons (the add-person form has a
desktop and a mobile submit button), the hidden one is out of the accessibility
tree and `getByRole` already ignores it. Where two visible controls share a name
(the delete trigger and its confirmation), scope the second one to its dialog:
`page.getByRole("alertdialog").getByRole("button", { name: … })`.

### The substring trap

Accessible-name matching is a **case-insensitive substring** by default. Polish
labels in this app nest inside one another, and the failure is silent:
`getByRole("button", { name: "Aktywuj" })` matches **"Dezaktywuj"**, so an
assertion meant to prove the status flipped passes against the button that never
changed. Pass `{ exact: true }` whenever one expected name is a substring of
another that can be on screen at the same time.

`getByLabel` has the same trap: `getByLabel("Hasło")` also matches the show/hide
toggle labelled "Pokaż hasło".

## Hydration — never click an unhydrated island

Every interactive surface here is an Astro island (`client:load`). Between the
SSR paint and React attaching its handlers, a button is present, visible and
enabled, so Playwright happily clicks it — and nothing happens. No error, no
request, no state change; the test fails later, on an assertion about a state
that never arrived, and only sometimes.

Use the barrier before the first interaction on any page:

```ts
import { gotoHydrated, waitForHydration } from "./fixtures/hydration";

await gotoHydrated(page, "/people/new"); // goto + barrier
// ...after an in-app navigation:
await waitForHydration(page);
```

Assertions do not need it — `toBeVisible()` retries through hydration on its own.
Interactions do. `fixtures/hydration.ts` explains the mechanism and is the single
place in this suite where a CSS selector is allowed, because it addresses Astro's
island element rather than a UI control.

## Waiting

Never `page.waitForTimeout()`. Wait for state:

- `await expect(locator).toBeVisible()`
- `await page.waitForURL("**/people")`
- `await page.waitForResponse(…)`

Where a bound is measured in real time — the ranking poller runs for
`60 × 2000ms` before giving up — use `page.clock` to fast-forward. Installing a
fake clock is waiting for state; sleeping for two minutes is not, and would make
the test both slow and time-dependent.

`page.clock.install()` must run **before** `page.goto()`, or the island's
interval is already scheduled against the real timer.

## Test independence

Each test owns its full cycle: setup, action, assertion, cleanup. No test may
depend on another having run, and none may depend on order — the suite runs
`fullyParallel`.

Test data carries a `Date.now()` suffix. Cleanup runs inside the test; the
throwaway user is deleted wholesale by `auth.teardown.ts` as the safety net for
a test that dies first. Unique ids prevent collisions, cleanup prevents
accumulation — do both.

## Authentication

Never sign in through the UI inside a spec. `auth.setup.ts` does it once and
writes `storageState`; every spec in the `chromium` project starts signed in.
A spec that must be signed out opts out explicitly:

```ts
test.use({ storageState: { cookies: [], origins: [] } });
```

`supabase/config.toml` caps sign-ins at 30 per 5 minutes per IP and the Vitest
suite already spends about 18. A per-test sign-in would break the budget, not
just the convention.

## Real versus mocked boundaries

E2E is not "zero mocking", it is "the boundaries where integration risk hides
stay real".

- **Always real:** auth, middleware, routing, SSR, Supabase (the local stack).
- **Mockable:** a fetch the *browser* makes, and only where the client's own
  state machine is the risk. `/api/rankings` qualifies for Risk #4.
- **Not reachable from here:** the OpenAI call. It happens server-side inside
  `runRanking()` behind `waitUntil`, so `page.route()` never sees it. Provider
  response validation belongs to the contract layer (test-plan.md §3 Phase 3).

Register every route handler **before** `page.goto()`. A handler installed after
navigation misses the island's first fetch, which is usually the one under test.

### `/api/rankings` must never reach the server unmocked

`/dashboard` mounts `HierarchyView`, and a user whose stored ranking is missing
or stale makes it POST `/api/rankings` on mount. That endpoint dispatches a real
OpenAI call, and the dev server holds a real `OPENAI_API_KEY` — so an unguarded
visit to `/dashboard` in a spec is a paid model call on every run, plus a row
that changes what the next spec sees.

Every spec that loads `/dashboard` must install a `page.route("**/api/rankings*",
…)` handler first: `abort()` when the ranking is incidental (as `auth.setup.ts`
does), or a `fulfill()` that returns the state under test.

Mocked bodies must match the real response type exactly, including
`Content-Type: application/json`. A mock the app would reject makes the test pass
for the wrong reason.

## Assertions

Every assertion must be one the named risk would break. The control question,
asked of each spec before it ships:

> Would this test fail if the `test-plan.md` risk it names came true?

Asserting a page title, a URL, or "the request was made" instead of the business
outcome is the first anti-pattern in
`.claude/skills/10x-e2e/references/e2e-anti-patterns.md`, and it is the one that
looks most like a passing test.

Test names bind to the risk, not to a number:
`test("a ranking job that never settles reaches a visible error state", …)`.

## Shipping a spec

A spec is not done when it is green. It is done when it has been shown to go
**red** with the production behavior it protects deliberately inverted, and the
inversion reverted. Record which behavior you broke in the change folder. Never
commit the break.

**`src/middleware.ts` does not hot-reload.** Pages, components and islands do —
edit one and the next request sees it. Middleware is loaded once into the dev
server's SSR manifest, so a break there keeps passing against the old code and
the deliberate-break check reports a false all-clear. Restart `npm run dev`
after editing middleware, both to break it and to restore it.

Verified twice on 2026-09-10. First, a page edit was served within a second while
a `PROTECTED_ROUTES` edit was not picked up at all. Then, as a controlled probe
after a fresh restart: applying the break and waiting left anonymous `/dashboard`
still redirecting (the server was serving the pre-edit middleware), and the same
break loaded correctly the moment the server was restarted. Restarting is not a
precaution here, it is the only thing that makes the edit real.

## Running

The suite never starts a server. Start the local stack and the app yourself:

```bash
supabase start
npm run dev            # in another terminal
npm run test:e2e
```

`E2E_BASE_URL` overrides the default `http://localhost:4321`. Unlike
`tests/http`, this layer does not skip when it cannot reach the app — it is
opt-in by invocation, so an unreachable base URL is a failure.
