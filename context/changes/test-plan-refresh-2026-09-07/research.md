---
date: 2026-09-08T10:25:00+02:00
researcher: g.ratajczak97@gmail.com (Claude Code, Opus 5)
git_commit: 177efb649060d067bb739e4d19c9589d964dabb3
branch: main
repository: intouch
topic: "Test-plan refresh — add-person write-path risk, S-10 context reachability, and stale likelihood weighting"
tags: [research, codebase, testing, test-plan, validation, ranking-prompt, hot-spots, posthog]
status: complete
last_updated: 2026-09-08
last_updated_by: g.ratajczak97@gmail.com (Claude Code, Opus 5)
---

# Research: Test-plan refresh (§2/§3 revision)

**Date**: 2026-09-08T10:25:00+02:00
**Researcher**: g.ratajczak97@gmail.com (Claude Code, Opus 5)
**Git Commit**: `177efb649060d067bb739e4d19c9589d964dabb3`
**Branch**: main
**Repository**: intouch

## Research Question

Ground the four proposed findings in `change.md` against the code, so the §2/§3 revision accepts, reframes, or rejects each one on evidence rather than on the concern that raised it. Also verify the "stale likelihood weighting" claim, and supply evidence on the PostHog candidate row without assuming it in.

## Summary

**Three of the four proposed risks do not survive contact with the code, and the fourth is defended more thoroughly than the refresh assumed.** The add-person write path is a single atomic multi-row `INSERT` behind a server-side Zod schema and a full set of database CHECK constraints. What the refresh set out to find is not there.

But the concern that triggered the refresh was not wrong — it was aimed at the wrong failure. Tracing the path turned up **one real, deterministic, user-visible data-loss defect that nobody proposed**: on any server-side rejection the form clears the user's draft *before* the request is sent, so a user who enters five people and hits a constraint violation lands on a blank form with a red banner and everything they typed gone. That is the honest version of "the add-person write path is unprotected," it is reproducible today, and it needs no safeguard added first to be testable.

The "stale likelihood weighting" finding is largely a **measurement artifact**. `src/components/people` leads only when churn is counted as file touches, and this repo's component convention (folder + `types.ts` + `index.ts`, per `lessons.md`) multiplies every component change by roughly three. Counted by distinct commits, `src/pages/api` is still the hottest directory — exactly what §2 already cites. No existing likelihood rating is contradicted.

Separately, and not part of the brief: **§3 Phase 5's quality-gates half has already shipped** through the Module 3 Lesson 3 hooks work (commit `eea8a31`), while §3 still records Phase 5 as `not started`.

| # | Proposed finding | Verdict |
|---|---|---|
| 1 | Partial multi-row write reported as success | **Rejected** — structurally impossible; one atomic statement |
| 2 | S-10 context captured but inert | **Rejected** — all three fields reach the prompt |
| 3 | Rejected write reported as success / inverse causing a duplicate | **Rejected as stated** — the first is unreachable, the second needs a fault-injection seam added first |
| 4 | Client-only bounds, claimed already covered by Risk #6 | **Premise wrong** — server-side validation *and* DB constraints both exist; Risk #6 needs rewording, not deletion |
| — | *(new, unproposed)* Draft loss on any server rejection | **Accept** — deterministic, testable today |
| — | PostHog PII leakage | **Evidence: no surface in code today**; user decides |

## Detailed Findings

### Finding 1 — partial multi-row write: rejected

The form is genuinely multi-row and genuinely submits once. `PersonForm.tsx:112` holds `rows` as an array; `PersonForm.tsx:200-206` is a native `<form method="POST" action="/api/people">`, not a `fetch`, and rows serialize as index-suffixed field names (`name-0`, `name-1`, …) re-derived from `map`'s positional index, so removing a row leaves no gaps.

The endpoint does one insert — `src/pages/api/people.ts:23`:

```ts
const { error } = await supabase.from("people").insert(toRows(parsed.data, user.id));
```

`toRows` (`src/lib/validation/person.ts:140-151`) is a `.map` returning an array. One PostgREST POST, one multi-row `INSERT`, one implicit transaction. **If row 3 of 5 violates a CHECK constraint or RLS, all five roll back** and the route redirects with the error. There is no loop, so there is no interleaving to test.

Worth recording because it closes a whole class: supabase-js does not auto-retry this method — `RETRYABLE_METHODS = ['GET','HEAD','OPTIONS']` (`node_modules/@supabase/postgrest-js/src/types/common/common.ts:30`) — so a retry-induced double insert is not available either.

