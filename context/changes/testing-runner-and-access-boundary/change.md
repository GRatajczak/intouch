---
change_id: testing-runner-and-access-boundary
title: Testing runner and access boundary
status: implementing
created: 2026-09-07
updated: 2026-09-07
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
