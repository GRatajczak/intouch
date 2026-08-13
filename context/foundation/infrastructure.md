---
project: InTouch
researched_at: 2026-08-10
recommended_platform: Cloudflare Workers
runner_up: Railway
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (+ React 19)
  runtime: Cloudflare Workers (workerd, nodejs_compat)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare is the only candidate that scores Pass on all five agent-friendly criteria, and it is the only one offering a genuinely free tier (100k requests/day) that comfortably covers the PRD's "medium users / low QPS / small data volume" profile — which matters because cost minimisation was the stated top priority. The repo is already wired for it: `@astrojs/cloudflare@^13.5.0`, `output: "server"`, and a `wrangler.jsonc` declaring `main: "@astrojs/cloudflare/entrypoints/server"` with an `assets` binding and `nodejs_compat`. Every alternative requires swapping the Astro adapter and re-deriving the build. Existing hands-on familiarity with Cloudflare breaks any remaining tie.

The decision is recorded with one important caveat: the *platform* choice is low-risk, but the *documentation* around it has drifted badly. `@astrojs/cloudflare` v13 removed Cloudflare **Pages** support entirely and removed the `Astro.locals.runtime` API — meaning the majority of Astro-on-Cloudflare material an agent will recall from training data is now actively wrong for this project. The risk register below is dominated by that drift, not by platform limitations.

## Platform Comparison

Scored against the five criteria in `references/agent-friendly-criteria.md`. No hard filters fired: the app needs no persistent connections (interview Q1: No), and every candidate can run a TypeScript SSR app. All six were therefore scored, then weighted by the interview answers.

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Score |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **5.0** |
| **Vercel** | Pass | Pass | Pass | Pass | Partial | 4.5 |
| **Netlify** | Pass | Pass | Partial | Pass | Pass | 4.5 |
| **Railway** | Pass | Pass | Partial | Pass | Partial | 4.0 |
| **Fly.io** | Pass | Partial | Pass | Pass | Partial | 4.0 |
| **Render** | Partial | Pass | Partial | Pass | Partial | 3.5 |

**Cloudflare Workers** — Full operational loop from the CLI: `wrangler deploy`, `wrangler versions upload`, `wrangler rollback`, `wrangler secret put`, `wrangler tail`, `wrangler deployments list --json`. Fully managed edge serverless. Docs published as markdown with `llms.txt`, plus literal agent prompt files (`/workers/prompts/pages-to-workers.txt`). Deterministic, versioned deploy model with explicit separation of upload and activation. Three first-party remote MCP servers: docs (`docs.mcp.cloudflare.com/mcp`), Workers Bindings (`bindings.mcp.cloudflare.com/mcp`), and Workers Observability. Free tier: 100k req/day, 10ms CPU/request; Paid is $5/mo for 10M requests and up to 5 min CPU/request.

**Vercel** — Excellent CLI (`vercel --prod`), MDX docs on GitHub, mature Astro adapter. Two disqualifying weights: the Hobby plan explicitly forbids commercial use (Pro is $20/seat/mo), and its serverless functions reproduce the same execution constraints as Workers (10s duration on free, 60s on Pro) while costing more. Vercel MCP exists but is OAuth-backed beta as of 2026 — scored Partial. Requires swapping to `@astrojs/vercel`.

**Netlify** — Strong on agent integration: the official Netlify MCP Server is the most mature of the candidates, and `netlify deploy` is draft-by-default (`--prod` must be passed explicitly), which is a genuinely safer posture for agent-driven operations. Undone by the 2025 credit-based pricing rework: the free plan allocates 300 credits/month and **stops serving traffic** when they are exhausted rather than degrading or auto-recharging. That failure shape is unacceptable for a live MVP under a cost-minimisation constraint. Docs scored Partial — good, but no confirmed agent-readable source distribution. Requires swapping to `@astrojs/netlify`.

**Railway** — Clean CLI, genuinely fast DX, usage-based billing where idle costs almost nothing, and co-located Postgres. Scored Partial on managed-docs and MCP. Penalised on cost by the $5/mo Hobby floor versus Cloudflare's true $0, and its co-location advantage was cancelled by interview Q5 (external providers are fine — Supabase already covers Postgres and auth). Requires swapping to `@astrojs/node` plus a Dockerfile or Nixpacks build. Its real value here is as an escape hatch, not a first choice.

**Fly.io** — `flyctl` is a first-rate agent CLI and docs are MDX on GitHub, but scored Partial on managed-infrastructure because you own the Dockerfile, machine sizing and scaling policy — meaningful operational surface for a solo after-hours build. Decisively penalised on cost: Fly no longer offers a free tier to new organisations (a 2-VM-hour-or-7-day trial with $5 credit), and a minimal always-on machine runs ~$1.94/mo before any database.