### Finding 2 — S-10 context inert: rejected

There is exactly one ranking path, and the SELECT cannot omit anything — `src/lib/ranking/run.ts:88-96` uses `select("*")`. All three S-10 columns are then interpolated into the user message in `src/lib/ranking/prompt.ts`:

| Field | In prompt | Line |
|---|---|---|
| `relationship_context` | yes, as `Kontekst:` | `prompt.ts:141-143` |
| `context_tags` | yes, as `Tagi:` | `prompt.ts:144-146` |
| `last_contact_bucket` | yes, conditionally | `prompt.ts:156-159` |

The bucket's guard (`person.last_contact_bucket && !personFacts?.lastHappenedAt`) is deliberate and recent — commit `b9374ca`, the in-flight `ranking-recency-floor` change — sending the user's estimate only until a dated successful contact exists.

**The residual nuance, and why it is not a §2 row.** The fields are in the *user* message, but `buildSystemMessage` (`prompt.ts:55-76`) names only `Historia kontaktu`, `weight`, and *"opis osoby"* as ranking premises — `prompt.ts:60` tells the model to break weight ties "na podstawie kontekstu z ich opisów". So the S-10 fields are transmitted but not *authorized*. That is a prompt-wording question whose only oracle is a judgment about model behaviour; §7 already excludes judging suggestion quality, and a test asserting "the system message mentions `Tagi`" would be an implementation mirror with no independent oracle. **Route it to a product change, not to the risk map.**

### Finding 3 — misreported write outcome: rejected as stated

*Rejected write reported as success* is unreachable. The success redirect (`people.ts:29`) sits past the error guard at `:25`, and supabase-js is used without `throwOnError`, so `PostgrestBuilder.ts:371-372` converts even network and timeout failures into a returned `{ error }`. There is no throw that could bypass the guard, and RLS denial surfaces as PostgREST `42501`, not a silent zero-row 201.

*Success reported as an error, causing a duplicate* has no code path. Nothing after the insert can fail: `people.ts:29-33` is `context.redirect(...)` plus header copying over headers Supabase already produced. No second insert, no revalidation, no analytics call, no trigger on `people` (no `create trigger` in any migration). The outcome is only reachable if the response is lost between the Worker and Supabase after Postgres committed — and asserting that requires *adding* a fault-injection seam first. Per §1 principle and the challenger rule, that is speculative: **note it as a design gap, do not promote it.**

The design gap is real and worth one line in the change that eventually addresses it: `people` carries **no unique constraint at all** (`unique` appears in the migrations only on `rankings`) and there is no idempotency key, so nothing would catch the duplicate if it happened.

### The risk that is actually there — draft loss on any server rejection

Not proposed by anyone; found while tracing. `PersonForm.tsx:196` calls `clearDraftRows()` inside `onSubmit`, on the path that lets the native submit through — that is, **before the browser has issued the POST**, and therefore before any outcome is known. The comment at `:192-195` acknowledges the reason: with a native form post there is no client-side "request succeeded" moment.

The consequence: a DB error or a validation rejection redirects to `/people/new?error=…`; that is a fresh page load; `getInitialRows()` (`PersonForm.tsx:106-109`) calls `loadDraftRows()`, gets `null`, and renders **one empty row**. Enter five people, hit any rejection, and you get a red banner over a blank form.

This is the defensible form of the concern that opened the refresh — silent loss of user-entered work on the person-authoring surface — and it differs from all three proposals in the way that matters: it is deterministic, it needs no new safeguard to be observable, and its oracle is a user-behaviour statement ("the work I typed is still there after a rejection"), not a copy of the implementation.

**One risk, not two.** The refresh asked whether findings 1-3 are one risk or two ("write-path integrity" vs "the write → ranking-input contract"). The question dissolves: the ranking-input contract holds (finding 2), and write-path integrity holds (findings 1 and 3). What survives is a single **write-path recovery** risk about what the user loses when the write is refused. Splitting it would be splitting for symmetry.

### Finding 4 — the premise is wrong; Risk #6 needs rewording

Risk #6's "must challenge" cell reads *"Zod runs on the form, so the data is validated."* The code does not have that bug. There is one validation module (`src/lib/validation/person.ts`) and **both write routes execute it server-side**:

