---
change_id: access-boundary-followups
title: Close the two access-boundary gaps Phase 1 pinned, and the page-route test gap
status: new
created: 2026-09-08
updated: 2026-09-08
archived_at: null
---

## Notes

Opened by `testing-runner-and-access-boundary` Phase 5. That change bootstrapped the test runner and proved the access boundary; it deliberately changed **no** application behaviour, because while standing up a runner a red test has to mean "the harness is wrong". These are the three things it found and left alone.

Neither code gap breaches the PRD's binary privacy NFR today — both are covered by RLS. They are missing _redundancy_, and the suite now pins current behaviour, so closing them means updating a test on purpose rather than discovering a silent change.

### 1. `AiJob` carries no owner field

`src/lib/ai-jobs.ts:10-16`. A job's KV record holds `status`, `result`, `error`, `rankingId` — nothing about who owns it. `GET /api/rankings` and `GET /api/internal/ai-ping` both check that _a_ user is signed in, then return the job for whatever `jobId` was polled. A leaked or guessed job id therefore returns that job's status to any signed-in user.

The blast radius is small — a status string and, for rankings, a `rankingId` that is itself RLS-protected on read — which is why it was deferred rather than fixed. `tests/routes/unauthenticated.test.ts` pins the current 401-when-anonymous behaviour and asserts nothing about job ownership, exactly so this stays a known gap rather than a hidden expectation.

Needs an owner field plus a **tolerated-missing-field read path**: jobs written before the change are in flight in KV with a one-hour TTL, and must not start failing mid-poll. Forward-compatible ordering, per `CLAUDE.md`'s rollback rule.

### 2. The two FK lookups in `POST /api/contact-events` have no owner filter

`src/pages/api/contact-events.ts:43` (`person_id`) and `:52-56` (`ranking_entry_id`). Both look up a row by id with no `.eq("owner_id", …)`, so this is the single route on the surface where protection rests **purely** on RLS. Every other id-addressed route carries the redundant filter.

The route's own comments show the reasoning was deliberate and correct — `contact_events`' `with check` tests `owner_id` only, and Postgres does not apply RLS when validating a foreign key, so the lookups run through the caller's RLS-scoped client on purpose. The gap is the missing second layer, not a broken first one.

`tests/routes/cross-owner.test.ts` covers both FK paths under a real RLS session, and says in a comment why it does _not_ use the mismatched-session instrument the other routes use: doing so here would assert the gap instead of the intended behaviour. **That comment must be revisited when the filter lands** — once the route defends itself, those two cases should move to the same instrument as the rest.

### 3. Page routes are untested

`src/pages/dashboard.astro`, `profile.astro`, `people/index.astro`, `people/[id].astro` read data directly under middleware protection. Out of scope by the surface agreed during Phase 1's research, and named here so a later test-plan phase does not assume they were covered.

Note `src/middleware.ts:4` lists `/dashboard`, `/profile`, `/people`, `/settings` — **not** `/api`. `tests/http/access-boundary.test.ts` proves middleware gates a page route and that the per-route guards work behind it, but page-level data reads themselves have no assertions.

### 4. Test-rigor defects found after Phase 1 closed — FIXED 2026-09-08, recorded here

Found by a review pass over Phase 1's own suite, verified on the files, and fixed in place rather than deferred: unlike items 1-3 these were defects **in the tests**, so leaving them open would have meant knowingly carrying a suite that reports protection it does not have.

**4a. `tests/routes/delete-data.test.ts` proved nothing about the route.** The "wipes the caller's own data" case ran with the connection and the claimed identity *matching* (`setRouteClient(fx.clientA)` with `locals.user = { id: fx.userAId }`), so every row the connection could reach was already the caller's and RLS constrained the delete on its own. Verified by mutation: replacing `.eq("owner_id", user.id)` with an always-true predicate in all three deletes in `src/pages/api/settings/delete-data.ts` left the whole suite green. This is precisely the failure mode `cross-owner.test.ts` was written to avoid, and the one route that skipped that discipline.

A second, compounding defect in the same test: the route calls `auth.signOut()` (`delete-data.ts:42`) on the client it was handed, so the post-wipe assertion `ownedCount(fx.clientA, "people") === 0` read zero because the *session* was gone, not because the data was. It would have passed with the deletes removed entirely.

Fixed by adopting `cross-owner.test.ts`'s mismatch instrument — A's connection, handler told the caller is B — plus reading every post-state through a session minted *after* the route returned (`mintExtraSession`). Re-verified by mutation: the filter-stripped route now turns the file red.

**4b. `tests/rls/fixture.ts` leaked throwaway users on two fault paths.** Ids were pushed to `createdUserIds` only after *both* `createConfirmedUser` calls returned, and `adminForTeardown` was set at the same point — so a failure creating user B left user A in `auth.users` with nothing recording it and a teardown that no-opped on a null admin. Separately, `destroyRlsFixture` did `createdUserIds.splice(0)` up front and awaited `deleteUser` in a bare loop, so a throw on the first id discarded every id after it with no way to retry. Plan checkbox 2.8 ("teardown leaves no throwaway users behind") was true only on a clean run.

Fixed: each user is registered the moment it exists, and teardown collects failures per id, puts failed ids back on the list, and throws with them named — a leak the next run would trip over now fails loudly.

**4c. Two comments corrected.** The sign-in budget note undercounted (a `tests/http` file spends four sign-ins, not two, and `mintExtraSession` adds more — a full suite run is ~18 against a 30-per-5-minutes cap, so two runs in a short window can trip it and the failure reads like an auth bug). And `warmRoutes`' claim that "each route refuses it" is not true of `/api/auth/signin`, which has no guard to refuse on and instead throws on `request.formData()` because the warm body is JSON — inert either way, but not for the stated reason.

**Not fixed, deliberately.** The "answers identically" cases in `cross-owner.test.ts` (e.g. `notYours.status === absent.status`) do not pin either value inline; they are meaningful only because a sibling test earlier in the same `describe` pins the concrete 404 and body. That coupling is real but currently sound, and tightening it is a readability change, not a correctness one.

### Suggested order

3 is independent. 1 and 2 are both small; 2 is the cheaper of the two and has a test comment waiting on it. 1 needs the migration-style forward-compatible thinking because of in-flight KV records. 4 is already done and needs no work — it is recorded here so the trail from Phase 1 to the fix is not lost.
