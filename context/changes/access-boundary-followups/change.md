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

### Suggested order

3 is independent. 1 and 2 are both small; 2 is the cheaper of the two and has a test comment waiting on it. 1 needs the migration-style forward-compatible thinking because of in-flight KV records.
