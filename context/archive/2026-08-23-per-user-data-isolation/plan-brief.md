# Per-User Data Isolation — Plan Brief

> Full plan: `context/changes/per-user-data-isolation/plan.md`

## What & Why

This is `F-01` on the roadmap — the foundation every data-owning slice (`S-01` through `S-05`) depends on. It proves, once, that a user-owned table can be RLS-protected with a default-deny policy and an owner-scoped exception, before three slices have already written rows against an unprotected schema. The PRD's binary privacy guardrail — a close one's data must never leak to another user — stays an aspiration until this exists.

## Starting Point

`supabase/` today holds only a starter-default `config.toml`; there are no migrations, no RLS, no generated types, and no test runner in the repo. A Supabase project already exists and is reachable (`SUPABASE_URL`/`SUPABASE_KEY` are live in `.dev.vars` and GitHub Secrets) — auth (signup/signin/signout) already works against it, but nothing in the schema has ever been touched.

## Desired End State

`supabase/migrations/` has one migration creating a `people` table with RLS enabled and four owner-scoped policies (one per command), applied both locally and in production. `src/db/database.types.ts` is committed and threaded through `src/lib/supabase.ts`'s client factory, so table access anywhere in the app is schema-typed. `npm run verify:rls` is a standing, repeatable command that proves user B cannot see, edit, or delete user A's rows — and that an unauthenticated caller sees nothing at all.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Which table proves the pattern | `people`, not `profiles` | It's the table the NFR is actually about (third-party data), and its 1:many owner_id FK is the harder, representative case. |
| Table shape | Bare minimum (`id`, `owner_id`, `created_at`) | Keeps this change about the isolation contract; `S-01` adds domain columns once FR-003's fields are pinned. |
| RLS policy structure | One policy per command | Matches Supabase convention; lets `S-05` later tighten delete's rule without touching the others. |
| `owner_id` FK on user deletion | `ON DELETE CASCADE` | Guarantees no orphaned rows can exist without an owner — enforced by Postgres, not app code. |
| Isolation-check tooling | Standalone `tsx` script, no test framework | Zero new dependencies for a one-shot repeatable check; a real test runner can be introduced later if `S-01`+ wants one. |
| CI wiring for the check | On-demand only, not in `ci.yml` | Avoids giving CI a live dependency on spinning up local Supabase inside this capped foundation. |
| Migration delivery to production | Manual `supabase db push`, human-run | Matches this repo's existing posture that production-touching operations are human-only. |
| DB types | Committed file, generated via `npm run db:types --local` | The Worker build has no Supabase CLI/DB access; types must exist before build without any extra CI setup. |

## Scope

**In scope:**
- First Supabase migration: `people` table, RLS, 4 per-command policies
- `supabase/config.toml` project identity fix (leftover starter default)
- Generated `Database` types, committed and wired into `src/lib/supabase.ts`
- `scripts/verify-rls.ts` + `npm run verify:rls`
- Manual, human-run application of the migration to production

**Out of scope:**
- `profiles` table and any FR-003 domain columns on `people` (both `S-01`)
- Wiring the isolation check into CI
- Automated production migration application in `deploy.yml`
- Any API route or UI (nothing here is reachable from a browser)
- `S-05`'s deactivate/delete flows beyond the FK cascade already established

## Architecture / Approach

One migration establishes the RLS pattern (default-deny + per-command owner-scoped policies); one script proves it holds by exercising the same auth boundary the real app uses — two throwaway users with real sessions, real RLS-filtered queries, against a local Supabase instance. No new secret is introduced: the script derives local service-role/anon keys at runtime from `supabase status -o json`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Migration — people table with default-deny RLS | Schema + RLS policies applied locally | Getting the per-command policy predicates wrong is the one place a mistake defeats the whole point of this foundation |
| 2. Generated DB types + typed Supabase client | `Database` type committed and threaded through the client factory | Someone forgets to regenerate types after a future schema change — no drift detection exists |
| 3. Isolation verification script + production migration | `verify:rls` passing + migration live in production | Production apply is a manual step outside git push — easy to forget after a migration is merged |

**Prerequisites:** Docker running locally (Supabase CLI's local stack depends on it); Supabase CLI already in `devDependencies`.
**Estimated effort:** ~1 session across 3 phases — this is deliberately the smallest slice that proves the pattern, not a domain model.

## Open Risks & Assumptions

- Assumes Docker is available in the implementer's environment for `supabase start` — not verified as part of this plan.
- The production `supabase db push` step depends on a human running it; nothing in this plan enforces that it actually happens after merge.
- No CI regression protection for RLS today — a future migration could silently weaken a policy and nothing would catch it until someone runs `verify:rls` by hand.

## Success Criteria (Summary)

- `npm run verify:rls` passes locally, proving cross-user reads/writes are blocked and unauthenticated access sees nothing.
- The same migration is live in the production Supabase project, confirmed via the dashboard.
- Any future table read/write in app code is schema-typed against `src/db/database.types.ts`.
