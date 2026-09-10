---
date: 2026-09-09T12:05:00+02:00
researcher: g.ratajczak97@gmail.com (Claude Code, Opus 5)
git_commit: 0d1acd0a0fa4b4243d3cf9bd4f2680f38a1d6bd2
branch: main
repository: intouch
topic: "Bring-your-own OpenAI key + a free-tier daily cap on manual recomputes"
tags: [research, codebase, openai, secrets, encryption, rate-limit, settings, erasure, rls]
status: complete
last_updated: 2026-09-09
last_updated_by: g.ratajczak97@gmail.com (Claude Code, Opus 5)
---

# Research: Bring-your-own OpenAI key + a free-tier daily cap on manual recomputes

**Date**: 2026-09-09T12:05:00+02:00
**Researcher**: g.ratajczak97@gmail.com (Claude Code, Opus 5)
**Git Commit**: `0d1acd0a0fa4b4243d3cf9bd4f2680f38a1d6bd2`
**Branch**: main
**Repository**: intouch

## Research Question

A user supplies their own OpenAI API key and gets unlimited AI use; a user without one can
run the manual recompute once per calendar day. What does this repo already constrain about
where such a key is stored, how it reaches the model call, where the counter lives, and what
the change must not break?

Decisions already taken at change-open time (`change.md:12-18`): AES-GCM ciphertext in a
column on `profiles` with the encryption key as a new Worker secret; UI shows a mask only;
the daily counter covers **only** the manual `force: true` recompute, leaving the 24 h
auto-refresh free; the cron sweep uses the owner's key when present and otherwise falls back
to the app key without touching the counter.

## Summary

Six findings drive the plan.

1. **The key threads through exactly two call sites.** `createOpenAIClient()`
   (`src/lib/openai.ts:4`) takes no arguments and reads a module-level
   `OPENAI_API_KEY`. Its only callers are `runRanking` (`src/lib/ranking/run.ts:138`) and
   `runPing` (`src/pages/api/internal/ai-ping.ts:23`). Widening it to accept an optional
   per-owner key is a small, contained edit; the work is in the two dispatchers that must
   *load* that key first — the request route (`src/pages/api/rankings.ts:69`) and the cron
   sweep's injected `refreshRanking` (`src/lib/reminders/run-sweep.ts:44`).

2. **`profiles` is the only storage location where erasure is already honoured.**
   `POST /api/settings/delete-data` is a hand-written list of three deletes
   (`people`, `rankings`, `profiles`) with no registry behind it
   (`src/pages/api/settings/delete-data.ts:27,32,37`). A ciphertext column on `profiles`
   is erased for free. Any new owner-scoped table would silently inherit the hole
   `reminder_sends` already sits in: it is owner-scoped, cascades only from `auth.users`,
   and "delete my data" never deletes the auth user, so its rows survive a full wipe.

3. **KV cannot host the counter, and the repo already wrote down why.** The in-flight
   guard's own comment states "KV has no compare-and-swap" and names the two primitives
   that would close it (`src/pages/api/rankings.ts:50-56`). Reads are stale for up to 60 s
   (`scripts/verify-openai-call.ts:20-24`), which means the counter fails **open** — a
   missing key reads as "you have not used your free run". The precedent that accepted
   KV's weakness accepted it because the worst case was one duplicate OpenAI call; for a
   quota, duplicate spend *is* the harm being prevented.

4. **Postgres gives atomicity for free and already owns the app's notion of "a day".**
   `APP_TIME_ZONE = "Europe/Warsaw"` (`src/lib/dates.ts:14`) is the single day boundary, and
   `reminder_candidates` already does calendar-day arithmetic in SQL for the same reason
   (`supabase/migrations/20260908090338_create_reminder_sends.sql:155-167`). A guarded
   `update … where … returning` on a `date` column, or an `insert … on conflict do nothing`,
   is a real compare-and-swap.

5. **This is the repo's first cryptographic use of a secret.** No `crypto.subtle`, no
   pgcrypto, no encryption helper exists anywhere. Nothing in `context/**` has ever
   discussed encrypting anything or storing a user-submitted credential. Key rotation over
   existing ciphertext, and what happens when a ciphertext column outlives the code that can
   read it after a `wrangler rollback`, are genuinely new questions here.

6. **The two error paths the roadmap demands are typed in the installed SDK.**
   `openai@7.8.0` exports `AuthenticationError` (401) and `RateLimitError` (429) as distinct
   classes (`node_modules/openai/core/error.d.ts:35,46`), and `client.models.list()` exists
   for a cheap validation call on save. The roadmap's parked entry names "revocation, and a
   real error path for the day someone's key hits its quota" as obligations, so these are
   requirements, not niceties.

## Detailed Findings

### The OpenAI call path

