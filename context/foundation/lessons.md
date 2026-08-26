# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Env vars go through astro:env/server only

- **Context**: Any code in this repo (Astro pages, API routes, middleware, lib) that needs a runtime config value.
- **Problem**: `@astrojs/cloudflare` v13 removed `Astro.locals.runtime` — accessing it throws at runtime ("has been removed in Astro v6"). Reaching for `process.env` also silently fails to reflect Cloudflare bindings/secrets.
- **Rule**: Always import env vars from `astro:env/server` (see `src/lib/supabase.ts`). Never use `Astro.locals.runtime` or `process.env` for config in this project.
- **Applies to**: implement, impl-review

## Cloudflare Workers, never Pages

- **Context**: Any deployment, build script, or CI/CD workflow work on this project.
- **Problem**: `@astrojs/cloudflare` v13 dropped Pages support entirely. A `wrangler pages deploy` command or Pages-shaped assumption will not work with this adapter and wastes a deploy cycle discovering that.
- **Rule**: This project deploys as a Cloudflare Worker, never Pages. `wrangler pages deploy` is forbidden in this repo — use `wrangler deploy` / `wrangler versions upload`.
- **Applies to**: plan, implement, impl-review

## astro dev does not enforce Cloudflare's production limits

- **Context**: Any feature that does non-trivial work per request — especially FR-007 (AI hierarchy generation) and FR-008 (reminders) once they land.
- **Problem**: `astro dev` runs on workerd but does not enforce the free-tier production limits (10ms CPU, 50 subrequests/request). A clean, fast local dev run proves nothing about whether the same code will hit those ceilings in production.
- **Rule**: Before shipping a feature that does meaningful per-request work, check it against Cloudflare's actual production limits — don't treat a fast local `astro dev` run as evidence it'll hold up on the Workers free tier.
- **Applies to**: plan, plan-review, implement

## Verify exact config API in node_modules before trusting a plan's syntax

- **Context**: Any implementation step that follows a written plan's exact code snippet for a third-party library or framework config (adapters, integrations, CLI flags).
- **Problem**: During the Cloudflare deploy, a plan called for `session: false` in `astro.config.mjs` to disable KV auto-provisioning. No such option exists in Astro's `SessionConfig` type or the `@astrojs/cloudflare` `Options` type — the plan's intent was right, the exact syntax was invented. Caught only by reading `node_modules/@astrojs/cloudflare/dist/index.js` and `node_modules/astro/dist/core/session/types.d.ts` directly.
- **Rule**: When a plan specifies exact config syntax for a library, verify the option actually exists in the installed version (check `node_modules` types/source, not just the plan's prose) before applying it — a plan can be right about intent and wrong about API surface.
- **Applies to**: plan-review, implement, impl-review

## ON DELETE CASCADE on owner_id is a per-table decision, not an inherited default

- **Context**: `supabase/migrations/20260824192356_create_people_table.sql` (`owner_id` FK) — any future user-owned table copying the F-01 RLS pattern (`S-01`, `S-02`, `S-03`, `S-05`).
- **Problem**: `owner_id`'s `ON DELETE CASCADE` is correct for `people` and relied on by `scripts/verify-rls.ts`'s cleanup, but because this migration is the template every future table copies, cascade-delete-on-account-removal could get inherited silently without anyone deciding it's right for that table too.
- **Rule**: Before adding `ON DELETE CASCADE` to a new `owner_id` FK, explicitly decide cascade-delete vs. soft-delete/anonymize for that table — don't inherit it from `people` by default.
- **Applies to**: plan, implement