- `POST /api/people` — imported at `people.ts:3`, called at `people.ts:11` (`parseForm`, terminating in `peopleFormSchema.safeParse` at `person.ts:137`)
- `PATCH /api/people/[id]` — imported at `[id].ts:4`, called at `[id].ts:37` (`personUpdateSchema.safeParse`), and the route builds `updates` only from validated keys (`:44-71`), so there is no mass-assignment either.

`people.ts:23` and `[id].ts:72-77` are the only writes to `people` in all of `src/`. There is no unvalidated back door.

Below that, the database independently enforces every bound — `20260830101704_add_profiles_and_people_fields.sql:43-47` (`name` ≤100, `relationship_type` enum, `description` ≤500, `weight between 1 and 10`) and `20260904090009_add_people_context_fields.sql:14-19` (all three S-10 columns). So "a hand-rolled request stores out-of-bounds data" would require **two independent layers to fail at once**.

**Does Phase 4's scope reach the S-10 columns?** Yes — §3 Phase 4's goal is worded generally ("the server enforces the same bounds as the form"), not limited to weight and description; only §2's Source cell names those two. No scope change is needed, but the *justification* changes: Phase 4 is no longer "close a hole", it is "pin a boundary that currently holds and has zero tests" — plus the two genuine gaps below.

**The three real gaps this turned up:**

1. **No cap on rows per request.** `peopleFormSchema` (`person.ts:56`) is `z.array(personSchema).min(1)` with **no `.max()`**, and `parseForm` loops `for (let i = 0; form.has(\`name-${i}\`); i++)` (`person.ts:125`). An attacker-supplied multipart body drives an unbounded loop and an unbounded bulk insert. This is the resource-abuse surface §2 considered and set aside — but the row it set aside was *hammering the ranking trigger*, which costs AI budget and is rate-limited by being one request per run. This one is a single request, needs no repetition, and has no cap anywhere.
2. **Per-tag length is Zod-only.** `context_tags` elements are capped at 30 chars in Zod (`person.ts:50`), but the DB CHECK constrains array *length* only — a 10,000-char tag would pass Postgres. Defense-in-depth gap, not a live hole, given (1) nothing bypasses the route.
3. **No tag de-duplication** anywhere — `["a","a","a","a","a"]` passes both layers.

### Stale likelihood weighting — largely a measurement artifact

Re-ran the scan over `src/`, `scripts/`, `supabase/`: **64 commits in 30 days** (the refresh recorded 61 on 2026-09-07; three have landed since). The file-touch counts reproduce the refresh's numbers — `src/components/people` 35, `src/components/hierarchy` 30, `src/pages/api` 23, `src/components/forms` 21, `src/pages/people` 12, `src/lib/validation` 12.

But file touches are the wrong unit for this repo. `lessons.md` mandates that every React component be a folder of three files (`Component.tsx`, `types.ts`, `index.ts`), so one component change routinely touches three files while a change to `src/lib/validation/person.ts` touches one. Counting distinct commits instead:

| Directory | File touches | Distinct commits |
|---|---|---|
| `src/pages/api` | 23 | **18** |
| `src/lib/validation` | 12 | **12** |
| `src/pages/people` | 12 | **11** |
| `src/components/people` | 35 | **10** |
| `src/components/hierarchy` | 30 | 7 |
| `src/components/forms` | 21 | 6 |
| `src/lib/ranking` | 9 | 6 |
| `src/pages/auth` | 12 | 6 |

The ranking inverts. `src/pages/api` — already cited in §2 for Risks #1 and #5 — remains the hottest area in the repo, and `src/components/people` drops to fourth. **No existing §2 likelihood rating is contradicted by the current scan**, and the refresh's claim that "the person-authoring surface is the hottest area in the repo" does not hold once the counting convention is normalized.

What *does* hold: `src/components/people` (10 commits) and `src/pages/people` (11) are genuine hand-authored churn across five slices — S-01, S-02, S-03, F-05, S-05, S-10 — and appear in **no** §2 Source cell (verified: §2 cites only `src/pages/api`, `src/components/hierarchy`, `src/lib/ranking`, `src/pages/auth`, `src/lib/validation`, `src/components/forms`). They earn a citation on the new write-path row — as ordinary Medium evidence, not as "hottest in the repo".

### PostHog PII candidate — no surface in code today

F-06 is `planning` in the roadmap; nothing is wired. Verified negative across four independent searches: no `posthog`/`analytics`/`capture(` match anywhere under `src/`; no `posthog-js`/`posthog-node` in `package.json` or `package-lock.json`; no `POSTHOG_*` var in `astro.config.mjs`'s env schema (which declares exactly seven vars) or `.env.example`; no `src/lib/analytics/`. Every textual hit is in `context/` planning docs.