`src/lib/openai.ts` is seven lines: a module-level `import { OPENAI_API_KEY } from "astro:env/server"` (`:2`), a null return when absent (`:5-7`), and `new OpenAI({ apiKey: OPENAI_API_KEY })` (`:8`). Astro's env plugin inlines that value at transform time, so it is a process-wide singleton with no per-request parameterisation.

Signatures that would need to carry a per-owner key:

- `createOpenAIClient()` — `src/lib/openai.ts:4`, zero parameters.
- `runRanking(ownerId, supabase, jobId)` — `src/lib/ranking/run.ts:131-135`. Has the owner and a client already, so it can load the key itself, or receive it.
- `runPing(jobId)` — `src/pages/api/internal/ai-ping.ts:20`. Has no owner in scope at all, even though the route above it does (`:45`). This is an internal diagnostic route; leaving it on the app key is defensible and should be stated rather than assumed.
- `SweepDeps.refreshRanking: (ownerId: string) => Promise<"done" | "failed">` — `src/lib/reminders/sweep.ts:28`. This is the injection seam the cron path goes through, and the reason the sweep can adopt per-owner keys without touching `sweep.ts`'s decision logic: only the wiring in `run-sweep.ts:44` changes.

The sweep's client is the service-role admin client (`src/lib/reminders/run-sweep.ts:19`), not a session client. Reading an owner's ciphertext there is possible, but `eslint.config.js:104-115` confines `@/lib/supabase-admin` imports to `src/lib/reminders/**`, so the decrypt helper must not import it — it takes a client as an argument.

`RANKING_MODEL = "gpt-5.4-mini"` (`src/lib/ranking/run.ts:16`) stays the same regardless of whose key pays for it.

### Where a user's key can live

`public.profiles` has `owner_id uuid primary key` (`supabase/migrations/20260830101704_add_profiles_and_people_fields.sql:8`) and already carries the two per-owner flags this change's UI sits beside. Adding a column follows `20260908121419_add_profiles_analytics_opt_out.sql` verbatim: additive DDL with a default, a `comment on column`, a header paragraph citing CLAUDE.md §Rollback for forward-compatibility, and an explicit note that no RLS or GRANT change is needed because policies are row-level and the table-level grant from `20260830101704:39-40` covers new columns.

The erasure consequence is the decisive one. `tests/routes/erasure.test.ts` exists specifically to catch "a fifth person-referencing table with no decision at all", and `tests/routes/delete-data.test.ts` states it asserts access, not completeness. A column on `profiles` needs neither file changed. A new table needs: a fourth delete in `delete-data.ts`, the `TableName` union in `tests/rls/fixture.ts:15`, a `seedOwner` row, and new assertions.

One caveat inherited from `S-05`: `context/archive/2026-09-04-person-lifecycle-and-erasure/plan-brief.md` decided against any deletion audit trail, on the grounds that a record that something existed and was deleted is itself residual data. A "key removed at …" timestamp would contradict that stance.

### Where the daily counter can live

| | KV counter | `profiles` column | New claims table |
|---|---|---|---|
| Atomic | No — no compare-and-swap | Yes, guarded `update … returning` | Yes, unique index |
| Read consistency | Up to 60 s stale, fails open | Read-your-writes | Read-your-writes |
| Day boundary | Hand-rolled in the Worker, plus a DST-aware TTL | Native Europe/Warsaw date arithmetic | Same, as a `date` column |
| Erased by delete-data | No, outside the contract | Yes, free | No, needs a fourth delete |
| New RLS surface | None, and that is the problem | None needed | 4 policies + grants + indexes |
| Audit trail | None | None, single overwritten value | Full history |

The `profiles` column wins on every axis this change cares about, and it puts the key and its counter in one row, so there is no cross-store drift between "has a key" and "has used the free run".

`reminder_sends` is the precedent for the *shape* of a once-per-day rule, but it enforces nothing at the schema level — the once-daily cron is its only serializer. A request-driven endpoint has no such serializer, so the guarded update is doing real work here, not decoration.

### The day boundary

`src/lib/dates.ts:1-14` states the rule and the reason: the Worker runs UTC, the browser runs in the viewer's zone, and a contact 23 hours old once read as "0 dni" in the prompt and "wczoraj" on the chip. The zone is a named constant because the product is Polish-only and `profiles` has no timezone column. The SQL side mirrors it deliberately (`20260908090338:155-167`), with a comment explaining that date subtraction has no wobble while an elapsed interval makes the boundary depend on cron jitter.

Note the two clocks are independent and must stay so: `STALE_AFTER_MS` (`src/lib/ranking/store.ts:7`) is a rolling 24 h window driving the free auto-refresh, while the new counter is a calendar day. The change deliberately leaves the first alone.

### Encryption, with no prior art

