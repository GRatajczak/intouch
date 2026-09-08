# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-04

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `scripts/`,
`supabase/` — excluding `context/`, `dist/`, `node_modules/`, `.github/`.
53 commits in the last 30 days: sufficient signal.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                         | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | A signed-in user reads or mutates another user's people, rankings or contact events through a normal API path                                                   | High   | Medium     | interview Q1; PRD NFR-privacy (binary, GDPR-adjacent), `## Access Control`; roadmap F-01; hot-spot dir `src/pages/api` (20 commits/30d)                                                                                                                |
| 2   | Erasure is reported as done but data survives — or a deactivated person still reaches the ranking input                                                         | High   | Medium     | PRD FR-005, NFR "deleting a person's data is fully and irreversibly honored"; roadmap S-05 (in-progress); `lessons.md` "ON DELETE CASCADE on owner_id is a per-table decision"                                                                         |
| 3   | A malformed, partial or nonsense AI response renders as an authoritative hierarchy with no error — the user sees a wrong order, not a failure                   | High   | Medium     | interview Q1; PRD guardrail "quality / relevance of AI suggestions"; US-01 acceptance criteria; hot-spot dirs `src/components/hierarchy` (28 commits/30d), `src/lib/ranking` (8 commits/30d)                                                           |
| 4   | A deferred ranking job never reaches a terminal state and the view polls forever — stuck is indistinguishable from slow                                         | Medium | High       | interview Q2 (already happened); PRD NFR "generating the AI hierarchy never blocks the user … notified when the result is ready"; roadmap F-02                                                                                                         |
| 5   | An unauthenticated visitor, or a stale/replayed password-recovery token, reaches relationship data                                                              | High   | Medium     | PRD `## Access Control` ("an unauthenticated visitor has no access to any relationship data"); roadmap S-08 (in-progress); hot-spot dirs `src/pages/auth` (11 commits/30d), `src/pages/api` (20 commits/30d)                                           |
| 6   | A hand-rolled request stores out-of-bounds data the form would have blocked, or instruction-shaped free text steers the ranking output                          | Medium | Medium     | PRD FR-002 / FR-003 (bounded free-text, weight 1–10), Open Question 2; hot-spot dirs `src/lib/validation` (11 commits/30d), `src/components/forms` (21 commits/30d); tech-stack constraint: all user free text is composed into an LLM prompt          |
| 7   | The scheduled sweep sends more than once a day, sends to the wrong recipient, fails silently — or reaches for a service-role key and defeats per-user isolation | High   | Low–Medium | PRD FR-008, NFR "at most once per day", NFR "delivery outcomes must be observable rather than fire-and-forget"; roadmap S-04 risk note (RLS unknown for an absent-user sweep); `lessons.md` "onboarding@resend.dev is a placeholder, not final config" |