**Recommendation — do not promote to §2 yet.** A §2 row today would describe a risk in code that does not exist, which is the speculative shape the challenger pass exists to strip. The constraint is real and already written down where it binds: roadmap F-06's outcome states that no person's name, description, `relationship_context`, tags or email may leave in an event payload. That belongs as an **acceptance criterion inside the F-06 change**, and §2 gains the row when F-06 ships code. Evidence supplied; the call is the user's.

### Existing coverage — what the suite proves about all this

Phase 1's suite (7 files) touches `POST /api/people` at exactly three sites, **all anonymous**: `tests/routes/unauthenticated.test.ts:132-145` (302 to `/auth/signin`), `tests/http/access-boundary.test.ts:52-62` (same over real HTTP), and `tests/http/origin-check.test.ts:38-62` (the route as a vehicle for Astro's origin check).

**No test ever invokes `POST /api/people` with a session.** Nothing asserts a row landing, the `toRows` column mapping, a multi-row submit, the success redirect, the auth-cookie copy-back, or either error branch. On input validation the suite asserts **nothing at all, on any route, at any layer** — no test imports anything under `src/lib/validation/`.

A detail for whoever plans this: the two existing form bodies use flat field names (`{ name, relationshipType, … }`), but `parseForm` reads indexed `name-${i}`. Those bodies parse to an empty array and would fail `.min(1)` — harmless in an auth test where the guard returns first, but it means **no fixture in the repo carries the route's real wire format**, and nobody has driven the parse path. Also, `tests/rls/fixture.ts:199-206` seeds only five columns, so assertions about the four newer person columns need their own fixture data.

The machinery to reuse exists: `setRouteClient` plus the mismatched-connection instrument (`tests/routes/cross-owner.test.ts:64-75`), and `mintExtraSession` for reading state back after a route that signs its client out.

### §3 reconciliation — Phase 5's gates half has already landed

Outside the brief, but it changes §3 and §5. Commit `eea8a31` ("chore(quality-gates): wire per-edit agent hooks and extend the commit gate") shipped two of the layers §3 Phase 5 was meant to deliver:

- **Per-edit** — `.claude/settings.json` `PostToolUse` on `Write|Edit`, three parallel hooks in `.claude/hooks/`: `eslint --cache --fix`, `tsc --noEmit`, and `vitest related` scoped to the Risk #1 surface, each blocking with exit 2.
- **Pre-commit** — `.husky/pre-commit` runs `lint-staged`, `astro check`, and `vitest related` over staged Risk #1 files, excluding `tests/rls/**` because it needs the local stack.

§3 still records Phase 5 as `not started`, and §5 still says the suite gate is "required after §3 Phase 5".

**What has *not* landed is the CI half**: `.github/workflows/ci.yml:26-27` and `deploy.yml:30-31` run `npm run lint` and `npm run build` only — **no `vitest`**. So "suite blocks deploy" remains unwired, and it is the gate that actually protects `main`. Phase 5 should be re-scoped to its two genuinely remaining halves (CI gate, and the S-04 delivery invariants) with the local layers recorded as done.

## Recommendation for the §2/§3 revision

§2 currently holds 7 rows and the constraint is 5-7, so admitting one row requires freeing a slot.

**Add one row** — write-path recovery: *"A rejected add-person submit discards everything the user typed, and a multi-person entry session is lost to a single constraint violation."* Impact Medium, Likelihood Medium. Source: interview 2026-09-07; archive `2026-09-04-add-person-context-fields` (multi-row form kept); hot-spot dirs `src/components/people` (10 commits/30d), `src/pages/people` (11 commits/30d). Response guidance: prove the typed rows survive a server rejection; challenge *"the error banner rendered, so the user can recover"*; research must ground the draft-persistence seam and the redirect-driven remount; cheapest layer is a component-level test over the draft store plus one route test on the rejection branch; anti-pattern to avoid is asserting the banner and never asserting the form's contents.

**Free the slot by consolidating #1 and #5** into one access-boundary row. They are the same failure in two callers ("data reaches someone not entitled to it" — authenticated-but-wrong-owner, and unauthenticated-or-stale-token), they were covered by one rollout phase, they share one test instrument, and Phase 1 has already shipped both. Merging keeps every citation and loses no coverage; splitting them made sense when the phase was being scoped, not now that it is complete.

