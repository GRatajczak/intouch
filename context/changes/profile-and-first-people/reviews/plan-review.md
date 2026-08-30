<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Self-Profile and First People (S-01)

- **Plan**: `context/changes/profile-and-first-people/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-29
- **Verdict**: REVISE → **SOUND for the criticals** after the 2026-08-30 triage pass
- **Findings**: 3 critical, 2 warnings, 2 observations
- **Triage status**: F1, F2, F3, F4, F5 FIXED (2026-08-30). F6, F7, F8 still PENDING — all three are
  OBSERVATION-level and none blocks implementation.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | FAIL |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

Two FAIL dimensions would normally read RETHINK, but all three criticals are localized
contract omissions — no phase ordering or approach change needed. REVISE is the honest call.

## Grounding

- Paths: 9/9 ✓ (`src/middleware.ts`, `src/pages/dashboard.astro`, `src/db/database.types.ts`,
  `scripts/verify-rls.ts`, `src/components/auth/FormField.tsx`, `src/components/auth/SignUpForm.tsx`,
  `src/pages/api/auth/signup.ts`, `src/lib/supabase.ts`,
  `supabase/migrations/20260824192356_create_people_table.sql`)
- Symbols: 5/6 ✓ — `PROTECTED_ROUTES`, `from("people")`, `Tables<>`, `db:types`, `verify:rls` all
  present; `zod` **not** declared in `package.json` (see F5)
- Blast radius: `scripts/verify-rls.ts` is the only `from("people")` consumer — plan covers it ✓
- Progress↔Phase: exactly one `## Progress`, 4/4 phases matched, 30/30 success criteria numbered,
  no stray checkboxes in phase bodies ✓
- brief↔plan: phases, decisions, and scope consistent ✓

## Findings

### F1 — /people never gets an auth boundary

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §6 (middleware) vs. Phase 3 §5
- **Detail**: Phase 2 §6's Intent says "/people* requires auth and a completed profile", but its
  Contract only adds `"/profile"` to `PROTECTED_ROUTES`, and explicitly makes the gate fire "only
  when `context.locals.user` is set". `src/middleware.ts:4` today is `["/dashboard"]` — nothing adds
  `"/people"`. Phase 3 §5 then asserts auth is "already covered by `PROTECTED_ROUTES`", which is
  false. Consequence: an anonymous GET `/people` falls through to `people/index.astro`, which does
  `.eq("owner_id", user.id)` on a null user → 500, not a redirect. Same for POST `/api/people` and
  `/api/profile`: neither starts with a protected prefix and neither contract specifies a null-user
  guard. RLS still blocks the data (anon role sees zero rows), so this is a broken-page bug, not a
  leak.
- **Fix**: `PROTECTED_ROUTES = ["/dashboard", "/profile", "/people"]`, and add an explicit
  `if (!context.locals.user) return context.redirect("/auth/signin")` at the top of both new API
  routes.
- **Decision**: FIXED (2026-08-30) — Phase 2 §6 now sets
  `PROTECTED_ROUTES = ["/dashboard", "/profile", "/people"]` and spells out why the gate alone is not
  an auth check; a new "Auth on the new API routes" note in Critical Implementation Details requires
  the null-user guard, and Phase 2 §4 / Phase 3 §4 make it step 1 of each route contract. Phase 3 §5's
  false "already covered" claim rewritten. New criterion 2.8 verifies the signed-out path.

### F2 — One Zod schema can't serve FormData, React state, and the DB rows

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Critical Implementation Details; Phase 2 §1/§4/§5; Phase 3 §1/§4
- **Detail**: "The Astro API route imports the identical schema and treats its result as
  authoritative" doesn't hold across three boundaries the plan never names:
  1. **FormData is all strings.** `weight` (integer 1–10) and `isCollective` (boolean) arrive as
     `"7"` and `"true"`; `z.number()` / `z.boolean()` reject both. The client holds real
     number/boolean state, so the *same* schema succeeds client-side and fails server-side on every
     valid submission.
  2. **Key casing.** Schema keys are camelCase (`ageRange`, `lifeContext`, `lifeContextDetail`,
     `relationshipType`, `isCollective`); columns are snake_case. `upsert({ owner_id: user.id,
     ...fields })` and `insert({ owner_id: user.id, ...fields })` — written literally in both route
     contracts — target columns that don't exist.
  3. **Prefill direction.** Phase 2 §5 passes the fetched `profiles` row straight in as
     `initialValues`, but the row is snake_case and the prop is camelCase.

  Mitigating: `createServerClient<Database>` in `src/lib/supabase.ts` is typed, so #2 fails at
  `astro check` (2.1 / 3.1) rather than in production. It still leaves the implementer inventing the
  mapping.
