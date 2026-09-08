---
change_id: testing-runner-and-access-boundary
title: Testing runner and access boundary
status: implementing
created: 2026-09-07
updated: 2026-09-08
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 1 divergences from the plan

Three things the plan did not anticipate. None changes application behaviour.

1. **`@cloudflare/vite-plugin` blocks Vitest at startup, not at import.** The plan framed Probe B as "can `cloudflare:workers` be aliased ahead of the `enforce: "pre"` cf-imports plugin". The real obstacle was earlier and larger: the adapter binds `@cloudflare/vite-plugin` to the `ssr` Vite environment, and that plugin refuses to start when a Worker environment carries `resolve.external` — which Vitest always sets on `ssr`. Vitest died during config resolution before reading a single test file. `vitest.config.ts` now strips every adapter-injected Vite plugin from the config `getViteConfig` returns. Full reasoning is recorded in the plan's Phase 3 §6 scope note.

2. **A fourth test directory, `tests/stubs/`, exists.** The plan named three layer directories. The `cloudflare:workers` alias needs a target, so `tests/stubs/cloudflare-workers.ts` holds the in-memory KV stub. It is deliberately outside `test.include`: it holds helpers, not tests.

3. **`eslint.config.js` gained a `supabase/.temp/**`ignore.** Pre-existing, surfaced by this change.`supabase/.gitignore`excludes`.temp`, but ESLint's `includeIgnoreFile`reads the root`.gitignore`only — so once`supabase start` has run, the stack's scratch files enter the lint run and fail the TS project service. Lint and a running stack were rarely simultaneous before; from Phase 2 the RLS layer requires the stack, so they now coincide routinely.

### Probe B outcome

Succeeded. `/api/rankings` and `/api/internal/ai-ping` are covered at the **route layer** in Phase 3; Phase 4 §4 ("Job routes, if deferred") does not apply.

### For Phase 5's cookbook (§6.6)

Two surprises worth writing down, not one:

- `astro:env/server` inlines its values at transform time under any non-build Vite command, so env must exist at config-resolution time (`.env.test`) — `setGetEnv` is inert.
- Running Astro's `getViteConfig` under a test runner requires removing the Cloudflare adapter's Vite plugins, or the runner never starts.

### Phase 2 divergences from the plan

1. **"Sessions minted once per suite run, shared across files" is not literally achievable.** Vitest isolates test files, so a module-level memo in `fixture.ts` would be re-evaluated per file — and memoising across files without a global teardown is actively harmful, since the first file's `afterAll` would delete users the second file still needs. The fixture therefore creates and destroys per file, and documents the real budget: 2 sign-ins per file against the 30-per-5-minutes cap at `supabase/config.toml:189`, so roughly fifteen RLS files per five minutes. With one file today the plan's intent holds. If `tests/rls/` grows past a handful, promote to a Vitest `globalSetup` that mints the sessions once and hands the tokens to each file — noted in the fixture's own comment.

2. **`scripts/verify-rls.ts`'s comment about `profiles` DELETE was stale, and the new tests do not carry it forward.** The script tolerated either `42501` or a zero-row result, because `profiles` had no DELETE policy _and_ no DELETE grant when it was written. `20260904221004_add_profiles_delete_policy.sql` added both. Cross-owner profile DELETE now filters to zero rows like every other table, and `isolation.test.ts` asserts that uniformly.

3. **The forged-owner INSERT asserts the error _code_, not merely that an error occurred.** On `profiles`, `owner_id` is the primary key, so an insert forging user A's id would fail on a `23505` unique violation even with RLS gone. Asserting `42501` is what keeps that test from passing against a removed boundary.

### Still unverified after Phase 2

The stack-down path (`readLocalStatus`'s "run `supabase start`" message) has not been exercised — doing so means stopping the developer's local stack. It is manual testing step 4 in the plan's Testing Strategy.

### Phase 3 divergences from the plan

1. **The planned way to isolate the route layer does not work, and should not be forced.** Phase 3's manual item 3.9 needs the DB layer bypassed, so that a route's own `.eq("owner_id", …)` is the only thing refusing an attacker; the obvious instrument is a service-role client. It fails here: every migration grants table privileges to `anon` and `authenticated` only, so `service_role` gets `permission denied for table people` straight from PostgREST. That is a good property of the schema — widening the grant to make a test convenient would weaken production. The instrument used instead is a deliberate mismatch: the database connection carries user A's real session while `locals.user` says the caller is B, leaving the route's own filter as the only barrier. Verified working — deleting the filter from `PATCH /api/people/[id]` turns exactly its two cross-owner tests red.

2. **`tests/routes/` is not prerequisite-free, contrary to the plan's layer table.** `unauthenticated.test.ts` and `recovery-token.test.ts` are fully hermetic. `cross-owner.test.ts` and `delete-data.test.ts` need the local Supabase stack — they reuse `tests/rls/fixture.ts` for two real users and real rows, because a stub would lie about exactly the thing under test. Phase 5's §6.1 cookbook entry must describe the prerequisite per file, not per directory.

3. **`tests/routes/route-client.ts` is a shared module the plan did not name.** It holds the `@/lib/supabase` seam so a test can say "run this handler as user B" without hand-crafting Supabase's chunked auth cookie — an internal format the plan itself warns against imitating (Phase 4 §1). Proving that a real cookie becomes `locals.user` stays tests/http's job.

4. **`unauthenticated.test.ts` stubs nothing at all.** Every guard on this surface runs before its handler builds a client or reads a body, so leaving the seam empty makes the file a check on guard _ordering_ as well as presence: if any handler started touching Supabase first, these tests would fail on a missing client rather than passing quietly.

### For Phase 5's cookbook (§6.3)

- The three unauthenticated response families on this surface, and why a uniform 401 expectation would be wrong.
- Why route-layer cross-owner tests must not run under the attacker's own RLS session: the suite would prove one layer twice while claiming to prove two.
- `service_role` has no table grants in this schema — worth stating before someone else reaches for it.