Resource abuse (hammering the ranking trigger to burn AI budget) was
considered under the abuse lens — FR-001 names cost control as a login
rationale — and deliberately not promoted: on a solo, pre-launch MVP behind
mandatory auth its likelihood is Low, and it belongs to observability rather
than to a test.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                       | Must challenge                                                                                     | Context `/10x-research` must ground                                                                                              | Likely cheapest layer                                                                   | Anti-pattern to avoid                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| #1   | User B's authenticated request for user A's resource returns not-found/forbidden, **and** the mutation does not land                                                                              | "It is authenticated, therefore it is authorized"; "the client would never send another user's id" | Where ownership is actually enforced — DB policy, route guard, or both; which tables carry an owner column                       | integration against the local Supabase stack, with two real users                       | Proving the policy with the same key that wrote the row; asserting only on the read path and never on writes                      |
| #2   | After delete, no row in any table still references the person; after deactivate, contact history is retained **and** the ranking input excludes them                                              | "The delete returned 200, so the data is gone"                                                     | Every table holding person-derived rows; cascade vs. orphan behaviour per table; what the ranking input query actually selects   | integration                                                                             | Asserting only on the people table and calling erasure proven                                                                     |
| #3   | A malformed, empty or partial provider response produces an explicit error state; every rendered entry carries a suggested time window; two people on the same weight are not treated identically | "The response parsed, so it is usable"; "an empty array means there is nobody to contact"          | The boundary where the provider response is validated, and what happens when that validation fails                               | unit / contract over recorded fixtures, plus one integration; **no live provider call** | Taking the oracle from the code — expected values must come from US-01's acceptance criteria, not from the ranking implementation |
| #4   | A failed, expired or never-settled job reaches a terminal state the view renders as an error, within a bounded time                                                                               | "The job resolved because the last poll returned 200"                                              | The job state machine: which states are terminal, whether an expiry or timeout exists at all, what the poller does in each state | integration with an injected clock                                                      | Testing only the success path; sleeping in tests instead of injecting time                                                        |
| #5   | A request carrying no session, an expired session, or a reused/expired recovery token receives no relationship data                                                                               | "Middleware guards the page, so the API beneath it is guarded too"                                 | Which routes the guard actually covers; single-use and expiry semantics of the recovery token                                    | integration                                                                             | Asserting the redirect and never asserting the API response body                                                                  |
| #6   | The server rejects out-of-bounds weight and over-long text regardless of what the form sent; instruction-shaped description text does not change the output contract                              | "Zod runs on the form, so the data is validated"                                                   | Whether the same schema runs server-side; how free text is composed into the prompt                                              | integration on the routes, plus unit on prompt composition                              | Testing the client-side schema and calling the endpoint covered                                                                   |
| #7   | Two sweeps in one day produce one send; each send targets the account address; a send failure is recorded rather than swallowed; the sweep reads only rows it is entitled to                      | "The cron fired, therefore the email arrived"                                                      | How the sweep authenticates across users; where the send outcome is recorded; what the dedupe key is                             | integration with an injected clock and a stubbed provider                               | Asserting that the provider SDK was called, instead of asserting the once-per-day invariant                                       |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                   | Goal (one line)                                                                                                               | Risks covered     | Test types                                                           | Status      | Change folder                                         |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------- | ----------- | ----------------------------------------------------- |
| 1   | Runner bootstrap and access boundary         | Vitest exists and runs, and neither a second user nor an anonymous caller can reach the first user's data through real routes | #1, #5            | unit + integration                                                   | complete    | `context/changes/testing-runner-and-access-boundary/` |
| 2   | Erasure and lifecycle                        | Deletion is complete across every table, and deactivate retains history while leaving the ranking input                       | #2                | integration                                                          | not started | —                                                     |
| 3   | AI boundary contract and job terminal states | Bad provider output becomes a visible error instead of a rendered order, and no job can strand the polling view               | #3, #4            | unit/contract on fixtures + integration + one AI-native sanity judge | not started | —                                                     |
| 4   | Input boundary and prompt composition        | The server enforces the same bounds as the form, and free text cannot change the ranking output contract                      | #6                | integration + unit                                                   | not started | —                                                     |
| 5   | Quality-gates wiring and scheduled delivery  | The suite blocks CI and deploy, and the sweep's once-per-day and recipient invariants hold under an injected clock            | #7, cross-cutting | gates + integration                                                  | not started | —                                                     |

Phase 5's delivery half is gated on roadmap `S-04` leaving `blocked`; its
gates half does not wait on anything and can land regardless.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                     | Tool                                                            | Version                              | Notes                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration        | Vitest                                                          | 5.0.0 (devDependency)                | Wire through `getViteConfig()` from `astro/config`; Astro 6 requires `test.environment: "node"` for anything rendering `.astro`                                                                            |
| Astro component rendering | Container API (`astro/container`)                               | ships with astro 6.3.1, experimental | Only where a React-level test will not do; prefer testing the route over the template                                                                                                                      |
| DB / RLS integration      | Supabase CLI local stack                                        | 2.23.4 (devDependency)               | Two-real-user harness, now `tests/rls/fixture.ts`; `scripts/verify-rls.ts` was promoted and deleted in Phase 1                                                                                             |
| provider stubbing         | none yet — see Phase 3                                          | —                                    | Stub at the network edge only; never mock internal modules                                                                                                                                                 |
| e2e                       | not planned                                                     | —                                    | Integration against real routes plus the local Supabase stack covers the critical flows more cheaply — see §7                                                                                              |
| accessibility             | eslint-plugin-jsx-a11y                                          | 6.10.2                               | Already enforced through `npm run lint`; no runtime pass planned                                                                                                                                           |
| (optional) AI-native      | LLM-as-judge over frozen ranking fixtures — checked: 2026-09-04 | n/a                                  | **When NOT to use:** anything a schema or contract assertion already catches (shape, missing time window, empty result), and never inside the blocking CI gate — it runs on demand when the prompt changes |