**Reword #6** rather than dropping it. Its stated failure ("stores out-of-bounds data") is defended twice over, so the row as written is close to speculative. The honest version is the unbounded-row-count gap plus the untested-boundary fact: *"A hand-rolled request drives an unbounded bulk insert, or instruction-shaped free text steers the ranking output."* Its "must challenge" should become *"the boundary is defended, therefore it is proven"* — because that is the actual state: two layers hold, zero tests say so.

**Leave #2, #3, #4, #7 unchanged.** Nothing in this research touches them.

## Code References

- `src/pages/api/people.ts:11` — server-side `parseForm` call; `:23` — the single atomic multi-row insert; `:25` — error guard; `:29-33` — success redirect and cookie copy-back
- `src/pages/api/people/[id].ts:37` — `personUpdateSchema.safeParse`; `:44-71` — validated-keys-only update
- `src/lib/validation/person.ts:42-54` — `personSchema`; `:56` — `peopleFormSchema`, no `.max()`; `:123-138` — `parseForm`'s unbounded loop; `:140-151` — `toRows`
- `src/components/people/PersonForm/PersonForm.tsx:196` — `clearDraftRows()` before the POST; `:106-109` — `getInitialRows` on remount; `:200-206` — native form post
- `src/lib/ranking/run.ts:88-96` — `select("*")` ranking input; `:105` — `buildRankingPrompt`
- `src/lib/ranking/prompt.ts:141-159` — the three S-10 fields in the user message; `:55-76` — system message that does not name them
- `supabase/migrations/20260830101704_add_profiles_and_people_fields.sql:43-47` — weight/description/name/enum CHECKs
- `supabase/migrations/20260904090009_add_people_context_fields.sql:14-19` — the three S-10 CHECKs
- `.husky/pre-commit`, `.claude/hooks/` — the landed local gate layers
- `.github/workflows/ci.yml:26-27` — CI runs lint + build only, no vitest

## Architecture Insights

- **Three-layer input defense is the established pattern**: one Zod module shared by client (UX mirror) and server (authoritative), with DB CHECK constraints underneath. The client/server asymmetry in `PersonEditForm` (validate with the create shape, convert empty optionals to explicit `null`, rely on `.nullable()` server-side) is deliberate and documented at `PersonEditForm.tsx:93-97`.
- **`select("*")` on the ranking input** makes the "field stored but never selected" failure class structurally unreachable. Worth knowing before anyone proposes a test for it.
- **Native form posts, not fetch**, on the person-creation path. That is what makes the draft-clearing defect possible at all — there is no response to react to — and it is why every outcome is a 302 rather than JSON.
- **Directory churn in this repo overstates component areas ~3×** because of the folder+types+barrel convention. Any future hot-spot scan should count distinct commits, or compare component dirs only against other component dirs.

## Historical Context (from prior changes)

- `context/archive/2026-09-04-add-person-context-fields/plan.md:58-63` — the slice's own success criteria state all three new fields reach the ranking prompt; `:80-86` — the bucket deliberately never touches `contact_events`; `:91-93` — the array-length cap rationale. The plan was implemented and impl-reviewed, which is why finding 2 was already answered before this research started.
- `context/archive/2026-09-04-add-person-context-fields/plan.md:104` — "not simplifying `PersonForm` to single-person-only — multi-row add is preserved", the decision the refresh cites.
- `context/changes/ranking-recency-floor/` (`implementing`) — commit `b9374ca` changed the bucket's prompt line from unconditional to conditional. The ranking prompt is under active edit by another session; any Phase 3 planning should re-read it rather than trusting this snapshot.
- `context/changes/testing-runner-and-access-boundary/` — Phase 1, complete; its `research.md` and §6.2/§6.3 carry the instruments this work would reuse.

## Open Questions

- **PostHog row now or at F-06 ship time?** Evidence says no surface exists; the recommendation is to defer, but the refresh explicitly reserved this call for the user.
- **Does the system message need to name `Kontekst` and `Tagi`?** A product/prompt question with no deterministic oracle. Belongs to a change, not to §2 — but somebody should decide it, because the fields are currently sent and not used.
- **Is the unbounded row count worth its own row, or a clause on #6?** Recommended as a clause above, but it is arguably a distinct resource-abuse scenario and the map already declined one of those.
- **Phase 5 re-scope.** The local layers landed outside the rollout. Whether §3 records that as "Phase 5 partially complete" or splits the row into "CI gate" and "scheduled delivery" is a structural call for the revision.
