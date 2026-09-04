<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OpenAI Call Path — Non-Blocking Worker Proof

- **Plan**: `context/changes/openai-ranking-call-path/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-31
- **Verdict**: REVISE → **SOUND** after triage (all 7 findings fixed)
- **Findings**: 3 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | FAIL | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | FAIL | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | FAIL | PASS |

**Note on the verdict**: the rubric would read three FAILs as RETHINK. Called REVISE instead, because the plan's load-bearing technical claim verified true and every finding was a targeted edit rather than a change of approach.

## Grounding

8/8 existing paths ✓ (3 new files correctly absent) · `cfContext` claim ✓ verified · brief↔plan ✓

Verified during review — no findings raised, recorded so the next reader doesn't re-derive them:

- `Astro.locals.cfContext` exists and is a real `ExecutionContext` — `node_modules/@astrojs/cloudflare/dist/utils/handler.js:64` (`const locals = { cfContext: context }`).
- It is **typed**: `@astrojs/cloudflare/types.d.ts` declares `App.Locals extends Runtime`, `Runtime = { cfContext: ExecutionContext }` (`dist/utils/handler.d.ts`), pulled in via `.astro/integrations/_astrojs_cloudflare/cloudflare.d.ts`. Declaration merging with `src/env.d.ts`'s `user` field means `npx astro check` will not object.
- Adapter v13.5.0 runs on `@cloudflare/vite-plugin`, so workerd bindings and `.dev.vars` are available in `astro dev` — Phase 2's local verification is achievable.
- `.dev.vars` is loaded into `process.env` at `astro:config:setup` (`dist/index.js:292-300`), a hook that runs for `build` as well as `dev` — criterion 1.2 is valid as written.
- Free-plan limit claims (network wait is not CPU time; 1 of 50 subrequests) are consistent with the `lessons.md` rule about `astro dev`, and Phase 3 honours it by targeting a deployed URL.

## Findings

### F1 — No contract for reading the KV binding

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §1 + §3
- **Detail**: The plan added the `AI_JOBS` binding and typed `Env.AI_JOBS`, but never said how the route obtains it at runtime. `Astro.locals.runtime.env` throws in v13; `astro:env/server` cannot model a KV namespace; `lessons.md`'s "env vars go through astro:env/server only" rule read as a ban on the only remaining path. No existing binding usage anywhere in `src/` to copy.
- **Fix A ⭐ Recommended**: Name `import { env } from "cloudflare:workers"` in the Phase 2 contract, add `src/lib/ai-jobs.ts` as the single importer, and append a scoping rule to `lessons.md`.
  - Strength: Zero new scope; path is already typed (`worker-configuration.d.ts:12188`) and named by the adapter's own error message. The helper gives `S-02` a ready seam.
  - Tradeoff: Requires clarifying `lessons.md`, or the next impl-review flags it as a violation.
  - Confidence: HIGH — verified in `node_modules` and generated types.
  - Blind spot: Not verified that `@cloudflare/vite-plugin` injects KV into `cloudflare:workers`' `env` in dev identically to production workerd — confirm at step 2.4.
- **Fix B**: Store job status in Supabase instead of KV.
  - Strength: No new binding, no rule conflict, reuses the F-01 RLS pattern.
  - Tradeoff: Breaks "Migration Notes: not applicable"; adds a migration and policy to a foundation that deliberately touches no schema.
  - Confidence: MEDIUM.
  - Blind spot: A `waitUntil` write after the response has no user cookie left — needs a separate auth path, which is exactly S-04's unsolved problem.
- **Decision**: FIXED via Fix A — new Phase 2 §3 (`src/lib/ai-jobs.ts`), §1 cross-reference, route rewired to `readJob`/`writeJob`, companion rule appended to `context/foundation/lessons.md`.

### F2 — Verification script has no way to authenticate

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §2
- **Detail**: The plan claimed the script "follows `verify-rls.ts` exactly". It cannot: `verify-rls.ts` reads the **local** stack via `supabase status -o json`, explicitly refuses non-localhost URLs, and mints users with `SERVICE_ROLE_KEY`. The new script must hit a deployed Worker on hosted Supabase with `@supabase/ssr`-format cookies. Criterion 3.1 is this foundation's only automated proof and rested on this unresolved mechanism; the brief deferred it as "an implementation detail".
- **Fix A ⭐ Recommended**: `POST` to the existing `/api/auth/signin` with `redirect: "manual"`, harvest `getSetCookie()`, and reuse that jar for the ai-ping calls.
  - Strength: No replication of `@supabase/ssr`'s chunked cookie format; exercises the real sign-in path; cookies are produced by the same `createClient` the middleware reads back.
  - Tradeoff: Needs a test account in hosted Supabase — a new manual step.
  - Confidence: HIGH — `/api/auth/signin:20-23` writes the cookies onto its response.
  - Blind spot: Email confirmation likely required, so the account must be created once by a human.
- **Fix B**: Shared-secret header instead of a cookie.
  - Strength: Stateless script, no test account.
  - Tradeoff: Weakens the exact auth contract the route exists to demonstrate; adds a fourth secret to three locations.
  - Confidence: MEDIUM.
  - Blind spot: The pattern would carry into S-02.
- **Decision**: FIXED via Fix A — Phase 3 §2 rewritten with the 4-step cookie-jar flow, `VERIFY_EMAIL`/`VERIFY_PASSWORD` env contract, a one-off human prerequisite, and new Progress steps 3.4 / 3.5.

### F3 — 14 duplicate checkboxes break the Progress parsing contract

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: lines 77–171 (phase-body Success Criteria)
- **Detail**: Phase-body Success Criteria used `- [ ]`, identical to Progress (which starts at line 210). `progress-format.md` defines "next pending step = first `- [ ]` line in document order", so `/10x-implement` would have landed on line 77 instead of step 1.1. The shipped `design-alignment-pass` plan keeps checkboxes exclusively inside Progress.
- **Fix**: Convert phase-body criteria to plain `- ` bullets; leave Progress untouched.
- **Decision**: FIXED — 16 checkboxes converted (14 original + 2 added by F2). Verified: 0 checkboxes remain outside Progress; per-phase counts now match Progress exactly (5/5, 6/6, 5/5).

### F4 — Phase 1 contradicts itself on build-time requirements

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 vs §3
- **Detail**: §1 chose `optional: true` while §3 asserted the build "needs" the key at build time and that a human must add the GitHub Secret "before this step is exercised in CI". With `optional: true` the build cannot fail, so step 1.4 read as a blocker it is not.
- **Fix**: Reframe §3 as defensive wiring ahead of S-02 flipping the var to `optional: false`; mark 1.4 non-blocking.
- **Decision**: FIXED.

### F5 — KV entries written without `expirationTtl`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §3 (now §4)
- **Detail**: Neither the `pending` write nor the terminal write specified a TTL. Negligible at this foundation's scale, but `S-02` copies the pattern under real traffic and would inherit a leak by default.
- **Fix**: Specify `expirationTtl: 3600` on every write, in the helper rather than at call sites.
- **Decision**: FIXED — folded into F1's `src/lib/ai-jobs.ts` contract so both writes inherit it.

### F6 — 401 JSON establishes a second API convention

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §3 (now §4)
- **Detail**: Every existing API route redirects to `/auth/signin` on a missing user (`src/pages/api/people.ts:8`, `src/pages/api/profile.ts`). This one returns 401 JSON — correct for a machine endpoint, but undocumented as deliberate. The brief noted it; the plan did not.
- **Fix**: One sentence scoping the JSON contract to `/api/internal/*`.
- **Decision**: FIXED — "Convention note" added to the route contract.

### F7 — `.env.example` step is already done

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2
- **Detail**: The plan called for adding `OPENAI_API_KEY=###` to `.env.example`; it landed in `d4ea632`, after the plan was written. A no-op step, but a signal that Current State Analysis was a commit behind.
- **Fix**: Drop `.env.example` from §2, keep `.dev.vars`.
- **Decision**: FIXED — §2 retitled "Local secret", with a note that the placeholder already exists.