**Stack grounding tools (current session):**

- Docs: Context7 via the `ctx7` CLI — confirmed Astro's Vitest integration (`getViteConfig`, the v6 `environment: "node"` requirement, the Container API); checked: 2026-09-04
- Search: WebSearch / WebFetch available — not needed, the docs source answered directly; checked: 2026-09-04
- Runtime/browser: Claude-in-Chrome MCP available; no Playwright MCP in session — not used, since no e2e layer is planned; checked: 2026-09-04
- Provider/platform: Linear MCP authenticated (roadmap status mirroring); Supabase and PostHog MCPs present but **not authenticated in this session**, so local Supabase CLI is the integration surface; checked: 2026-09-04

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate                                               | Where                      | Required?                 | Catches                                                                                      |
| -------------------------------------------------- | -------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| lint + typecheck                                   | per-edit + pre-commit + CI | required (wired)          | syntactic / type drift — `eslint --fix` and `tsc --noEmit` per edit, `astro check` at commit |
| build                                              | local + CI                 | required (wired)          | broken build, missing env schema entries                                                     |
| unit + integration                                 | local + CI                 | required after §3 Phase 5 | logic regressions, access-boundary and erasure regressions                                   |
| suite blocks deploy                                | CI on push to `main`       | required after §3 Phase 5 | a regression auto-deploying to production                                                    |
| post-edit hook on the test suite                   | local (agent loop)         | wired for Risk #1 only    | cross-user access-boundary regressions at edit time, before CI                               |
| manual human look at any visible UI change         | before merge               | required (convention)     | rendering failures every automated check passes — see `lessons.md` on `.astro` link-buttons  |
| pre-prod smoke against a `versions upload` preview | between merge and prod     | optional                  | Workers-runtime-only failures that `astro dev` cannot show                                   |

Local layering (wired 2026-09-08, `.claude/hooks/` + `.husky/pre-commit`):

| Layer                                  | What runs                                                                                                                                                                                                                     | Cost                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| per-edit (`PostToolUse` `Write\|Edit`) | `eslint --cache --fix` on the edited file; `tsc --noEmit`; `vitest related` **only** when the edited file is in the Risk #1 surface (`src/pages/api`, `src/pages/auth`, `src/middleware.ts`, `src/db`, `src/lib/supabase.ts`) | ~3–7s, hooks run in parallel; 0s outside those paths |
| pre-commit (husky)                     | `lint-staged`; `astro check` (the only checker that sees `.astro` templates); `vitest related` on staged Risk #1 files                                                                                                        | ~15s                                                 |
| CI                                     | full `npm test` with the Supabase stack up                                                                                                                                                                                    | —                                                    |

`tests/rls/**` is excluded from both local layers: it is the one suite with an
external prerequisite (`supabase start`) and it fails hard rather than skipping
when the stack is down, which would make every local gate red on a machine with
no local Postgres. `tests/http` needs no exclusion — it self-skips on an unset
`TEST_BASE_URL`. Both run in full via `npm test` and in CI.

The suite is deliberately not gated until Phase 5: gating a suite of one
phase's tests buys nothing and blocks the rollout on flakiness before there
is anything worth protecting.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

**Where tests live.** `tests/`, one directory per layer, files named `*.test.ts`. `tests/stubs/` holds helpers, not tests, and is deliberately outside `test.include`.

**Run them.** `npm test` (once) or `npm run test:watch`. A single layer: `npm test tests/rls`.

**Prerequisites are per file, not per directory** — the neat three-layers/three-prerequisites split does not survive contact with reality, so check this table before assuming a test is hermetic:

| File                                                          | Needs                                            |
| ------------------------------------------------------------- | ------------------------------------------------ |
| `tests/rls/*`                                                 | local Supabase stack (`supabase start`)          |
| `tests/routes/unauthenticated`, `tests/routes/recovery-token` | nothing                                          |
| `tests/routes/cross-owner`, `tests/routes/delete-data`        | local Supabase stack                             |
| `tests/http/*`                                                | a server **you** start, plus the stack behind it |

The suite never starts a server. `tests/http` skips when `TEST_BASE_URL` is unset, and fails loudly when it points somewhere wrong.

