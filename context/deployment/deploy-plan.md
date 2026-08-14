---
project: intouch
deployed_at: 2026-08-14
platform: cloudflare-workers
production_url: https://intouch.g-ratajczak97.workers.dev
worker_name: intouch
cloudflare_account_id: ced876eb4ff2f20286430f4abd7cca2f
status: deployed
---

# Deploy plan — InTouch on Cloudflare Workers

Audit trail of the first production deployment, executed from
`context/changes/deployment/deployment-plan.md`. This file records what
actually happened, including deviations from that plan discovered during
execution.

## Outcome

Production is live at `https://intouch.g-ratajczak97.workers.dev`, backed by
GitHub Actions CI/CD: PRs upload a preview version (no production impact),
merges to `main` promote to production automatically.

## What's deployed

- **Adapter**: `@astrojs/cloudflare` v13, `imageService: "compile"` (no Images binding, per PRD non-goal on photos)
- **Sessions**: explicit `sessionDrivers.lruCache()` — Astro sessions are unused (auth is Supabase-cookie-based), this stops the adapter from auto-provisioning an unused KV namespace
- **Env validation**: `SUPABASE_URL` / `SUPABASE_KEY` are `optional: false` — missing secrets now throw at Worker cold start instead of rendering a silent "not configured" banner
- **Secrets**: `SUPABASE_URL`, `SUPABASE_KEY` set via `wrangler secret put` (production source of truth), mirrored in GitHub Secrets for CI and `.dev.vars` for local dev
- **CI/CD**: `.github/workflows/ci.yml` (lint/build gate, now actually triggers — was pointed at `master`, branch is `main`) + `.github/workflows/deploy.yml` (`versions upload` on PR, `deploy` on push to `main`)
- **Site URL**: `astro.config.mjs` `site` set to the production URL, unblocking `@astrojs/sitemap`
- **Supabase Auth URL Configuration**: Site URL + redirect URLs (production, `*-intouch.g-ratajczak97.workers.dev` preview pattern, `localhost:4321`) point at the real domain, so signup confirmation emails work

## Deviations from the original plan (found during execution)

1. **`session: false` doesn't exist.** Neither Astro's config nor the Cloudflare adapter's `Options` type has a boolean session toggle. Fix: explicit `session: { driver: sessionDrivers.lruCache() } }` in `astro.config.mjs` — confirmed via `node_modules` inspection, not docs.
2. **Cookie anti-cache header fix had to extend beyond `middleware.ts`.** `signin.ts`, `signup.ts`, and `signout.ts` each create their own Supabase client and return their own `Response` via `context.redirect()` — the middleware's header collector never touches those. Fixed at all four call sites (`src/lib/supabase.ts`, `src/middleware.ts`, and the three `src/pages/api/auth/*.ts` routes).
3. **`wrangler versions upload` + `wrangler triggers deploy` (experimental) left routing broken** — both the preview URL and the base `workers.dev` route returned edge-level `error 1042` before the Worker ever executed. Matches recent Cloudflare community reports for this exact command combination. Fixed by running plain `wrangler deploy` instead.
4. **`wrangler versions secret put` doesn't deploy.** Secrets staged that way sit on an undeployed version; a later plain `wrangler deploy` builds a *different* version that doesn't inherit them. Cloudflare's own docs confirm plain `wrangler secret put` creates a new version **and deploys it immediately** — that's the one that actually reaches production.
5. **Interactive `wrangler secret put` paste didn't take** on the first two attempts (banner stayed even though `wrangler secret list` and `wrangler versions view` both showed the secrets as bound). Root-caused via a direct `/api/auth/signin` test showing "Supabase is not configured" despite bound secrets — narrowed to bad values, not config. Fixed by piping values via `printf | wrangler secret put` (non-interactive stdin) instead of the masked interactive prompt.
6. **Preview URL Access — explicitly skipped.** The plan calls for gating preview URLs behind Cloudflare Access (Workers & Pages → intouch → Domains → "Protect this Worker behind Access", scope "Previews only"). User decided against it after walking through the policy setup. Recorded as an accepted risk, not an oversight: preview URLs remain public. Revisit once real third-party personal data starts appearing in preview deployments.

## Verification performed

- [x] Production responds, no config banner
- [x] Full signup → confirm-email → signin → `/dashboard` tested live by user
- [x] `/nieistniejaca-sciezka` returns a real SSR 404 (Astro's own error page), confirming `not_found_handling: "404-page"` doesn't swallow dynamic routes
- [x] `wrangler deployments list` shows one active version matching `main` HEAD
- [x] PR run confirmed to upload a preview version only ("Deploy to production" step skipped); production version unchanged
- [x] Push-to-main run confirmed to promote automatically
- [x] `wrangler tail` streams live production events
- [x] Rollback drill: rolled back to the prior version, confirmed production served it, rolled forward back to latest
- [x] `wrangler secret list` shows `SUPABASE_URL`, `SUPABASE_KEY`
- [ ] Preview URLs behind Access — skipped by user decision (see deviation 6)

## Explicitly out of scope (unchanged from original plan)

Cron trigger / async AI generation (FR-007/FR-008), Supabase pause keep-alive,
migration to `sb_publishable_*` key format (already using the new format —
not legacy), data model, custom domain, multi-region.