**Render** — Has the most honest remaining free tier of the container PaaS group, but free web services spin down after ~15 minutes of inactivity and take roughly a minute to cold-start. For a low-traffic personal app that means most real visits hit a cold start — directly hostile to the product. CLI scored Partial (deploy hooks and API are solid; the CLI is less complete than `wrangler` or `flyctl`).

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on all five criteria plus both weighted constraints. The free tier is a real free tier at this project's scale, not a trial. The versions-and-deployments model gives an agent a deterministic, auditable deploy surface: upload a version, get a preview URL, promote separately. Three first-party MCP servers mean the agent can query live logs and bindings with typed tools rather than parsing CLI output — though CLI alone is sufficient for MVP. Decisively, the repo already builds for this target; choosing anything else means throwing away working configuration on day one of a three-week budget.

#### 2. Railway

The correct escape hatch if Workers' execution model becomes the bottleneck. Swapping to `@astrojs/node` on Railway removes the 10ms CPU ceiling, the 50-subrequest cap, and the account-wide cron budget in a single move, and replaces edge-runtime reasoning with an ordinary long-lived Node process — which is materially simpler for the AI hierarchy generation (FR-007) and the reminder sweep (FR-008). The gap: $5/mo versus $0, a required adapter swap and container build, weaker agent-readable docs, and no first-party MCP. Take this option if hierarchy generation turns out to want minutes rather than seconds of wall time.

#### 3. Vercel

Best-in-class developer experience and the strongest documentation of the group, with a mature Astro adapter. The gap versus the recommendation is that it solves none of the problems that would push you off Cloudflare — it is also serverless, with tighter function duration limits — while introducing a commercial-use restriction on its free tier. It ranks third because it is a lateral move at higher cost, not because the platform is weak.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The recorded deployment target is already wrong.** `context/foundation/tech-stack.md` carries `hints.deployment_target: cloudflare-pages`, but `@astrojs/cloudflare` v13 **removed Cloudflare Pages support entirely**. The repo's own `wrangler.jsonc` is Workers-shaped. An agent trusting the contract file will reach for `wrangler pages deploy ./dist` and either fail outright or produce a broken static-only deployment. Pages and Workers commands are not interchangeable.

2. **`Astro.locals.runtime` was removed in adapter v13.** Nearly every Supabase-on-Cloudflare snippet written in 2024–2025 — i.e. the bulk of what an agent recalls — reads `Astro.locals.runtime.env.SUPABASE_URL`. The correct v13 access path is `import { env } from 'cloudflare:workers'`, or the typed `astro:env` API already declared in `astro.config.mjs`. This is the single most likely confident-and-wrong line an agent writes in this codebase.

3. **The 10ms free-plan CPU limit bites somewhere unexpected.** Time spent waiting on `fetch()` does *not* count toward CPU time, so the AI provider call is not the risk. The risk is `@supabase/ssr` cookie parsing and JWT verification on every authenticated request, plus JSON-serialising a full ranked hierarchy. Failure presents as intermittent error 1102 with no load correlation, and is invisible locally because `astro dev` enforces no CPU cap.

4. **Free-plan subrequest ceiling is 50 external `fetch()` calls per invocation.** A hierarchy generation that queries Supabase per person and issues one AI call per person crosses that at roughly 20 contacts — a count no early manual test will reach, but a realistic user will. Batch the Supabase reads and send one AI request covering all contacts.

5. **Cron Triggers are capped at 5 per *account*, not per Worker**, on the free plan, with a 1-minute minimum interval. FR-008's daily reminder fits in one trigger, but that budget is shared with every other project on the account. The scheduled Worker also inherits the same 10ms CPU limit, so a reminder sweep across all users must be chunked or queued — a single pass will exceed it.

6. **The adapter's new default `imageService: 'cloudflare-binding'` introduces an unwanted production dependency.** v13 changed the default from `'compile'` to `'cloudflare-binding'`, which auto-provisions an `IMAGES` binding and transforms images at runtime — capped at 5,000 unique transformations/month, after which requests **hard-fail with error 9422** rather than degrading. The PRD explicitly lists "no photos" as a non-goal, so this is live surface area the product never asked for.

### Pre-Mortem — How This Could Fail