**How env reaches a test.** `vitest.config.ts` runs Vitest through Astro's own `getViteConfig()`, so `astro:env/server` and the `@/` alias resolve exactly as in the app. The values come from **`.env.test`, committed on purpose** — Astro's env plugin _inlines_ them at Vite config-resolution time, so setting `process.env` in a test file or a `setupFiles` module is too late. Do not reach for `setGetEnv` from `astro/env/setup`: under a non-build command the generated module never calls it, so it is inert. `.env.test` holds local-stack constants only and must never hold a hosted-project key.

**Why the config strips plugins.** `@astrojs/cloudflare` binds `@cloudflare/vite-plugin` to the `ssr` environment, and that plugin refuses to start when a Worker environment carries `resolve.external` — which Vitest always sets. Left in place, Vitest dies during config resolution before reading a single test file. `vitest.config.ts` drops every `vite-plugin-cloudflare*` / `@astrojs/cloudflare:*` / `virtual:astro-cloudflare:*` plugin and keeps Astro's own. That also un-externalises `cloudflare:*`, which is what lets `cloudflare:workers` alias to `tests/stubs/cloudflare-workers.ts` so the two AI-job routes are importable in node.

### 6.2 Adding an integration test against the local Supabase stack

Start from `tests/rls/fixture.ts` (`createRlsFixture()` / `destroyRlsFixture()`). It creates two confirmed throwaway users, hands back anon-key clients carrying their real sessions plus a sessionless client, and seeds one row per owner in all five owner-scoped tables.

Five rules make such a test mean something:

1. **Service-role creates and deletes users, and does nothing else.** Every assertion runs through an anon-key client carrying a real JWT. Proving a policy with a key that bypasses it proves nothing. (In this schema service-role could not read the tables anyway — see §6.3.)
2. **Expect zero rows, not thrown errors.** RLS _filters_; it does not reject. A cross-owner SELECT returns an empty set and a cross-owner UPDATE/DELETE reports zero rows affected, both with `error === null`. Asserting "an error was thrown" fails against correct behaviour. Only a missing GRANT yields an error (`42501`).
3. **Pair every mutation attempt with a victim-side read.** Zero rows affected is not the same as the row surviving, and only the owner can see the row at all.
4. **Assert the error _code_ on a forged-owner INSERT.** This is the one direction that really rejects (`42501`, "new row violates row-level security policy"). On `profiles`, where `owner_id` is the primary key, a forged insert would also fail without RLS — on a `23505` unique violation — so "some error occurred" would pass with the boundary gone.
5. **Teardown deletes the users and lets `ON DELETE CASCADE` do the rest.** No per-table cleanup.

Prefer one parameterised test per property over near-identical copies per table; `tests/rls/isolation.test.ts` covers five tables × nine properties this way.

**Budget the sign-ins.** `supabase/config.toml` caps `sign_in_sign_ups` at 30 per 5 minutes per IP, and each fixture spends two. Vitest isolates test files, so each file pays again — roughly fifteen RLS files per five minutes. Past a handful, promote the fixture to a Vitest `globalSetup` that mints sessions once and hands the tokens to each file.

### 6.3 Adding a test for a new API endpoint

Invoke the real exported handler with `createContext()` from `tests/routes/context.ts`, which builds the six `APIContext` members these handlers actually consume. Install the Supabase client through `tests/routes/route-client.ts` rather than through cookies.

**The triad.** Anonymous, wrong-owner, own — plus a control that the route works when ownership matches, so a route that always 404s cannot pass.

**There is no uniform 401 on this surface.** Assert the route's _real_ response family, or the test fails on correct code:

| Family                                  | Routes                                                               |
| --------------------------------------- | -------------------------------------------------------------------- |
| `{"error":"Unauthorized"}` 401          | `people/[id]`, both `contact-events`, `rankings`, `internal/ai-ping` |
| `{"error":"Musisz być zalogowany"}` 401 | `profile`, all three `settings/*`                                    |
| 302 redirect, no body                   | `POST /api/people`, `POST /api/auth/reset-password`                  |

**Assert "absent" and "not yours" are identical** — equal status _and_ equal body. Any difference tells an attacker which ids exist.