- **Fix A ⭐ Recommended**: Each validation module owns the whole boundary
  - Strength: One file per entity holds the schema plus a `parseForm(FormData)` (`z.coerce.number` /
    `preprocess` for the two non-string fields) and a `toRow()` snake_case mapper — so "single source
    of truth" becomes true rather than aspirational, and the API route stays as thin as `signup.ts`.
  - Tradeoff: ~20 extra lines per schema file; the client imports the object schema while the server
    imports `parseForm`, so they're adjacent rather than literally identical.
  - Confidence: HIGH — verified against the generated `TablesInsert` types in
    `src/db/database.types.ts` and the FormData handling in `src/pages/api/auth/signup.ts`.
  - Blind spot: Zod 4's coercion of `""` → `0` for numbers needs a guard so a missing weight doesn't
    validate as a falsy zero.
- **Fix B**: Make the wire format match the schema instead
  - Strength: No mapper — name the DB columns camelCase and submit `weight`/`isCollective` through
    hidden inputs the client writes as JSON-ish primitives.
  - Tradeoff: camelCase Postgres columns fight every convention in the existing migration and force
    quoted identifiers in SQL forever.
  - Confidence: MEDIUM — it works, but it trades a 40-line mapper for a permanent schema-style split.
  - Blind spot: Effect on S-02's future SQL/ranking queries unassessed.
- **Decision**: FIXED via Fix A (2026-08-30) — Critical Implementation Details' "Validation
  architecture" section rewritten around three exports per module (schema / `parseForm` / `toRow`),
  with an explicit "do not spread the validated object into an insert/upsert" warning. Phase 2 §1 and
  Phase 3 §1 now specify all three; both route contracts call `toRow(...)`; Phase 2 §5 spells out the
  reverse snake_case→camelCase mapping for `initialValues`. `Number(... ?? NaN)` chosen over
  `z.coerce.number()` to close the Fix A blind spot (`""` → `0`).

### F3 — WeightSelector submits nothing, and every segment submits the form

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 and §3
- **Detail**: §2 specifies "10 buttons (not a native input)" inside a form that §3 says "submits via
  native POST to `/api/people`". Two consequences the contract misses: a bare `<button>` inside a
  form defaults to `type="submit"`, so clicking a weight segment submits the half-filled form; and no
  named form control carries `weight`, so even a correct submit posts a body with no weight field at
  all. Success criterion 3.6 ("weight selector … submits the correct 1–10 value") cannot pass as
  specified.
- **Fix**: Give every segment `type="button"` and render a sibling
  `<input type="hidden" name="weight" value={value} />` so the controlled React value reaches the
  native POST body.
- **Decision**: FIXED (2026-08-30) — Phase 3 §2's contract now calls out both requirements explicitly
  and adds a third: `weight` starts at `0` (outside 1–10) so an untouched selector fails validation
  rather than silently submitting a 1. New criterion 3.7 verifies that clicking a segment does not
  submit the form.

### F4 — FR-003's collective field silently narrowed to a boolean

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §1 (`is_collective`), Phase 3 §3
- **Detail**: `prd.md:99` (FR-003) specifies "a text field marking whether it is a single person or a
  collective (e.g. 'part of the family from the mountains')" — the example is a *name* for the
  collective, not a flag. The plan ships `is_collective boolean not null default false` and an
  "Osoba"/"Grupa" dropdown, which keeps the marker and drops the identity. This matters more than a
  spec nit: `roadmap.md`'s S-01 risk says a form too thin "starves S-02 of the context that breaks
  weight ties", and "the family from the mountains" is exactly that context. Nothing carries it now
  except free text the user may not think to put in `description`. Also a process gap: FR-004's
  1–5 → 1–10 change was amended in the PRD and recorded in `change.md`. This divergence was neither.
- **Fix A ⭐ Recommended**: Amend PRD FR-003 to match the decision
  - Strength: The dropdown is a deliberate user call recorded in `plan-brief.md`, and
    boolean+description is a legitimate reading; amending keeps the PRD from drifting stale for
    S-02/S-05, exactly as FR-004 was handled this session. Zero implementation cost.
  - Tradeoff: Accepts that the collective's identity lives in prose the AI must extract rather than a
    queryable column.
  - Confidence: HIGH — matches the precedent set for FR-004 in the same planning session.
  - Blind spot: Whether S-02's prompt can reliably pull collective identity out of a 500-char
    description is untested.
- **Fix B**: Add a nullable `collective_label text` column shown when Grupa
  - Strength: Keeps FR-003 literally satisfied and gives S-02 a clean structured signal; one nullable
    column, no backfill.
  - Tradeoff: A sixth field on a form the PRD twice warns must stay short for the "rushed persona".
  - Confidence: MEDIUM — cheap to build, but the abandonment risk the PRD raises is real and
    unmeasured.
  - Blind spot: No evidence yet on where this form's length tips into abandonment.
