<!-- PLAN-REVIEW-REPORT -->
# Plan Review: App Shell Navigation and Catalog Visual Alignment

- **Plan**: `context/changes/design-alignment-pass/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-30
- **Verdict**: REVISE
- **Findings**: 2 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

10/10 paths ✓, 6/7 symbols ✓ (no `typecheck` script in `package.json` — see F5),
Progress↔Phase mechanical contract ✓ well-formed, brief↔plan ✓ (one drift: the
brief promises "restyle spacing only" for the profile/add-person forms; Phase 5
changes shadow only).

## Findings

### F1 — Sign-out becomes unreachable below the `lg` breakpoint

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §3 (AppSidebar) + Phase 3 §1 (dashboard)
- **Detail**: Phase 3 removes `dashboard.astro:24`'s sign-out form — the app's only in-app sign-out on a protected page (`Topbar.astro:19` has the other, but Topbar renders only on `/`). Phase 2 puts sign-out in `AppSidebar.astro`, contracted as `hidden lg:flex`. `BottomNav` carries only the 3 nav items. Below 1024px a signed-in user has no way to sign out from any page. The plan's own check 3.5 ("Sign-out works from all three shell pages") carries no width, so it gets run at desktop and passes while the regression ships. The mock offers no answer to copy: grep for "Wyloguj"/"logout" in `InTouch.dc.html` returns nothing, and the mobile bar at `:375-377` is 3 tabs. The sidebar placement is the plan's own invention and wasn't carried to the mobile branch.
- **Fix A ⭐ Recommended**: Put sign-out on the `/ustawienia` stub
  - Strength: `/ustawienia` is already in the shell and reachable at every width, is already being built this pass, and is where a settings page conventionally holds it — keeps `BottomNav` at the mock's 3 tabs.
  - Tradeoff: Two taps on desktop if you drop the sidebar copy (keeping both is fine and costs nothing).
  - Confidence: HIGH — no new component, no mock divergence.
  - Blind spot: None significant.
- **Fix B**: Add sign-out to `BottomNav` as a 4th item
  - Strength: Single tap from anywhere.
  - Tradeoff: Diverges from the mock's 3-tab bar and crowds it; a destructive action in a nav bar is easy to hit by accident.
  - Confidence: MEDIUM — works, but fights the design.
  - Blind spot: 4-tab spacing at 390px unverified.
- **Either way**: add a width to Progress check 3.5 ("at ~390px").
- **Decision**: FIXED via Fix B — `BottomNav` gains a 4th "Wyloguj" tab (Phase 2 §4); check 3.5 now names both widths.

### F2 — Shell renders for users with no profile row; footer shows `undefined`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2 (`shell-summary.ts`), Phase 3 §3–4
- **Detail**: `middleware.ts:5` gates only `/people` on profile existence. `/dashboard` is protected but not profile-gated, and Phase 3 §4 explicitly declines to add `/ustawienia` to `PROFILE_GATED_ROUTES`. So the first-run user — signed up, hasn't filled the profile — lands on `/dashboard` today; the page's own CTA is literally "Uzupełnij profil". Phase 2's `shell-summary` contract says only "returning the profile's `name`" with no null case, and `AppSidebar` renders "{name} / {count} bliskich osób". The very first screen a new user sees renders `undefined` in the sidebar footer.
- **Fix**: Specify the helper returns `name: string | null`, and that `AppSidebar` falls back (user's email, or omit the footer) when there's no profile row. Add a manual check: "sidebar renders correctly on `/dashboard` for a signed-in user with no profile."
- **Decision**: FIXED (user's variant) — helper returns `string | null`; on `null` the sidebar footer renders a "Uzupełnij profil" prompt **with a button linking to `/profile`**, turning the gap into an onboarding nudge rather than a bare fallback. New Progress check 3.7.

### F3 — Promise gap: dashboard card and shell chrome get no shadow

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Desired End State vs. Phases 2–5
- **Detail**: End State promises "Every card in the app — auth, profile, add-person, dashboard, catalog, shell chrome — carries the mock's soft shadow." The card recipe appears exactly 7× in the repo. Phase 5 names 5 (profile, people/new, 3 auth pages); Phase 4 covers `PersonCard`. The 7th is `dashboard.astro:10` — and Phase 3, which rewrites that page, contracts only "wrap in AppShell, remove the sign-out form." No phase applies `shadow-card` there. Nor does any phase apply it to `AppSidebar`/`BottomNav` ("shell chrome").
- **Fix**: Add `shadow-card` to Phase 3 §1's dashboard contract (and say whether dashboard keeps a card at all inside the shell), and name it in Phase 2 §3/§4's `AppSidebar`/`BottomNav` contracts.
- **Decision**: FIXED — Phase 3 §1 now states dashboard keeps its card, drops its own centering wrapper, and gains `shadow-card`; Phase 2 §3/§4 name `shadow-card` on `AppSidebar`/`BottomNav`.

### F4 — `peopleCount` unspecified for `/dashboard` and `/ustawienia`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §2 + §5, Phase 3 §1 and §3
- **Detail**: `AppShell` takes a required `peopleCount` prop. Phase 2 §2 covers only the profile name and resolves counts by saying callers "that already have the full `people` array in scope (`people/index.astro`) pass `people.length` directly." Neither `/dashboard` — which today opens no Supabase client at all (`dashboard.astro` imports only `Layout` and `Button`) — nor the new `/ustawienia` has `people` in scope. Phase 3 writes `peopleCount={...}` for both and leaves the implementer to invent the query, its shape, and its failure behavior. Relatedly, "Performance Considerations: None — no new queries beyond the sidebar's lightweight profile-name lookup" understates it: two pages each gain two round-trips on top of middleware's existing `auth.getUser()`. `lessons.md` warns `astro dev` won't surface Workers subrequest/CPU limits.
- **Fix A ⭐ Recommended**: Make `peopleCount` optional; drop the count on `/dashboard` and `/ustawienia`
  - Strength: Zero new queries on two pages, no invented contract, no Workers subrequest growth. Only `/people` — which already holds the array for free — shows the count.
  - Tradeoff: Sidebar footer differs slightly between shell pages.
  - Confidence: HIGH — strictly removes work; nothing can break.
  - Blind spot: Haven't checked whether the mock's sidebar footer treats the count as load-bearing.
- **Fix B**: Specify `getPeopleCount(supabase, ownerId)` with a `{ count: "exact", head: true }` query
  - Strength: Consistent footer on all three shell pages.
  - Tradeoff: +1 subrequest per render on two pages; the plan's "Performance Considerations: None" needs rewriting.
  - Confidence: HIGH — trivial query, well-understood.
  - Blind spot: Cumulative per-request cost against the Workers free tier is unmeasured (`lessons.md` flags exactly this).
- **Decision**: FIXED via Fix A — `peopleCount` is optional on `AppShell`/`AppSidebar`; `/dashboard` and `/ustawienia` omit it and add no count query. "Performance Considerations" rewritten to state the real cost (one subrequest per shell render) and cite the `astro dev` limits lesson.

### F5 — Phase 2's automated verification cannot fail

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 Success Criteria / Progress 2.1–2.3
- **Detail**: Phase 2 deliberately builds five files with no importers, then verifies with build + lint + "`npm run typecheck` (if present)". `astro build` compiles only pages and what pages import, so the new `.astro` components are never in the build graph — 2.1 cannot fail on them. There is no `typecheck` script in `package.json` (verified; `@astrojs/check` is installed but unscripted), so 2.3 is a checkbox that can never legitimately be checked. Only `eslint .` touches the files, and it catches neither type errors nor Astro compile errors. Every real Phase 2 failure surfaces in Phase 3, attributed to the wrong phase.
- **Fix**: Replace 2.3 with `npx astro check` (dependency already installed) and note in Phase 2 that build/lint do not exercise the new components — or fold Phase 2 into Phase 3.
- **Decision**: ACCEPTED — plan left unchanged; the implementer handles it during Phase 2. Note for whoever runs it: criterion 2.3 (`npm run typecheck`) has no script behind it, so it stays unchecked, and a green 2.1/2.2 says nothing about the new components — expect Phase 2's real failures to appear in Phase 3.

### F6 — Implementation Approach numbers phases 0–4; the plan uses 1–5

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `## Implementation Approach`
- **Detail**: Reads "(0) shared tokens … (1) the shell's building blocks … (4) mechanical shadow-token polish", then "Phases 0 and 1 have no user-visible effect" — but the headings are Phase 1…Phase 5, and Progress is 1.1–5.4. Since `/10x-implement` is invoked as `phase <n>`, an implementer reading this paragraph runs the wrong phase. Every other cross-reference in the plan is correctly 1-indexed.
- **Fix**: Renumber to (1)–(5); change "Phases 0 and 1" → "Phases 1 and 2".
- **Decision**: FIXED — Implementation Approach renumbered to (1)–(5); "Phases 0 and 1" → "Phases 1 and 2"; "until Phase 2" → "until Phase 3".

### F7 — Nav icons diverge from the mock this pass exists to match

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §1 (`nav-items.ts`)
- **Detail**: `nav-items.ts` is contracted as `{ href, label, icon }` with lucide-react components. The mock uses no glyph icons in the nav at all: the sidebar has 8px colored dots (`InTouch.dc.html:156-159`, active `#C9B7CF` / inactive `#DED6CB`) and the bottom bar has 22px rounded colored squares (`:375-377`). Following the contract as written reintroduces a visual gap in the one pass meant to close it.
- **Fix**: Change `icon` to a color token per nav item — rendered as a dot in `AppSidebar`, a rounded square in `BottomNav` — matching `InTouch.dc.html:156-159` and `:375-377`. Drops lucide from the shell entirely.
- **Decision**: SKIPPED — plan unchanged; the shell keeps lucide-react icons. Accepted residual gap against the mock's colored dots/squares.