No `crypto.subtle`, `importKey`, `AES-GCM`, `node:crypto`, pgcrypto or pgsodium anywhere in `src/`, `tests/`, `scripts/` or `supabase/`. The only crypto in application code is `crypto.randomUUID()`. Cloudflare's `SubtleCrypto` types are present in `worker-configuration.d.ts` as ambient runtime declarations only.

What binds the new secret:

- Config values come from `astro:env/server`, bindings from `cloudflare:workers` (`context/foundation/lessons.md:65`). An encryption key is a config value.
- The optional-secret shape is the house pattern: every AI/infra secret is `optional: true` so a missing one fails one feature rather than the whole Worker (`astro.config.mjs:36-40`, mirrored by `src/lib/{resend,supabase-admin,analytics/config}.ts`).
- `src/lib/analytics/config.ts:31-36` records the precedent for *not* registering an infra secret in `src/lib/config-status.ts`, because that file renders a Polish banner to end users on every page (`src/layouts/Layout.astro:62`). An encryption-key gap is an ops problem, not a user-facing one.
- Adding a secret touches four CI locations: `.github/workflows/ci.yml:23,34` and `.github/workflows/deploy.yml:27,38`, plus `astro.config.mjs`, `.env.example`, `.dev.vars`, Workers Secrets and GitHub Secrets. `wrangler secret put` is a human step per CLAUDE.md §Sekrety, and `context/deployment/deploy-plan.md:39-40` records that interactive paste silently took a bad value twice — use `printf | wrangler secret put`.

Three questions with no precedent in this repo: how the encryption key rotates over existing ciphertext; what the code does when decryption fails (wrong key, corrupt value); and what a `wrangler rollback` means for a ciphertext column whose reader is gone. The forward-compat rule makes the column itself safe — additive, unread by old code — but the behaviour on a failed decrypt is a live design decision.

### The settings section, and the missing mask pattern

`RemindersSection` and `AnalyticsSection` are literal twins, and `AnalyticsSection`'s header comment says so — copying the previous section verbatim is the accepted pattern here. The route conventions are strict and asserted by tests: auth guard before any client work, JSON body in try/catch, Zod `safeParse` with the first issue message, the ordinary cookie-bound client (never `supabase-admin`), an explicit `.eq("owner_id", …)` even though RLS covers it, and `.select().maybeSingle()` because PostgREST reports a zero-row UPDATE as `error: null`.

Two gaps this change has to fill rather than copy:

- **No masked-secret display exists anywhere.** The only secret-hiding UI is `type="password"` plus `PasswordToggle`, which hides a value being typed and never renders a stored one back.
- **The input to copy is `src/components/auth/FormField.tsx`, not `TextField`,** because it is the only one with an `endContent` slot. Note that neither sets `aria-invalid`, `aria-describedby` or `autoComplete`; the only wiring is `htmlFor`/`id`. A credential field wants `autoComplete="off"` at minimum.

`DeleteDataSection` is the model for a destructive confirm, including the trap it documents: the confirm button is a plain `Button`, not `AlertDialogAction`, because Radix's Action closes the dialog unconditionally and would dismiss the confirmation on a failed request. Removing a stored key is the same shape.

### What the tests must do

Required gates today are lint, typecheck, build, `astro check`, and a human look at any visible UI change. The suite does not block deploys until F-07 Phase 5. But any file under `src/pages/api/` is inside the Risk #1 surface, which fires `vitest related` at edit time and again at pre-commit — so a new settings route and a changed rankings route pull tests in automatically.

Binding rules from the test plan's cookbook: the anonymous / wrong-owner / own triad plus a working control; assert that "absent" and "not yours" are byte-identical in status *and* body; never run a cross-owner test under the attacker's own session; verify cross-owner tests by deleting the owner filter and watching them go red; and never assert on a vendor-authored error string — inject the failure and assert which branch we took.

Two gaps worth flagging into the plan. There is **no sanctioned pattern yet for stubbing OpenAI** — that is Phase 3, not started, and §6.5 of the test plan is literally `TBD`. The stated rule is "stub at the network edge only; never mock internal modules", which points at the SDK's `fetch` client option rather than a `vi.mock` of `@/lib/openai`, even though every existing route test uses the `vi.mock` + `route-client` pattern for Supabase. Also, `POST /api/settings/analytics` has no test at all, so the twin this change copies is itself untested.

The KV stub ignores TTL on purpose (`tests/stubs/cloudflare-workers.ts:11-12`), which is a further argument against a KV counter: its daily reset would be structurally untestable.

## Code References