Six months on, InTouch is a dead project with a Cloudflare bill of $0 and roughly forty hours of lost evenings. The first three weeks went perfectly: the starter deployed, auth worked, the hierarchy rendered. The rot started when an agent, asked to add the reminder sweep, wrote it against `Astro.locals.runtime` from a 2025 blog post. It worked in `astro dev` — workerd-dev does not enforce production limits — and failed only in production, intermittently, as error 1102. Two weekends went to chasing a bug that local reproduction could never surface.

Then the free Supabase project paused after a quiet week; the Worker returned 500s with no alert, because nothing was watching. When work resumed, nobody could remember which of the three copies of `SUPABASE_KEY` — `.dev.vars`, Workers secrets, GitHub Secrets — was authoritative, and `wrangler secret list` only returns names. Meanwhile every merge to `main` had been quietly uploading versions that never became the active deployment, because Workers Builds defaults its build command to `versions upload` rather than `deploy`. Production had been three weeks stale, and the staleness was invisible because the preview URLs always looked correct.

### Unknown Unknowns

- **`astro dev` now runs inside workerd** under adapter v13, so `wrangler dev` is legacy *for this project* — the Cloudflare Vite plugin gives the dev server production-shaped runtime semantics. The fidelity jump is real, and that is precisely the trap: workerd-dev still does not enforce the free plan's 10ms CPU cap or the 50-subrequest ceiling, so a local pass now proves less than it feels like it proves.
- **Preview URLs are produced by `wrangler versions upload`, not `wrangler deploy`** — and `versions upload` is Workers Builds' *default* build command. The `ci_default_flow: auto-deploy-on-merge` assumption recorded in `tech-stack.md` requires the deploy command to be set explicitly, or merges will upload versions indefinitely without ever promoting one.
- **Supabase free projects pause after 7 days of low activity.** An after-hours build with one skipped week returns to a paused database and a Worker throwing 500s. Restore is a single click, but nothing warns the application, and nothing warns you.
- **Workers secrets are write-only.** `wrangler secret list` returns names, never values. Combined with `envField(..., optional: true)` in the existing `astro.config.mjs`, a missing production secret fails at *request* time rather than deploy time — the worst possible moment to discover it. Consider flipping these to required once deployment is stable.
- **Cloudflare publishes agent-ingestible documentation that directly neutralises the version-drift risks above**: a live docs MCP server at `docs.mcp.cloudflare.com/mcp`, and literal prompt files such as `developers.cloudflare.com/workers/prompts/pages-to-workers.txt`. Pointing the agent at these instead of allowing it to recall from training data is the highest-leverage mitigation available for this stack.

## Operational Story

