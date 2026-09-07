# Runner Bootstrap and Access Boundary — Plan Brief

> Full plan: `context/changes/testing-runner-and-access-boundary/plan.md`
> Research: `context/changes/testing-runner-and-access-boundary/research.md`

## What & Why

Test-plan §3 Phase 1. Stand up Vitest in a repo with zero test infrastructure, then prove that neither a second signed-in user nor an anonymous caller can reach the first user's data through real routes. It covers risk **#1** (cross-user read/mutation of people, rankings or contact events) and risk **#5** (unauthenticated visitor, or a stale/replayed recovery token, reaching relationship data) — the two risks anchored in the PRD's binary, GDPR-adjacent privacy NFR.

## Starting Point

The boundary is already stronger than the risk map assumed: all five owner-scoped tables have complete RLS keyed on `(select auth.uid()) = owner_id`, every data route carries its own auth guard, and every id-addressed mutation adds a redundant `.eq("owner_id", …)` producing 404-never-403. No route uses a privileged client. What is missing is _proof_: `rankings` and `ranking_entries` have zero isolation coverage, cross-owner INSERT and anonymous writes are untested on every table, and the recovery-token path was verified only by a checked box in an archived plan. There is no test runner at all — but both harness halves already exist as scripts (`verify-rls.ts`, `verify-openai-call.ts`).

## Desired End State

`npm test` runs a Vitest suite that goes red if user B can read, mutate or forge ownership of user A's rows in any table; if an anonymous client reaches anything; if any route stops rejecting an unauthenticated caller; or if a wrong-owner request stops returning 404 with the mutation not landing. The suite also pins the four recovery-token branches our code owns, replacing a manual-only check.

## Key Decisions Made

| Decision        | Choice                                                | Why                                                                                                                                                 | Source   |
| --------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Route surface   | All 11 authenticated routes, incl. profile + settings | Settings holds the most destructive route in the repo                                                                                               | Research |
| Risk #5 depth   | Both faces — session _and_ recovery token             | S-08 shipped; token path has no automated coverage at all                                                                                           | Research |
| Test shape      | Layered: RLS + handler + opt-in HTTP                  | Cheapest layer per rule; HTTP only where the cookie→middleware chain _is_ the risk                                                                  | Plan     |
| Test env supply | Committed `.env.test`                                 | Values inline at config-resolution time, so runtime assignment is unreliable; local anon key is a fixed non-secret and `.env.test` isn't gitignored | Plan     |
| Code fixes      | Pin behaviour, file the gaps                          | While bootstrapping a runner, a red test must mean "the harness is wrong"                                                                           | Plan     |
| `verify-rls.ts` | Promote, then delete                                  | Test plan calls it "the seed to promote, not to keep"; avoids two artifacts drifting                                                                | Plan     |
| `delete-data`   | Rejection + cross-user survival                       | Blast radius is risk #1; completeness is Phase 2's risk #2                                                                                          | Plan     |
| Layout          | `tests/` split by layer                               | Each layer has a different prerequisite, so path-based selection is what makes subsets runnable                                                     | Plan     |
| CI              | `npm test` script only, no `ci.yml` change            | Test-plan §5 gates the suite at Phase 5; CI has no Postgres                                                                                         | Plan     |
| Token face      | Test our 4 branches, inject the vendor error          | §7 excludes testing Supabase itself                                                                                                                 | Plan     |

## Scope

**In scope:** Vitest bootstrap + `.env.test` + `tests/` layout; RLS isolation across all five tables including the two untested directions; per-route guard, owner-filter and response-shape matrix; `delete-data` cross-user survival; the four recovery-token branches; an opt-in HTTP layer for the auth chain and origin check; cookbook §6.1–6.3 + §6.6.

**Out of scope:** any application behaviour change; testing Supabase or Postgres themselves; CI gating; page routes; erasure completeness; e2e, visual regression, Container API rendering.

## Architecture / Approach

Three layers, one prerequisite each, so a failure is diagnosable:

```
tests/rls/     supabase local up      policies, two real users, anon-key clients
tests/routes/  none (.env.test)       guards, owner filters, response shapes, token branches
tests/http/    TEST_BASE_URL          cookie -> middleware -> locals.user -> guard, origin check
```

The RLS layer never touches Astro, so it needs no env plumbing. The route layer imports real handlers with a synthetic `APIContext`. The HTTP layer extends the existing `verify-openai-call.ts` pattern to two users and **skips** when no server is up — the developer starts the server, the suite never does.

## Phases at a Glance

| Phase               | What it delivers                                                                    | Key risk                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Runner bootstrap | Vitest + config + `.env.test` + layout, plus two probes                             | `astro:env/server` inlines rather than resolving lazily, so `setGetEnv` is inert; `cloudflare:workers` is externalised by the adapter |
| 2. RLS layer        | All five tables × cross-user read/write/forged-insert/anon; `verify-rls.ts` deleted | Fixture must never assert with the service-role key                                                                                   |
| 3. Route layer      | Guard + owner-filter matrix, `delete-data`, token branches                          | A test can pass because RLS caught it, proving one layer twice                                                                        |
| 4. HTTP layer       | Auth chain + origin check, opt-in                                                   | Must skip cleanly, never start a server                                                                                               |
| 5. Cookbook         | §6.1–6.3 filled; gaps filed as a follow-up                                          | Deferred gaps outliving the conversation only if written down                                                                         |

**Prerequisites:** Local Supabase stack (`supabase start`) for Phases 2–3; a dev server you start yourself for Phase 4. Nothing waits on external decisions.
**Estimated effort:** ~4–5 sessions; Phase 1 is short but gated on two probes, Phase 3 is the largest.

## Open Risks & Assumptions

- **Phase 1's probes may both come back awkward.** If `cloudflare:workers` cannot be aliased ahead of the adapter's `enforce: "pre"` externalising plugin, `/api/rankings` and `/api/internal/ai-ping` move to the HTTP layer only — a pre-decided fallback, but it means those two routes get no coverage in a default `npm test`.
- **`@cloudflare/vite-plugin` is injected into the very config `getViteConfig` produces**, so it may destabilise the run in ways nothing in this repo has exercised. Phase 1 exists to find out cheaply.
- **The route layer can prove the wrong thing.** If a wrong-owner test passes because RLS filtered the row rather than because the route's `.eq("owner_id", …)` did, removing the route filter leaves the suite green. Phase 3's manual check is aimed squarely at this.
- **Committing `.env.test` cuts against the repo's "never commit env" reflex.** Mitigated by a header comment; the values are local-stack constants, and the file must never hold a hosted key.

## Success Criteria (Summary)

- Inverting an RLS policy, or deleting a route's auth guard, turns the suite red — and nothing else does.
- `npm test` is green with the stack up and no server; the HTTP layer skips with a message that says what to do.
- Someone who never read this plan can add a new access-boundary test from cookbook §6.2/§6.3 alone.