- `src/lib/openai.ts:4-8` — the singleton client factory to widen
- `src/lib/ranking/run.ts:131-140` — `runRanking` and its "OPENAI_API_KEY is not configured" throw
- `src/pages/api/rankings.ts:31-39` — where `force` is parsed; the gate belongs here
- `src/pages/api/rankings.ts:46-63` — the in-flight guard and its written-down KV race
- `src/lib/reminders/sweep.ts:28` — the `refreshRanking` injection seam
- `src/lib/reminders/run-sweep.ts:44` — where the cron path would load the owner's key
- `src/pages/api/settings/delete-data.ts:27-37` — the erasure list, hand-written, no registry
- `src/pages/api/settings/reminders.ts:25-71` — the route template to copy
- `src/components/settings/AnalyticsSection/AnalyticsSection.tsx` — the twin-copy precedent
- `src/components/auth/FormField.tsx:53` — the `endContent` slot a masked field needs
- `src/components/settings/PasswordChangeForm/PasswordChangeForm.tsx:82-101` — show/hide precedent
- `src/lib/dates.ts:14` — `APP_TIME_ZONE`, the single notion of a day
- `src/lib/ranking/store.ts:7` — `STALE_AFTER_MS`, the other clock, deliberately untouched
- `supabase/migrations/20260908121419_add_profiles_analytics_opt_out.sql` — the column-migration template
- `supabase/migrations/20260908090338_create_reminder_sends.sql:155-167` — calendar-day SQL
- `astro.config.mjs:36-40` — the optional-secret shape
- `eslint.config.js:104-115` — the `supabase-admin` import restriction
- `node_modules/openai/core/error.d.ts:35,46` — `AuthenticationError`, `RateLimitError`

## Architecture Insights

- **Null-returning factories are the house style for missing config.** `openai.ts`, `resend.ts`, `supabase-admin.ts` and `analytics/config.ts` all return null rather than throwing, so a missing secret fails one feature. A missing encryption secret should degrade the same way: fall back to the app key and the free tier, never break the Worker.
- **Owner scope lives in the query, not only in the policy.** `src/lib/supabase-admin.ts:27-33` states it outright, and every route carries a redundant `.eq("owner_id", …)`. The new route and the claim update both inherit this.
- **Comments carry the decisions.** Migrations cite the migration they mirror; routes explain why `.maybeSingle()` is there; the in-flight guard documents its own residual race. A plan that ships silent code here would be the outlier.
- **One notion of a day, one canonical domain.** Both `dates.ts` and CLAUDE.md's `site` rule exist because a duplicated value drifted once already.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:430` — the parked BYOK entry names four obligations: encryption at rest, rotation, revocation, and a real error path for an exhausted quota. It also pins the landing place at `/settings` and gives the unpark trigger: "if AI cost per user becomes the thing limiting who can be invited".
- `context/foundation/prd.md` FR-001 — mandatory login is justified partly by "control of AI costs (no anonymous/free-for-all usage)". BYOK inverts the mechanism without touching the requirement; the parenthetical rationale becomes stale and the PRD's convention for that is an inline dated `> Amended …` note, as used twice on FR-002.
- `context/archive/2026-08-26-openai-ranking-call-path/plan.md:55,166` — F-02 chose `optional: true` for the key and recorded that `wrangler secret put` is a human step, not an agent step.
- `context/archive/2026-09-04-account-and-profile-settings/change.md:31-36` — "delete my data", not "delete my account": the auth user survives, which is exactly why an owner-scoped table outside `profiles` would leak.
- `context/archive/2026-09-04-person-lifecycle-and-erasure/plan-brief.md` — no deletion audit trail, deliberately.
- `context/foundation/github-issues-roadmap.md` — `S-12` … `S-16` are already reserved in the tracker for parked items, so a new slice takes **S-17** even though the roadmap tables stop at `S-11`.
- `context/foundation/lessons.md` — the roadmap-to-Linear mirroring rule applies: a status flip here must reach the Linear issue in the same run.

## Open Questions

1. **Decrypt failure behaviour.** Wrong encryption secret, rotated secret, or corrupt ciphertext. Fall back to the app key and the free tier, or surface a "re-enter your key" state in settings? The first keeps the app working; the second is honest about a key the user believes is stored.
2. **Encryption-key rotation.** There is no re-encryption path and no versioning scheme. Does the ciphertext carry a key-version prefix from day one, or is rotation explicitly out of scope with the consequence written down?
3. **Validation on save.** `models.list()` proves the key works at save time but not later. A key revoked next week fails inside a background job the user is not watching. Does a failed background run mark the stored key as broken so the settings page can say so?
4. **`ai-ping` stays on the app key?** It is an internal diagnostic route with no owner in scope. Probably yes, but it should be stated.
5. **Stubbing OpenAI in tests.** The test plan's "stub at the network edge" rule points at the SDK's `fetch` option; every existing route test uses `vi.mock`. This change would set the precedent Phase 3 was going to set.
6. **Does the free tier's cap need an analytics event?** The event catalog is a typed allow-list and forbids any property that could describe a third party. A `free_limit_reached` event would be clean, but F-06's funnel has five events by design.