- **Decision**: FIXED via Fix A (2026-08-30) — PRD FR-003 amended in place to a single-vs-collective
  marker, with the collective's identity carried in the structured description; the Socrates
  Resolution line extended with the narrowing rationale, matching how FR-004's 1–5 → 1–10 widening
  was recorded. `prd.md:146` and `roadmap.md:144` needed no edit — both already say "single person or
  a collective" / "marker", which is what the boolean expresses. Recorded in `change.md` and in the
  plan's Key Discoveries, both naming `collective_label` (Fix B) as the fallback if `S-02` finds the
  description too weak a signal.

### F5 — zod is a phantom dependency

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details; Phase 2 §1, Phase 3 §1
- **Detail**: `npm ls zod` resolves `zod@4.4.3` — but only transitively, via `astro@6.3.1` and
  `@astrojs/sitemap@3.7.2`. It is absent from `package.json`. No phase adds it. So
  `import { z } from "zod"` will appear to work locally today and can break on any unrelated
  dependency bump, with the failure landing in CI or a Worker build rather than in this slice.
  (`eslint-plugin-react-compiler` pulls a second, v3 copy into the tree — so the hoisted version
  isn't even stable across installs.) `lessons.md`'s "verify exact config API in node_modules before
  trusting a plan's syntax" applies here too: pin the major, since the plan's
  `.superRefine()`/`.refine()` and enum syntax should be written against v4 specifically.
- **Fix**: Add `npm install zod@^4` as an explicit step at the top of Phase 2, and state "Zod 4" in
  Critical Implementation Details.
- **Decision**: FIXED (2026-08-30) — user added `zod@^4.5.4` to `package.json` directly; verified
  hoisted to top level and locked in `package-lock.json` (`npm ls zod` → `zod@4.5.4` as a direct
  dependency, with `astro` and `@astrojs/sitemap` deduped onto it). The install step is therefore
  moot; Critical Implementation Details now pins "Zod 4" and warns that
  `eslint-plugin-react-compiler`'s nested `zod@3` must never be the copy app code resolves.

### F6 — profiles' delete assertion would pass for the wrong reason

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3
- **Detail**: §3 asks for "cross-user update/delete denied" assertions on `profiles`, but §1 gives
  `profiles` select/insert/update policies only — no delete policy at all. A cross-user delete
  returning zero rows proves nothing about isolation there, since the owner can't delete either.
  Also, commit `1e6081c` established checking query errors on RLS-negative assertions; the contract
  should say to follow that shape.
- **Fix**: Drop the `profiles` delete assertion (or replace it with an explicit "no one, including
  the owner, can delete a profile row" assertion) and mirror `verify-rls.ts:103`'s
  `!err && length === 0` shape for the update case.
- **Decision**: PENDING

### F7 — Production migration ordering isn't written down

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Migration Notes; What We're NOT Doing
- **Detail**: Every success criterion in all four phases is local (`supabase db reset`,
  `astro check`, `npm run build`). Production migration application is listed as out of scope /
  manual, which is fine — but the plan never states the ordering it depends on. `CLAUDE.md`'s
  rollback rule (`wrangler rollback` reverts code, not the DB) plus Migration Notes' "must ship
  before any user has added a person" only work if the migration is applied *before* the Worker
  deploy. The prior slice (commit `0b7e079`) carried that as an explicit phase; here it's absent.
- **Fix**: One line in Migration Notes — "apply this migration to production before deploying the
  Worker that depends on it; the reverse order 500s `/people` for every user."
- **Decision**: PENDING

### F8 — TextField is built, then bypassed for description

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §3, Phase 3 §3
- **Detail**: Phase 3 §3 calls for "a plain `<textarea>` wrapped in `TextField`-equivalent styling" —
  duplicating the exact class string the new primitive was created to own. `FormField.tsx` already
  shows the shape to avoid: its `inputBase` constant hardcodes `pl-10` for the icon slot, so a copy
  for a textarea inherits padding it doesn't want.
- **Fix**: Give `TextField` a `multiline`/`rows` prop that swaps `<input>` for `<textarea>` over the
  same shared base class, per §3's own "share the constants from one place" instruction for
  `WeightSelector`/`WeightIndicator`.
- **Decision**: PENDING

## What's strong

The Progress block parses cleanly (30/30 criteria numbered and matched), the blast-radius sweep found
no unmentioned `people` consumers, the `NOT NULL`-without-`DEFAULT` window is correctly reasoned and
dated, and Phase 2's gate-excludes-`/profile` note pre-empts the redirect loop. The criticals are all
omissions at contract edges, not approach errors.