**Do not run cross-owner route tests under the attacker's own session.** RLS would silently catch what the route stopped catching, and the suite would prove one layer twice while claiming to prove two. The instrument that works: give the handler a connection carrying user A's real session while `locals.user` says the caller is B, leaving the route's own `.eq("owner_id", …)` as the only barrier. Verify it by deleting that filter — the test must go red.

**The obvious alternative does not work here.** Every migration grants table privileges to `anon` and `authenticated` only, so a `service_role` client gets `permission denied for table people` straight from PostgREST. That is a good property of the schema; do not widen a grant to make a test convenient.

**Never assert on a vendor-authored error string.** Inject the failure (`verifyOtp` returning an error) and assert which branch _we_ took. Supabase's message text is unsanitised and version-dependent, and pinning it turns a vendor patch into a false regression.

**Non-browser callers must get past Astro's origin check**, which runs _before_ routing. Send `Content-Type: application/json` — a non-form content-type skips the check entirely. A form-encoded or bodiless request needs an explicit matching `Origin`, or it is rejected `403 "Cross-site POST form submissions are forbidden"` and never reaches the route. `GET`/`HEAD`/`OPTIONS` are exempt. `tests/http/origin-check.test.ts` pins all three body kinds.

**Only `tests/http` proves the cookie chain.** The route layer hands `locals.user` in directly, so it proves the guard _given_ a user — never that a real session cookie produces one. Mint jars by POSTing to the app's own `/api/auth/signin` and harvesting `getSetCookie()`; never hand-craft the chunked `sb-<ref>-auth-token.0`/`.1` format. Note `src/middleware.ts` does not list `/api`, so middleware sets `locals.user` for API requests but does not gate them — the per-route guards do.

### 6.4 Adding a test for irreversible deletion

- TBD — see §3 Phase 2 for the "no row in any table still references the person" pattern, and the deactivate-retains-history counterpart.

### 6.5 Adding a test around the AI boundary

- TBD — see §3 Phase 3 for the recorded-fixture contract pattern (malformed / empty / partial response becomes a visible error, never a rendered order) and the injected-clock job-terminal-state pattern.

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the phase taught.)

**Phase 1 — runner bootstrap and access boundary (2026-09-08).** Four surprises worth carrying forward:

- `astro:env/server` **inlines** its values at transform time under any non-build Vite command, rather than resolving them lazily. Env must therefore exist at config-resolution time (`.env.test`); `setGetEnv` is inert.
- Running `getViteConfig()` under a test runner requires **removing the Cloudflare adapter's Vite plugins**, or Vitest never starts — the failure looks like a config error about `resolve.external`, not like anything to do with tests.
- **`service_role` holds no table grants in this schema.** Anything reaching for it to bypass RLS will get `permission denied`, and that is the schema being right.
- A route-layer test that runs under the attacker's own RLS session **cannot fail** when a route's owner filter is deleted. Always verify a boundary test by removing the thing it claims to protect.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **The landing page** — static marketing copy with nothing downstream depending on it; assertions would break on every copy edit and catch nothing. Re-evaluate if it gains a form, a signup path, or dynamic content. (Source: Phase 2 interview Q5.)
- **Visual and CSS regression** — no screenshot baselines, no vision review of screens. The substitute is the human-look convention in §5, which `lessons.md` shows is what actually caught the one real rendering failure. Re-evaluate if a design system change touches many screens at once. (Source: Phase 2 interview Q5.)
- **The vendors themselves** — no test asserts that Supabase auth or Postgres works, and none judges OpenAI's model quality. No test makes a live call to either. Our own code around them is fully in scope: our policies, our validation of provider responses. (Source: Phase 2 interview Q5, clarified.)
- **End-to-end browser flows** — no Playwright layer. Every risk in §2 is reachable at the integration layer against real routes plus the local Supabase stack, which is cheaper to run and to keep green. Re-evaluate if a risk surfaces that only the deployed shape can reproduce (a cookie/session crossing the Workers boundary is the likeliest candidate). (Source: §1 principle 1, cost × signal.)
- **`src/components/ui/`** — shadcn-generated primitives; the generator is the test. Re-evaluate for any primitive that gets hand-modified. (Source: tech-stack.md convention.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-04
- Stack versions last verified: 2026-09-08 (Vitest 5.0.0 added by §3 Phase 1)
- AI-native tool references last verified: 2026-09-04

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