- **Preview deploys**: `npx wrangler versions upload` returns a unique version preview URL of the form `<VERSION_PREFIX>-<WORKER_NAME>.<SUBDOMAIN>.workers.dev`, without touching the active deployment. Set `preview_urls = true` explicitly in `wrangler.jsonc` — wrangler ≥ 4.34.0 defaults it to `false`. Preview URLs are public by default; put Cloudflare Access in front of them before any real user data exists in the environment, since InTouch's previews will render third-party personal data.
- **Secrets**: production secrets live in Workers Secrets, set via `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` (write-only — `wrangler secret list` returns names only). Local development reads `.dev.vars`, which must stay gitignored. CI holds a `CLOUDFLARE_API_TOKEN` in GitHub Secrets, scoped to **Workers Scripts: Edit** on this account only — no DNS, no billing, no zone-wide access. Rotation is manual and human-only: create the replacement token, update the GitHub Secret, then revoke the old one.
- **Rollback**: `npx wrangler deployments list --json` to find the target version, then `npx wrangler rollback <VERSION_ID> --message "<reason>"`. Time to revert is under a minute. Caveat: this rolls back Worker code only. Supabase schema migrations do **not** roll back with it — any migration must be forward-compatible with the previous Worker version, or the rollback restores code that cannot read its own database.
- **Approval**: an agent may run `wrangler versions upload`, `wrangler deployments list`, `wrangler tail`, and read-only MCP queries unattended. A human approves promoting a version to production (`wrangler deploy` / `wrangler versions deploy`), any `wrangler secret put`, and any rollback. Deleting the Worker, deleting the Supabase project, dropping tables, or rotating the primary API token are panel-by-hand operations only — never delegated, even when the agent proposes them.
- **Logs**: `npx wrangler tail --format json` for live streaming, filterable with `--status error` and `--search <term>`. `observability.enabled` is already `true` in `wrangler.jsonc`, so historical logs are queryable through the Workers Observability MCP server, which exposes tools for listing events, computing metrics, and locating specific invocations — the right upgrade once log spelunking becomes repetitive.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Agent uses Pages commands (`wrangler pages deploy`) because `tech-stack.md` says `cloudflare-pages` | Devil's advocate | H | H | Correct `hints.deployment_target` to `cloudflare-workers` in `tech-stack.md` now; add a line to `CLAUDE.md` stating Pages is unsupported by adapter v13 |
| Agent writes `Astro.locals.runtime.env.*`, removed in adapter v13 | Devil's advocate | H | H | Record the correct pattern (`import { env } from 'cloudflare:workers'`) in `context/foundation/lessons.md` via `/10x-lesson`; add `docs.mcp.cloudflare.com/mcp` so the agent reads current docs instead of recalling |
| Merges upload versions that are never promoted (Workers Builds defaults to `versions upload`) | Unknown unknowns | H | M | Set the Workers Builds deploy command explicitly to `npx wrangler deploy`; verify after first merge that `wrangler deployments list` shows the new active deployment |
| Intermittent 1102 errors from exceeding 10ms CPU on `@supabase/ssr` auth + hierarchy serialisation | Devil's advocate | M | H | Keep per-request payloads small; cache the computed hierarchy rather than recomputing per request; upgrade to Workers Paid ($5/mo, 30s CPU) at the first confirmed 1102 |
| Hierarchy generation exceeds the 50-external-subrequest free-plan cap at ~20 contacts | Devil's advocate | M | H | Batch Supabase reads into single queries; issue one AI request covering all contacts rather than one per contact; add an explicit contact-count test at 25+ |
| Supabase free project pauses after 7 days of inactivity, Worker returns 500s silently | Unknown unknowns | M | H | Schedule a lightweight keep-alive query on the existing Cron Trigger; add an uptime check on the deployed URL |
| Runtime image transformations fail with error 9422 past 5,000/month via the new `cloudflare-binding` default | Devil's advocate | L | M | Set `imageService: 'compile'` in the adapter config — the PRD lists "no photos" as a non-goal, so runtime transformation is unneeded surface |
| Account-wide 5-Cron-Trigger cap on free, shared across all projects | Devil's advocate | L | M | Use a single trigger with an internal dispatch switch; chunk the reminder sweep across invocations to stay inside 10ms CPU |
| Rollback restores code incompatible with an already-applied Supabase migration | Research finding | M | H | Forward-compatible migrations only: add columns before use, remove them at least one deploy after last use |
| Secret drift across `.dev.vars`, Workers Secrets, and GitHub Secrets with no reconciliation path | Pre-mortem | M | M | Treat Workers Secrets as the single source of truth for production; document the three locations in `CLAUDE.md`; consider making `envField` entries required once deployment stabilises |
| Preview URLs expose real third-party personal data publicly | Research finding | L | H | Enable Cloudflare Access on `*.workers.dev` preview URLs before seeding any non-synthetic data |

## Getting Started

These commands are validated against the versions pinned in this repo — `astro@^6.3.1`, `@astrojs/cloudflare@^13.5.0`, `wrangler@^4.90.0` — not against general platform documentation. Pages-era and `Astro.locals.runtime`-era instructions do not apply.

1. **Fix the stale contract first.** Update `context/foundation/tech-stack.md` to `deployment_target: cloudflare-workers`. Leaving it as `cloudflare-pages` will mislead every future agent session.

2. **Set the project name.** Both `package.json` (`"name": "10x-astro-starter"`) and `wrangler.jsonc` (`"name": "10x-astro-starter"`) still carry the starter's name. Change the `wrangler.jsonc` name to `intouch` — it determines the deployed Worker's name and its `*.workers.dev` subdomain.

3. **Neutralise the image-service default.** Add `imageService: 'compile'` to the `cloudflare()` adapter options in `astro.config.mjs`. The PRD stores no images; this removes a runtime binding and its 5,000/month failure cliff.

4. **Authenticate and set secrets** (human step — do not delegate):
   ```bash
   npx wrangler login
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```
   For local development, put the same values in a gitignored `.dev.vars`.

5. **Verify locally, then upload a preview before deploying:**
   ```bash
   npm run dev                  # astro dev — now runs inside workerd, no wrangler dev needed
   npm run build
   npx wrangler versions upload # returns a preview URL; does not touch production
   ```
   Exercise the preview URL, then promote deliberately:
   ```bash
   npx wrangler deploy
   npx wrangler deployments list --json   # confirm the new version is Active
   ```

6. **Confirm observability works** before you need it: `npx wrangler tail --format json`, hit the deployed URL, and check that events arrive.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions workflow authoring — though the Workers Builds default-command trap above is recorded as a risk)
- Production-scale architecture (multi-region, HA, DR)
