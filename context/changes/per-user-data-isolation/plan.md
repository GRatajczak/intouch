# Per-User Data Isolation Implementation Plan

## Overview

This is `F-01` on the roadmap: the foundation every data-owning slice (`S-01`, `S-02`, `S-03`, `S-05`) builds on. It establishes the pattern for how any user-owned table in this app gets RLS-protected — proven once, here, on a single minimal table — rather than retrofitted after three slices already have rows in production. Concretely: a first Supabase migration creates a `people` table with default-deny RLS and an owner-scoped policy per command, generated TypeScript types make that schema visible to app code, and a repeatable script proves user B genuinely cannot read user A's rows.

## Current State Analysis

- `supabase/` holds only `config.toml` (still carrying the starter's `project_id = "10x-astro-starter"`) and `.gitignore`. No `supabase/migrations/`, no `.supabase/` link file, no RLS, no generated types anywhere in `src/`.
- A Supabase project already exists and is reachable: `SUPABASE_URL`/`SUPABASE_KEY` (anon key) are live in `.dev.vars` (gitignored) and in GitHub Secrets (`ci.yml:22-24`, `deploy.yml:26-28`).
- `src/lib/supabase.ts` exports `createClient(requestHeaders, cookies, responseHeaders)`, wrapping `@supabase/ssr`'s `createServerClient` with cookie-based session handling. It returns `null` if `SUPABASE_URL`/`SUPABASE_KEY` are unset — every caller already null-checks.
- `src/middleware.ts` calls `createClient(...)`, resolves `supabase.auth.getUser()`, and sets `context.locals.user`; it guards `/dashboard` by redirecting unauthenticated visitors to `/auth/signin`.
- `src/env.d.ts` types `App.Locals.user` as `User | null` from `@supabase/supabase-js`. No `Database` type exists yet, so no Supabase call anywhere in the app is schema-typed.
- `src/pages/api/auth/{signin,signup,signout}.ts` only call `supabase.auth.*` — no table reads/writes exist yet, so there is nothing to migrate off an untyped client.
- No test runner is configured (`package.json` has no `vitest`/`jest`/etc.) — the isolation check has no existing home.
- `ci.yml`/`deploy.yml` build and deploy the Worker; neither touches Supabase migrations or schema in any way today.
- `astro.config.mjs` declares `SUPABASE_URL`/`SUPABASE_KEY` via `astro:env/server` (`context: "server", access: "secret"`) — the only sanctioned way to read env in this repo (see `CLAUDE.md`).

## Desired End State

`supabase/migrations/` contains one forward-compatible migration, applied both to the local Supabase instance and to the production project, that creates a `people` table with RLS enabled and no default access — an owner-scoped policy per command is the only way in. `src/db/database.types.ts` is committed and reflects that schema. `src/lib/supabase.ts`'s `createServerClient` call is generic over the `Database` type, so any future table read/write in app code is schema-typed. `npm run verify:rls` seeds two throwaway users against a local Supabase instance, proves each can read/write only their own `people` rows (and that an unauthenticated client sees none), and exits non-zero on any violation.

### Key Discoveries:

- `src/lib/supabase.ts:6` — `createClient` already centralizes all Supabase client construction; this is the one place the `Database` generic needs to be threaded through.
- `context/foundation/infrastructure.md:66` — `Astro.locals.runtime` doesn't exist in this adapter; all env access goes through `astro:env/server`, already followed correctly in `src/lib/supabase.ts`.
- `context/foundation/roadmap.md:93` — `wrangler rollback` reverts Worker code only, never the database, so this migration (and every one after it) must be additive/forward-compatible by construction.
- No `.supabase/` directory exists — the project has never been `supabase link`-ed to its remote project. Linking is a one-time human step, needed before `supabase db push` can target production.

## What We're NOT Doing

- No `profiles` (self-profile) table — that belongs to `S-01`.
- No domain columns on `people` (no `description`, `single_vs_collective`, `weight`) — those are `S-01`'s job, added as their own forward-compatible migration once FR-002/FR-003's field set is pinned (open roadmap question, owner: user, during `S-01`'s plan).
- No wiring of the isolation check into CI (`ci.yml`) — it stays an on-demand script (`npm run verify:rls`), not a required check on every PR.
- No automated production migration application in `deploy.yml` — `supabase db push` to production stays a manual, human-run step, consistent with `CLAUDE.md`'s treatment of production-touching operations as human-only.
- No API routes or UI for people — nothing in this change is reachable from a browser. This is schema + proof only.
- No `S-05` deactivate/delete semantics beyond the FK's `ON DELETE CASCADE` on `auth.users` deletion — deactivation and app-level delete flows are `S-05`'s scope.

## Implementation Approach

One migration establishes the pattern; one script proves it holds. The `people` table is deliberately the *proof* table, not a first draft of the domain model — it carries only `id`, `owner_id`, `created_at`, enough to exercise the full RLS shape (FK-owned, 1:many, all four commands) without pulling in FR-003's still-open field decisions. The verification script runs against a local Supabase instance (via the CLI, not production) so it needs no new secret: it derives the local service-role and anon keys at runtime from `supabase status -o json`, uses the service-role client to seed and tear down two throwaway users, and uses two anon-keyed clients — each carrying one user's session — to assert the isolation boundary from the same vantage point the real app will use.

## Critical Implementation Details

- **Local Supabase must be running before either new npm script works.** `npm run db:types` (`supabase gen types typescript --local`) and `npm run verify:rls` both require `supabase start` to have been run first — `--local` reads the locally running Postgres instance, not the remote project. This is not obvious from the script names alone and should be called out in whatever developer-facing note accompanies these scripts.
- **The verification script must not hardcode any key.** Local Supabase's service-role and anon keys are deterministic per-project only until `supabase start` regenerates them; the safe, repo-agnostic way to obtain them is parsing `supabase status -o json` (via `child_process`) at script runtime, not committing them anywhere — even for local-only use.

## Phase 1: Migration — people table with default-deny RLS

### Overview

Creates the first migration in `supabase/migrations/`, establishing the owner-scoped RLS pattern this whole foundation exists to prove, and fixes the starter's leftover project identity in `supabase/config.toml`.

### Changes Required:

#### 1. Project identity cleanup

**File**: `supabase/config.toml`

**Intent**: Replace the inherited starter's `project_id = "10x-astro-starter"` with this project's own identity so local Supabase state (`supabase start`, Studio, local URLs) is labeled correctly.

**Contract**: `project_id = "intouch"`.

#### 2. First migration: `people` table + RLS

**File**: `supabase/migrations/<timestamp>_create_people_table.sql` (generate the timestamp via `supabase migration new create_people_table` rather than hand-picking one)

**Intent**: Create the minimal owner-scoped table the rest of the roadmap's data-owning slices will extend, with RLS enabled and no implicit access — access exists only through the four explicit per-command policies.

**Contract**: A `people` table (`id uuid primary key default gen_random_uuid()`, `owner_id uuid not null references auth.users(id) on delete cascade`, `created_at timestamptz not null default now()`), RLS enabled, and one policy per command. The policy shape is the load-bearing part of this migration:

```sql
alter table public.people enable row level security;

create policy "people_select_own" on public.people
  for select using (auth.uid() = owner_id);

create policy "people_insert_own" on public.people
  for insert with check (auth.uid() = owner_id);

create policy "people_update_own" on public.people
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "people_delete_own" on public.people
  for delete using (auth.uid() = owner_id);
```

### Success Criteria:

#### Automated Verification:

- `supabase start` boots local Postgres cleanly: `supabase start`
- Migration applies without error against the local instance: `supabase db reset` (or `supabase migration up` on an already-running instance)
- Linting passes: `npm run lint`

#### Manual Verification:

- `supabase db reset` output shows the `people` table created and RLS policies listed with no errors.
- Opening local Supabase Studio (`http://127.0.0.1:54323`) shows `public.people` with RLS enabled and 4 policies.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Generated DB types + typed Supabase client

### Overview

Makes the `people` table's schema visible to app code by generating TypeScript types from the local schema and threading them through the app's one Supabase client factory.

### Changes Required:

#### 1. Add `tsx` and a types-generation script

**File**: `package.json`

**Intent**: Add `tsx` as a dev dependency (needed by Phase 3's verification script) and a script that regenerates `src/db/database.types.ts` from the local Supabase schema on demand.

**Contract**: New `devDependencies` entry `"tsx"`, new script `"db:types": "supabase gen types typescript --local > src/db/database.types.ts"`.

#### 2. Generate the types file

**File**: `src/db/database.types.ts` (new)

**Intent**: Commit the output of `npm run db:types` so the Cloudflare Worker build — which has no Supabase CLI or DB access at build time — always has types available without any extra CI setup.

**Contract**: Generated file, not hand-edited; regenerated via `npm run db:types` whenever the schema changes (owner reminder, not enforced by tooling in this change).

#### 3. Thread the `Database` type through the client factory

**File**: `src/lib/supabase.ts`

**Intent**: Make every future table read/write in app code schema-typed by construction, rather than leaving it to each caller to remember.

**Contract**: `createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, { ... })` — same call, now generic over the imported `Database` type from `@/db/database.types`. The function's return type (and therefore every caller's `supabase` variable) picks up the generic automatically; no caller-side changes needed since no caller queries tables yet.

### Success Criteria:

#### Automated Verification:

- Types generate without error: `npm run db:types`
- Type checking passes with the new generic in place: `npx astro check` (or `npm run build`, which runs Astro's type-aware build)
- Linting passes: `npm run lint`

#### Manual Verification:

- `src/db/database.types.ts` contains a `people` table definition with `id`, `owner_id`, `created_at` fields matching Phase 1's migration.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Isolation verification script + production migration

### Overview

Proves the RLS contract holds with a repeatable script, then applies the migration to production — the point where `F-01`'s outcome ("applied locally **and in production**") is actually satisfied.

### Changes Required:

#### 1. Isolation verification script

**File**: `scripts/verify-rls.ts` (new)

**Intent**: Prove, against a local Supabase instance, that a `people` row is visible and writable only to its `owner_id`, using the same auth boundary (`auth.uid()` from a real session JWT) the deployed app relies on — not a synthetic or mocked check.

**Contract**: A Node script run via `tsx`. Sequence: (1) shell out to `supabase status -o json` to obtain the local API URL, anon key, and service-role key; (2) using a service-role client, create two throwaway users (`auth.admin.createUser`, `email_confirm: true`) and sign each in (`auth.signInWithPassword`) to get a session; (3) build two anon-keyed clients, each carrying one user's session, and have each insert one `people` row; (4) assert user A's client sees only its own row via `select`, and that a `select` for user B's row (by id) from user A's client returns zero rows, not an error; (5) repeat the cross-read assertion for update and delete attempts (expect zero rows affected, not a thrown error — RLS filters rather than rejects); (6) assert an unauthenticated (anon, no session) client's `select` also returns zero rows; (7) in a `finally` block, delete both test users via the service-role client (`auth.admin.deleteUser`), which cascade-deletes their `people` rows per Phase 1's FK, confirming the cascade as a side effect. Exit non-zero if any assertion fails.

#### 2. Wire up the script

**File**: `package.json`

**Intent**: Make the check runnable with one command.

**Contract**: New script `"verify:rls": "tsx scripts/verify-rls.ts"`.

### Success Criteria:

#### Automated Verification:

- Verification script passes against local Supabase: `npm run verify:rls` (exits 0)
- Linting passes: `npm run lint`

#### Manual Verification:

- Human links the project (one-time, if not already done): `supabase link --project-ref <project-ref>`
- Human applies the migration to production: `supabase db push`
- Human confirms in the Supabase dashboard (Table Editor + Auth Policies) that the production `people` table exists with RLS enabled and the same 4 policies as local.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful. The production `supabase db push` step is a human-run operation per `CLAUDE.md` — do not attempt to run it as part of automated verification.

---

## Testing Strategy

### Unit Tests:

- None — no test framework is introduced by this change (see Key Decisions in the brief).

### Integration Tests:

- `scripts/verify-rls.ts` is this change's integration test: two real users, real sessions, real RLS-filtered queries against a local Postgres instance.

### Manual Testing Steps:

1. Run `supabase start`, then `supabase db reset` — confirm the `people` table and 4 policies appear with no errors.
2. Run `npm run db:types` — confirm `src/db/database.types.ts` reflects the `people` table.
3. Run `npm run verify:rls` — confirm it exits 0 and its console output shows each assertion (own-row visible, cross-row invisible, unauthenticated invisible, cascade cleanup) passing.
4. Run `supabase link --project-ref <ref>` (if not already linked) and `supabase db push` — confirm in the Supabase dashboard that production now has the same table/policies as local.

## Performance Considerations

None — this change touches no request path; it is schema, types, and an offline verification script.

## Migration Notes

This is the first migration in the repo, so there is no prior schema to migrate from. Every column added is additive (`not null` columns exist from row zero, so no backfill is needed). Future migrations on this table (e.g. `S-01` adding `description`/`weight`) must follow `CLAUDE.md`'s rule: add and default-fill new columns before code depends on them; only drop old columns at least one deploy after nothing reads them.

## References

- Roadmap: `context/foundation/roadmap.md` (`F-01`, lines 83-94)
- PRD guardrail this change makes testable: `context/foundation/prd.md` (`## Non-Functional Requirements`, line 119; `## Access Control`, line 158)
- Rollback/forward-compatibility rule: `CLAUDE.md` (`## Rollback`)
- Existing client factory this change extends: `src/lib/supabase.ts:6`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration — people table with default-deny RLS

#### Automated

- [x] 1.1 `supabase start` boots local Postgres cleanly — c7fd8b5
- [x] 1.2 Migration applies without error against the local instance — c7fd8b5
- [x] 1.3 Linting passes — c7fd8b5

#### Manual

- [x] 1.4 `supabase db reset` output shows the `people` table created and RLS policies listed with no errors — c7fd8b5
- [x] 1.5 Local Supabase Studio shows `public.people` with RLS enabled and 4 policies — c7fd8b5

### Phase 2: Generated DB types + typed Supabase client

#### Automated

- [x] 2.1 Types generate without error (`npm run db:types`) — fe4efb9
- [x] 2.2 Type checking passes with the new generic in place — fe4efb9
- [x] 2.3 Linting passes — fe4efb9

#### Manual

- [x] 2.4 `src/db/database.types.ts` contains a `people` table definition matching Phase 1's migration — fe4efb9

### Phase 3: Isolation verification script + production migration

#### Automated

- [x] 3.1 `npm run verify:rls` passes (exits 0)
- [x] 3.2 Linting passes

#### Manual

- [ ] 3.3 Project linked to production (`supabase link --project-ref <project-ref>`)
- [ ] 3.4 Migration applied to production (`supabase db push`)
- [ ] 3.5 Production dashboard confirmed to match local (table + RLS + 4 policies)
