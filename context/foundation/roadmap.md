---
project: "InTouch"
version: 2
status: active
created: 2026-08-15
updated: 2026-09-11
prd_version: 2
main_goal: speed
top_blocker: time
---

# Roadmap: InTouch

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

People lose touch with the people who matter through attrition, not choice — and
only notice once the gap has already opened ("it's been a year since I spoke with
my family in the mountains"). InTouch keeps a lightweight knowledge base about a
user's close ones and decides, on their behalf, which relationships are going
quiet and need attention now. The value is not "set yourself a reminder" — a
calendar can do that — it is the app doing the deciding and the nudging.

## North star

**S-03: User marks whether a suggested contact happened, and the ranking reflects it** —
this is the point where the product's central claim stops being a demo and becomes
a loop: the app suggests, the user acts, the user confirms, and the next suggestion
is better for it. The PRD's Primary success criterion is exactly this pair
("a sensible AI-proposed hierarchy" *and* "mark at least one contact as
successfully done").

> "North star" here means the smallest end-to-end slice whose successful delivery
> would prove the core product hypothesis — placed as early as its Prerequisites
> allow, because everything else only matters if this works.

## At a glance

| ID   | Change ID                    | Outcome (user can …)                                              | Prerequisites | PRD refs                       | Status   |
| ---- | ---------------------------- | ----------------------------------------------------------------- | ------------- | ------------------------------ | -------- |
| F-01 | `per-user-data-isolation`    | (foundation) migrations + default-deny RLS + a proof of isolation | —             | NFR-privacy, Access Control    | done        |
| F-02 | `openai-ranking-call-path`   | (foundation) the Worker can call OpenAI without blocking the user | —             | FR-007, NFR-non-blocking       | done        |
| F-03 | `design-system-foundation`   | (foundation) one token layer the screens actually use, no starter theme | —       | NFR-browser, FR-007/FR-009 design concerns | done                                        |
| F-04 | `resend-email-delivery-path` | (foundation) the Worker can send a real email on a schedule       | —             | FR-008, NFR-email-channel      | done |
| F-05 | `design-alignment-pass`      | (foundation) persistent nav shell (sidebar/bottom-bar) + catalog grid reskin, matching the finished design | F-03, S-01 | NFR-browser (mobile usability) | done      |
| F-06 | `product-analytics-posthog`  | (foundation) the primary funnel is measurable in PostHog, with no third-party personal data in any event | S-03 | Success Criteria (Primary + Secondary), NFR-privacy | done |
| F-07 | `automated-test-harness`     | (foundation) a test runner that gates CI, and an access boundary proven by tests rather than by hand | F-01, S-01 | NFR-privacy, Access Control | in-progress (phase 1 of 5) |
| S-01 | `profile-and-first-people`   | fill a self-profile and add people with a weight, and see them    | F-01, F-03    | FR-001, FR-002, FR-003, FR-004 | done      |
| S-02 | `ai-contact-hierarchy`       | see a ranked "who to reconnect with" list with time windows       | S-01, F-02, S-09 | US-01, FR-007               | done        |
| S-03 | `did-it-happen-feedback-loop`| confirm whether a contact happened and see the ranking react      | S-02          | US-01, FR-009                  | done |
| S-04 | `decay-driven-reminders`     | be reminded, unprompted, about relationships going quiet          | S-03, F-04    | FR-008, NFR-once-per-day       | done        |
| S-05 | `person-lifecycle-and-erasure`| edit, deactivate and permanently delete a person                  | S-01          | FR-005, NFR-privacy            | done |
| S-06 | `landing-page`                | see a real marketing page at `/` explaining what InTouch is, before signing in | F-03          | Access Control ("unauthenticated visitor") | done |
| S-07 | `account-and-profile-settings` | edit their own profile after first fill and manage their account from `/settings`       | S-01, F-05    | FR-001, FR-002, FR-008 (address), Access Control | done |
| S-08 | `password-recovery`           | get back into their account after forgetting the password         | F-03          | FR-001                         | done        |
| S-09 | `self-profile-rhythm-fields`  | tell the app their own contact rhythm (time budget, channels, slots) so suggestions land in it | S-01          | FR-002, FR-007                 | done |
| S-10 | `add-person-context-fields`   | add a person through a form inside the app shell, with richer per-person context (who they are, freeform tags, roughly when last in touch) | S-01, S-03, F-05 | FR-003, Open Q2         | done |
| S-11 | `ranking-recency-floor`       | trust that marking a contact actually moves the suggested time window, and that the same input gives the same answer | S-03, S-10 | US-01, FR-007, FR-009 | done |
| S-17 | `byok-openai-key`             | paste their own OpenAI key in `/settings` for unlimited manual recomputes; without one, "Przelicz teraz" is capped at once per calendar day | F-02, S-07 | FR-001 (amended), FR-007 | done |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                     | Chain                                | Note                                                                                          |
| ------ | ------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| A      | The loop                  | `F-01` + `F-03` → `S-01` → `S-09` → `S-02` → `S-03` | The must-have path — the shortest chain of `must-have` requirements that reaches the north star, with nothing optional in it. Under `main_goal: speed`, nothing outranks this chain. |
| B      | AI call path              | `F-02`                               | Runs in parallel with `F-01`/`S-01`; joins Stream A at `S-02`.                                 |
| C      | Data lifecycle & erasure  | `S-05`                               | Branches off `S-01`, runs parallel to `S-02`/`S-03`. Carries the binary privacy NFR.           |
| D      | Proactive reminders       | `F-04` → `S-04`                      | Complete. Both shipped; the cadence and email-content decisions were made inside `S-04`'s own plan (2026-09-08) rather than ahead of it. |
| E      | Visual foundation         | `F-03` → `F-05`                      | Runs in parallel with `F-01`/`F-02`; joins Stream A at `S-01`, the first slice that renders product screens. `F-05` follows once `S-01` ships, since its shell needs real people/profile data to show. |
| F      | Public landing page       | `F-03` → `S-06`                      | Parallel with everything else once `F-03` lands. A leaf outcome — nothing downstream depends on it; it's the first thing a visitor meets, not a foundation for anything. |
| H      | Product measurement       | `S-03` → `F-06`                      | Starts once the funnel it measures exists. A leaf track — nothing depends on it structurally; it feeds the *decisions* still open on `S-04` (Open Questions 3 and 5) rather than any slice's code. |
| G      | Account & credentials     | `F-05` → `S-07`; `F-03` → `S-08`; `F-02`, `S-07` → `S-17` | Three branches on the same theme. `S-07` fills the `/settings` stub `F-05` created — its account half; the reminder half of that page belongs to `S-04`, so those two meet on one route without depending on each other. `S-08` is unauthenticated and shares nothing but Supabase Auth, so it needs neither `S-01` nor the shell. `S-17` adds a fourth `/settings` section and reuses `F-02`'s OpenAI call path per-owner instead of app-wide. |
| I      | Tester feedback (2026-09-08) | `S-11`                               | Opened by real production feedback, triaged in `context/changes/feedback-triage-2026-09-08/triage.md`. `S-11` (the P0 — the ranking bug the tester actually hit) is shipped and closes the stream on the board. The triage's five remaining findings are **parked**, not sequenced — see `## Parked`. |
| J      | Test harness & rigour     | `F-07`                               | Phase-level tracking lives in `context/foundation/test-plan.md` §3, not here — this roadmap carries the outcome, that document carries the five rollout phases. The follow-on list Phase 1 pinned is **parked** (see `## Parked`), so this stream is `F-07` alone. |

## Baseline

What's already in place in the codebase as of `2026-08-15` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind v4 + shadcn/ui; `src/layouts/Layout.astro`, `src/components/ui/button.tsx`, auth forms under `src/components/auth/`.
- **Design system:** absent — the *tooling* is present but nothing uses it. Two disconnected visual systems coexist: (a) shadcn's token layer in `src/styles/global.css` (`baseColor: neutral`, a light `:root` set plus a `.dark` set), which reaches exactly one component — `src/components/ui/button.tsx`, via `SubmitButton.tsx`; (b) the starter's inherited "cosmic" theme, hardcoded as Tailwind palette utilities (`bg-cosmic`, `purple-600`, `blue-100/70`, gradient headings) across every page and component in `src/pages/` and `src/components/`, plus raw hex in `src/components/Banner.astro`. Nothing toggles the `.dark` class, so the token layer's light default is what `--background` means while every screen renders dark — the two never meet. No typography scale, no spacing/state conventions, no product identity (`Layout.astro`'s default title is still `"10x Astro Starter"`).
- **Backend / API:** partial — `output: "server"` with API routes for auth only (`src/pages/api/auth/{signin,signup,signout}.ts`). No domain endpoints yet.
- **Data:** partial — `@supabase/ssr` client wired in `src/lib/supabase.ts`, but `supabase/` holds only `config.toml` (with the starter's default `project_id = "10x-astro-starter"`). No `supabase/migrations/`, no schema, no generated DB types, no RLS.
- **Auth:** present — Supabase cookie-based auth; signup / signin / signout / confirm-email routes, `src/middleware.ts` guards `/dashboard`, `App.Locals.user` typed in `src/env.d.ts`. FR-001's *authentication* half is done; its *data-ownership* half has nothing to own yet.
- **Deploy / infra:** present — Cloudflare Workers (`wrangler.jsonc`), GitHub Actions `ci.yml` + `deploy.yml`, production live at `https://intouch.g-ratajczak97.workers.dev`.
- **Observability:** partial — Workers platform observability enabled in `wrangler.jsonc`; no application-level error tracking or logging library. Deliberately left as-is (see `## Parked`).
- **AI provider:** decided but unwired — OpenAI, API key already held by the user. No SDK in `package.json`, no secret bound.
- **Scheduling / delivery:** decided but unwired — the channel question is closed (PRD v2: reminders are email, sent through **Resend**), but nothing is built. No `triggers.crons` in `wrangler.jsonc`, no Resend SDK in `package.json`, no `RESEND_API_KEY` in any of the three secret locations (`.dev.vars`, Workers Secrets, GitHub Secrets), no verified sending domain, and no `astro:env/server` entry for the key. Still blocks FR-008.

## Foundations

### F-01: Per-user data isolation contract

- **Outcome:** (foundation) `supabase/migrations/` exists with a first forward-compatible migration applied locally and in production, user-owned tables default to deny-all RLS with an owner-scoped policy, generated DB types are available to app code, and there is a repeatable check proving that user B cannot read user A's rows.
- **Change ID:** `per-user-data-isolation`
- **PRD refs:** NFR "personal data about the user's close ones … is never visible to any other user", `## Access Control` (flat model, own circle only), FR-001 (data-ownership half)
- **Unlocks:** `S-01`, `S-02`, `S-03`, `S-05` — every slice that stores or reads a person's data. Also reduces the PRD's privacy guardrail from an aspiration to a testable path, and establishes the verification recipe `S-05` reuses for irreversible deletion.
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the one place where `main_goal: speed` does not get to win. RLS retrofitted after three slices already write rows is a migration with real data in it; RLS established before the first row is a policy file. The scope cap is deliberate: F-01 proves the pattern on the single minimal owner-scoped table `S-01` needs, and each later slice adds its own tables under the same contract — it does not model the domain up front. Note also that `wrangler rollback` reverts code but not the database (see `CLAUDE.md`), so every migration from here on must be forward-compatible.
- **Status:** done

### F-02: OpenAI call path from the Worker

- **Outcome:** (foundation) the Worker can make a server-side OpenAI call with the key arriving through `astro:env/server`, the request shape does not block the user's view while it runs, and the path has been checked against Cloudflare's production limits rather than only against `astro dev`.
- **Change ID:** `openai-ranking-call-path`
- **PRD refs:** FR-007, NFR "generating the AI hierarchy never blocks the user: they may leave or close the view while it runs, and are notified when the result is ready"
- **Unlocks:** `S-02` — the ranking slice cannot be planned until the non-blocking generation shape is settled. Also reduces the "will this survive the Workers runtime?" unknown recorded in `context/foundation/lessons.md`.
- **Prerequisites:** —
- **Parallel with:** F-01, S-01
- **Blockers:** — (OpenAI chosen; the user already holds the API key, so nothing external is pending)
- **Unknowns:** — resolved during this foundation's work:
  - ~~The non-blocking generation shape~~ — settled as a KV-backed deferred job: the route enqueues, returns a job id, and the view polls; the user may leave or close it while the call runs. Shipped in `d73f3e9`, verified against production limits in `cafa8b1`.
- **Risk:** Sequenced here because `lessons.md` already records that a fast local `astro dev` run proves nothing about the Workers free-tier ceilings, and an LLM call is exactly the kind of per-request work that finds them. Discovering this inside `S-02` would invalidate that slice's whole design rather than just its plan. Scope is capped at one proven call path plus the secret in all three places (`.dev.vars`, `wrangler secret`, GitHub Secrets) — not a prompt, not a ranking, not a schema.
- **Status:** done

### F-03: Design system and product identity

- **Outcome:** (foundation) the app has one visual contract that its screens actually use — a named color palette with semantic tokens (surfaces, text, borders, primary/accent, and the state colors the product needs: success for a confirmed contact, warning for a relationship going quiet, destructive for erasure), a typography scale, and spacing/radius conventions, all defined once in `src/styles/global.css`. The starter's "cosmic" theme is gone from `src/pages/` and `src/components/`, no view hardcodes a Tailwind palette utility or a raw hex, `Layout.astro` carries InTouch's own title/metadata, and the small set of primitives the product's screens need exists under `src/components/ui/` via `npx shadcn add`.
- **Change ID:** `design-system-foundation`
- **PRD refs:** NFR "the product is usable in a current mainstream desktop/mobile web browser"; FR-007's parked design concern ("suggestions must be explainable enough to trust"); FR-009's parked design concern ("making the marker frictionless")
- **Unlocks:** `S-01`, `S-02`, `S-03`, `S-05` — every slice that renders a screen. It also gives the two design concerns the PRD explicitly routed out of the requirements (explainable ranking, frictionless did-it-happen marker) somewhere concrete to land, instead of each slice inventing its own visual answer.
- **Prerequisites:** —
- **Parallel with:** F-01, F-02
- **Blockers:** —
- **Unknowns:**
  - Palette direction — warm and personal (this is an app about people you care about) versus neutral-utility (shadcn's current `baseColor: neutral`). Owner: user, during this foundation's plan. Block: no — the plan step must propose a concrete palette and get it confirmed before restyling; it is not a research question.
  - Does the MVP ship dark mode at all? Today the token layer defines a light default plus a `.dark` block that nothing toggles, while every screen renders the starter's dark gradient — one of the three has to go. Owner: user, during this foundation's plan. Block: no — shipping light-only is a legitimate answer under `main_goal: speed`, as long as it is a decision rather than the current accident.
- **Risk:** This is a foundation because of retrofit cost, not because it is glamorous. Every screen in the repo today is styled in a theme inherited from the starter that has nothing to do with this product, and the token layer that shadcn components expect is effectively dead code. Building `S-01`, `S-02`, `S-03` and `S-05` on top of that means four slices of screens to re-skin later, plus every new `npx shadcn add` component arriving in tokens that visually clash with the pages around it — the same "retrofit versus policy file" argument that sequences `F-01`. The counter-risk is real and is why the scope is capped hard: token layer, removal of the starter theme, product identity in `Layout.astro`, and only the primitives `S-01`/`S-02` actually need (form field, list row/card, weight indicator, empty state, pending state). No Storybook, no component gallery, no logo or brand work, no components without a caller. The existing auth screens are the migration's proving ground — they are the only real screens that exist, so they are what shows the palette holds up before any product screen is written on it.
- **Status:** done

### F-04: Resend email delivery path

- **Outcome:** (foundation) the Worker can send one real email to a real inbox through **Resend** — `RESEND_API_KEY` reaching the code through `astro:env/server` and present in all three secret locations, a sending identity that Resend accepts, and the send happening from a scheduled `triggers.crons` invocation rather than only from a request handler. The send's outcome (Resend's message id or its error) is visible in Workers logs, and the path has been checked against Cloudflare's production limits rather than only against `astro dev`.
- **Change ID:** `resend-email-delivery-path`
- **PRD refs:** FR-008 ("delivered as email to the address on their account"), NFR "reminders are delivered by email … through a transactional email provider (Resend) … delivery outcomes must be observable rather than fire-and-forget", NFR "at most once per day"
- **Unlocks:** `S-04` — the only slice that sends anything. Closes the "delivery channel" open question that blocked it, and turns the PRD's email NFR from a stated intention into a proven path.
- **Prerequisites:** —
- **Parallel with:** F-01, F-02, F-03
- **Blockers:** — (Resend chosen; the user already holds the account and API key, so nothing external is pending. The sending identity below can still add an external wait if it lands on an owned domain, but the test sender makes the path provable without one — which is why this is `ready` rather than `blocked`.)
- **Unknowns:**
  - Sending identity — a domain the user owns (needs DNS records, and verification has an external lead time nobody can compress) or Resend's `onboarding@resend.dev` test sender (zero setup, but it can only deliver to the account owner's own address). For an MVP whose only user is the author, the test sender may genuinely be enough; for anyone else it is not. Owner: user, during this foundation's plan. Block: no — but it is the item worth starting first, because it is the only one that waits on DNS rather than on code.
  - Whether the scheduled handler sends directly or enqueues, given that Cloudflare's free plan caps Cron Triggers at **5 per account** (not per Worker) with a 1-minute minimum interval — already recorded as a risk in `context/foundation/infrastructure.md`. Owner: resolved by this foundation's work. Block: no.
- **Risk:** Lifted out of `S-04` for the same reason `F-02` was lifted out of `S-02`: an unproven outbound call from an edge runtime is exactly the kind of thing that invalidates a slice's design rather than just its plan, and here it is compounded by a dependency that is not code at all. Domain verification is DNS propagation plus Resend's checks — if that is discovered inside `S-04`, the slice stalls on something no amount of implementation effort moves. Sequencing it as its own foundation means it can run **now**, in parallel with everything else, while the cadence decision that still blocks `S-04` is pending. Scope is capped at one proven send on one schedule plus the secret in all three places — no reminder logic, no decay rules, no email template, no ranking. Note also that a scheduled handler is the first code in this repo that runs with no user in scope, so `F-01`'s RLS assumption ("the row's owner is the caller") does not hold for it; how the sweep reads other users' rows safely is `S-04`'s problem, but `F-04` must not accidentally establish a pattern that bypasses RLS.
- **Status:** done — shipped `c7df7e9`…`d34bfbf`

### F-05: App shell navigation and catalog visual alignment

- **Outcome:** (foundation) `/dashboard`, `/people`, and a new `/settings` stub (labelled "Ustawienia") render inside one persistent app shell — a desktop sidebar and a mobile bottom tab bar sharing one nav-items config with server-rendered active-route highlighting — and `/people` renders as a responsive card grid instead of a flat list. Every card in the app carries a shared shadow token matching the finished design bundle.
- **Change ID:** `design-alignment-pass`
- **PRD refs:** NFR "the product is usable in a current mainstream desktop/mobile web browser" (drives the mobile bottom-bar pattern, not just a sidebar squeezed down). Not tied to a numbered FR — closes a visual gap the roadmap didn't originally carve out, the same way `S-06` did for the landing page.
- **Unlocks:** Gives `S-02` ("Dziś" real ranked content), `S-04` ("Ustawienia" real reminder settings) and `S-07` (the account half of that same settings page) a shell to render their content into, instead of each slice inventing its own nav from scratch.
- **Prerequisites:** F-03 (done), S-01 (done)
- **Parallel with:** S-02, S-03, S-05 — touches shared chrome and the catalog's visual layout, not their data or logic.
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low technical risk — server-rendered nav, zero client JS, no schema change. The real risk is scope discipline: the design bundle presents this shell together with content this pass deliberately does not build (AI ranking, contact history, reminder settings, category tabs/search on the catalog). Scope is capped at chrome plus a grid reskin — see `context/changes/design-alignment-pass/plan.md`'s "What We're NOT Doing" for the full boundary.
- **Status:** done

### F-06: Product analytics with PostHog

- **Outcome:** (foundation) the PRD's primary funnel is measurable end to end: each step a user completes — signed up, self-profile filled, first person added, hierarchy generated, suggestion confirmed as done — emits one named event to PostHog through a single typed wrapper in `src/lib/analytics/`, keyed by the Supabase user id and nothing else. No person's name, description, `relationship_context`, tags or email ever leaves the app in an event payload. The key arrives through `astro:env/server` and lives in all three secret locations (`.dev.vars`, Workers Secrets, GitHub Secrets), the event catalog is documented in-repo, and a PostHog funnel/insight exists that answers the Success Criteria question ("did a user get from *added my people* to *confirmed a contact*?") without reading Workers logs.
- **Change ID:** `product-analytics-posthog`
- **PRD refs:** `## Success Criteria` Primary (the end-to-end flow completion rate) and Secondary ("at least one contact initiated within the first 30 days" — a time-windowed cohort question no log line answers), Guardrail "quality / relevance of AI suggestions" (a confirmed-vs-dismissed rate per generated hierarchy is the cheapest proxy the MVP has), Guardrail NFR-privacy (the constraint on what an event may carry)
- **Unlocks:** Nothing structurally — no slice's code waits on it. What it unlocks is *judgement*: `S-04`'s reminder cadence (Open Question 3) and `S-04`'s email content (Open Question 5) are currently decisions to be made from intuition; with the funnel instrumented they can be made from a number. Also gives `S-02`'s relevance guardrail a measurable form.
- **Prerequisites:** S-03 (done) — the funnel this measures must exist before it is worth instrumenting; instrumenting a flow still being reshaped means rewriting the event catalog with it.
- **Parallel with:** S-04, S-05, S-07 — adds a capture wrapper and call sites, touches no schema, no ranking logic and no UI behaviour.
- **Blockers:** —
- **Unknowns:**
  - **Cloud region or self-host.** PostHog Cloud EU vs Cloud US vs self-hosted. The app stores personal data about third parties and the user base is Polish; even though no third-party data is meant to appear in an event, the account-level data-residency choice is made once and is painful to move later. Owner: user, during this foundation's plan. Block: no — but decide it before the first event is sent, not after.
  - **Server-side, client-side, or both.** `posthog-node`-style capture from the Worker is reliable and ad-blocker-proof but sees only what the server handles; the browser SDK sees real user interaction (and autocapture, session replay) but is blocked for a meaningful share of users and ships a script to every page. A Workers-first app has a real reason to prefer server-side for the funnel and add the browser SDK only if a specific question needs it. Owner: user, during this foundation's plan.
  - **Reverse proxy under the app's own domain?** Standard PostHog advice for beating ad blockers, and cheap on Workers — but it is an extra route to maintain. Owner: user, during this foundation's plan. Block: no.
  - **Does the user get an opt-out, and is it in `/settings` (`S-07`) or absent from the MVP?** Owner: user, during this foundation's plan.
- **Risk:** The technical risk is low — one wrapper, a handful of call sites, one secret. The real risks are two. First, **privacy leakage by convenience**: the moment an event carries a person's name or description "just for context", the product's binary privacy guardrail is broken in a vendor's database, and `F-01`'s RLS work bought nothing. The wrapper must make the safe call the easy one — an allow-list of event properties, not a free-form object. Second, **instrumentation sprawl**: PostHog will happily take autocapture, session replay, feature flags, A/B tests and error tracking, none of which the Success Criteria asked for. Scope is capped at the named funnel events plus one insight that reads them; everything else is a later decision, and session replay in particular would record screens full of third-party personal data (see also the parked error-tracking entry under `## Parked`, which this foundation does *not* silently resolve).
- **Status:** done

### F-07: Automated test harness and a proven access boundary

- **Outcome:** (foundation) the repo has a test runner that actually starts under the Cloudflare adapter, a layered suite (`tests/unit`, `tests/rls`, `tests/routes`, `tests/http`), and an access boundary that is proven by tests rather than by a human clicking — neither an anonymous caller nor a second signed-in user can reach the first user's rows through a real route. The suite gates CI and deploy.
- **Change ID:** `automated-test-harness` — rollout phases live in `context/foundation/test-plan.md` §3; Phase 1 shipped as `context/archive/2026-09-07-testing-runner-and-access-boundary/`
- **PRD refs:** NFR-privacy (the binary guardrail is now asserted, not assumed), `## Access Control`, plus the Quality Gates the test plan sets out
- **Unlocks:** Every later slice, indirectly — from Phase 1 on, a regression in the access boundary is a red test rather than a discovery in production. It also produced the hardening follow-ups now sitting in `## Parked`.
- **Prerequisites:** F-01 (the RLS contract the suite asserts), S-01 (rows worth protecting)
- **Parallel with:** Everything — it adds tests and config, no application behaviour.
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The interesting risk was not writing tests but getting a runner to start at all: `@cloudflare/vite-plugin` refuses to boot when a Worker environment carries `resolve.external`, which Vitest always sets, so Vitest died during config resolution before reading a test file. `vitest.config.ts` now strips the adapter's Vite plugins. The second risk is subtler and already bit once — a test that proves nothing while reporting green (`delete-data.test.ts` ran the connection and the claimed identity matched, so RLS satisfied the assertion on its own and the route's filter could be deleted with the suite still green). Every cross-owner test on this surface must run under a deliberate mismatch, and be verified by mutation.
- **Status:** in-progress — Phase 1 of 5 complete (`2026-09-07-testing-runner-and-access-boundary`). Phases 2–5 not started; Phase 5's delivery half is no longer gated, since `S-04` shipped.

## Slices

### S-01: Profile and first people

- **Outcome:** User can fill a short structured self-profile, add people with a structured description, a single-vs-collective marker and a 1–10 relationship weight, and see them listed as their own private circle.
- **Change ID:** `profile-and-first-people`
- **PRD refs:** FR-001 (its data-ownership half — a user's people belong to their account), FR-002, FR-003, FR-004
- **Prerequisites:** F-01, F-03
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:**
  - Exact fields for the self-profile (FR-002) and the per-person form (FR-003) are not pinned in the PRD. Owner: user, during this slice's plan. Block: no — the plan step must propose a concrete field set and get it confirmed before building; it is not a research question.
- **Risk:** This is the only input the AI ever gets, so a form that is too thin starves `S-02` of the context that breaks weight ties, and a form that is too heavy gets abandoned by exactly the rushed persona the PRD describes. The PRD already moved both forms from free text to structured for this reason — the plan should hold that line. Sequenced first because nothing downstream has data without it.
- **Status:** done

### S-02: AI contact hierarchy

- **Outcome:** User can see a ranked "who to reconnect with" list computed from their self-profile, their people's descriptions and weights, where each entry carries a suggested time window ("worth contacting Maciej within 2 weeks").
- **Change ID:** `ai-contact-hierarchy`
- **PRD refs:** US-01, FR-007
- **Prerequisites:** S-01, F-02, S-09 (the self-profile rhythm fields the "Twój rytm" half of each explanation is derived from)
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** — resolved during this slice's plan:
  - ~~How much "why this order / why this time window" reasoning is shown~~ — full `Dlaczego teraz` plus factor chips for the top 3, one-line collapsed rows with `Rozwiń` below. Time windows are enum buckets with a Polish label map, never model-authored prose.
- **Risk:** The PRD names AI relevance as a guardrail: a nonsensical ranking makes the core feature worthless even when every other part works. Two acceptance criteria are the real test — two people with the same weight must not be ordered identically, and a user with no people must get an explanatory empty state rather than an error. Sequenced immediately after its two prerequisites because it carries the product's biggest unknown and `main_goal: speed` means finding out early beats polishing around it.
- **Status:** done

### S-03: Did-it-happen feedback loop

- **Outcome:** User can confirm, after a suggested contact's intended date, whether it actually happened (yes/no), and the next ranking visibly takes that answer — and the time since it — into account.
- **Change ID:** `did-it-happen-feedback-loop`
- **PRD refs:** US-01 (acceptance criterion: "the hierarchy takes into account time since the last (un)successful contact"), FR-009
- **Prerequisites:** S-02
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the north star, and its risk is behavioural rather than technical: the PRD already flags that users will not bother marking did-it-happen unless the marker is frictionless, and an empty loop leaves the hierarchy permanently stale. Note this slice deliberately lands *before* reminders (`S-04`) — the confirmation can be prompted inside the app from the hierarchy view, which means the loop closes without waiting on a delivery channel that is still undecided.
- **Status:** done — shipped `ec18164`…`fde184b`

### S-04: Decay-driven reminders

- **Outcome:** User is reminded by email, without opening the app, about relationships that have gone quiet — at most once a day, in the order the hierarchy proposes.
- **Change ID:** `decay-driven-reminders`
- **PRD refs:** FR-008, NFR "reminders reach the user at most once per day, and address relationship decay — not same-day calendar events", NFR "reminders are delivered by email … through Resend"
- **Prerequisites:** S-03, F-04
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** — all three resolved during this slice's plan (2026-09-08):
  - ~~How often do reminders fire without becoming spam users mute?~~ — an urgency gate (only `this_week` / `two_weeks` entries qualify) plus a 3-day per-user cooldown. The once-per-day NFR stays the ceiling above that, and nothing urgent means silence rather than a filler email. Closes PRD Open Question 3.
  - ~~What does one reminder email actually contain?~~ — one hero person with a "Dlaczego akurat teraz" factor list, plus a two-line "W kolejce" teaser, matching the design bundle's own framing ("jeden mail, jedna osoba, jedno wezwanie"). A digest was rejected precisely because it is read and dismissed without ever feeding the `S-03` loop. Closes PRD Open Question 4.
  - ~~How does a scheduled sweep read across users' rows without defeating `F-01`'s RLS?~~ — a `SECURITY DEFINER` `reminder_candidates()` function with a fixed return shape is the only cross-owner query, callable by `service_role` alone; the service-role key is confined to `src/lib/supabase-admin.ts` and every per-user read after that point reuses the existing owner-filtered helpers.
- **Risk:** The two decisions that held this slice back — delivery channel, then cadence — both closed before code was written, the channel in PRD v2 (email via Resend, wiring lifted into `F-04`) and the cadence inside this slice's own plan. Deliberately not sequenced earlier despite being the vision's most distinctive promise ("the app decides on your behalf"), because under `top_blocker: time` the scheduled-sweep infrastructure is worth paying for only once the loop it drives is proven. Its sharpest technical risk is the RLS unknown above: this is the first code in the repo that acts on behalf of users who are not present, and a sweep that reaches for a service-role key to get the job done would quietly undo the guarantee `F-01` exists to establish.
- **Status:** done — shipped `4cebfee`…`f72b686`; impl-reviewed (0 critical, all 7 findings triaged). Production-verified by a real send (`d0afb2f3`, 2026-09-08 10:20 UTC).

### S-05: Person lifecycle and erasure

- **Outcome:** User can edit a person, deactivate them so the AI stops considering them while their contact history is retained, and — only after deactivation — delete them permanently.
- **Change ID:** `person-lifecycle-and-erasure`
- **PRD refs:** FR-005, NFR "deleting a person's data is fully and irreversibly honored" (binary; GDPR-adjacent)
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Carries the second half of the privacy NFR, which is binary — partial deletion is a failure, not a smaller success. The deactivate-before-delete rule exists because deleting a person otherwise destroys the contact history feeding the ranking, so the two paths must not be collapsed into one "remove" action for speed. Fully parallel with the Stream A chain: it touches the same tables but none of the ranking logic, which under `top_blocker: time` makes it the natural candidate for a separate agent run.
- **Status:** done — All five phases shipped (`a41d192`, `159a4a2`, `8ab5df3`, `9e55630`, Phase 4 impl-review triage in `8209424`, `e58498b`, epilogue `efc44ed`). Phase 5 landed as `tests/routes/erasure.test.ts` in the Vitest suite rather than the planned `npm run verify:erasure` script: that script's template, `scripts/verify-rls.ts`, had been promoted to `tests/rls/fixture.ts` and deleted by `F-07` Phase 1. This resolves **Open Roadmap Question 13** — one proof of the erasure NFR, owned by S-05 and inherited by `F-07`'s Phase 2, not two.

### S-06: Public landing page

- **Outcome:** An unauthenticated visitor landing on `/` sees a real marketing page — hero, problem statement, "how it works" (4 steps), "who it's for", the product's stated principles, and a closing CTA — using InTouch's own copy and visual identity. Shipped as eight `.astro` sections under `src/components/landing/`, fully responsive, with a signed-in visitor redirected to `/dashboard`. The starter-era `Welcome.astro` and `Topbar.astro` were deleted.
- **Change ID:** `landing-page`
- **PRD refs:** Access Control ("an unauthenticated visitor has no access to any relationship data") — this is the page that visitor actually lands on. Not tied to a numbered FR; it closes a gap the roadmap missed, found by the user while implementing other slices: nowhere in the PRD is there an owner for "what a visitor sees before they sign up." Full copy and layout already exist as a design handoff in `.ai/intouch-design-preparation/project/InTouch.dc.html` (section "8 — Landing page") plus the companion "9 — Mail z przypomnieniem" reminder-email mocks, which belong to `S-04` rather than this slice.
- **Unlocks:** — (leaf outcome; nothing downstream depends on it)
- **Prerequisites:** F-03
- **Parallel with:** S-01, S-02, S-03, S-04, S-05 — touches no data model and no auth-gated route, so it can be picked up by a separate agent run any time after `F-03` lands.
- **Blockers:** —
- **Unknowns:** — all three resolved during this slice's plan:
  - ~~Palette and dark mode~~ — closed upstream by `F-03`, which adopted this design's warm palette wholesale. `src/styles/global.css` already carries the mock's exact values and defines **no `.dark` block**, so the page inherits tokens rather than introducing a second palette. This slice added no new tokens; the two colours the mock leaves untokenised (`#3A3530`, `#B5ADA3`) are expressed as opacity over the primary pair.
  - ~~Footer links and nav anchors~~ — nav links became on-page scroll anchors (`#jak-to-dziala`, `#dla-kogo`, `#zasady`, the last labelled "Prywatność" and pointing at the principles section that carries the privacy promise). The footer's Prywatność / Regulamin / Kontakt row was **dropped** rather than pointed at pages that do not exist. **Follow-on debt:** a real privacy policy is still owed before this page is put in front of strangers.
  - ~~Primary CTA target~~ — all three primary CTAs route straight to `/auth/signup`; the hero's secondary CTA ("Zobacz, jak to wygląda") scrolls to how-it-works.
- **Risk:** Low technical risk — static content, no data model, no auth, no AI call. Sequencing after `F-03` paid off exactly as intended: the token layer already matched the design, so the page added no palette of its own. Two things the risk note did not anticipate, both now recorded in `lessons.md` or shipped as fixes:
  - **`<Button asChild>` silently renders an unstyled link in `.astro`.** `@astrojs/react` wraps slot children in `<astro-static-slot>`, so Radix's `Slot` merges the button classes onto that wrapper and the inner `<a>` gets nothing. Three phases shipped with every CTA rendering as plain text; `astro check`, ESLint, `npm run build` and the generated CSS all passed throughout. Caught only by a human looking at the page. Fixed with `buttonVariants()` on native anchors; rule recorded in `lessons.md`.
  - **Verbatim transcription propagated a factual error.** The scope note said "using InTouch's copy verbatim from the design file", and the mock states the relationship weight scale is 1–5. The shipped product uses 1–10 (`WeightSelector.tsx` `WEIGHT_MAX = 10`, `person.ts` `.max(10)`). The mock's own typo ("najbliższych osobac") shipped the same way before being corrected. Design copy is a draft about the product, not a source of truth for it — `S-02`/`S-03`/`S-04` transcribe from the same file and should check claims against the code.
- **Status:** done — shipped `edcfa48`…`a01cb9f`

### S-07: Account and profile settings

- **Outcome:** User can open `/settings` and actually manage their account there — re-open and change the self-profile they filled during `S-01` (name, date of birth, life context) after its first save, see which email address the account and its FR-008 reminders hang off, and change their password — rendered inside the app shell instead of the placeholder card that stands there today.
- **Change ID:** `account-and-profile-settings`
- **PRD refs:** FR-001 (its post-signup half — an account the user can create and sign in to is also an account they must be able to maintain), FR-002 (the self-profile form exists but is a one-way trip today), FR-008 ("delivered as email to the address on their account" — the user has to be able to see that address to trust the reminders), `## Access Control` (flat model — a user manages their own account and nobody else's)
- **Unlocks:** — (leaf outcome). It does, however, give `S-04` a settled page to add reminder settings to, rather than `S-04` having to build the settings screen and its cadence controls in one go.
- **Prerequisites:** S-01 (there must be a profile worth editing), F-05 (the shell and the `/settings` route it stubbed)
- **Parallel with:** S-02, S-03, S-04, S-05, S-06 — touches the profile row the user already owns and Supabase auth, not the ranking, the people table, or the delivery path.
- **Blockers:** —
- **Unknowns:**
  - May a user delete their whole account, and with it every person they entered? The PRD's irreversible-deletion NFR is written about a *person* (`S-05`'s job), never about an account. Owner: user, during this slice's plan. Block: no — for an MVP whose only user is the author, no self-serve account deletion is a legitimate answer, as long as it is a decision rather than an omission.
  - Changing the account email changes where FR-008 reminders land, and Supabase treats it as a re-verification round trip, not a field update — and `supabase/config.toml` currently sets `double_confirm_changes = true`, so it is two confirmation emails (old address and new), on whichever mailer Open Question 10 settles. Display it read-only, or build the verification flow? Owner: user, during this slice's plan. Block: no — read-only is a legitimate MVP answer under `main_goal: speed`.
  - Does the profile edit live inline on `/settings`, or does `/settings` link out to the existing `/profile` page — which today renders full-screen outside `AppShell` and redirects to `/people` on save? Owner: resolved during this slice's plan. Block: no.
- **Risk:** Low technical risk, and almost none of it is new code: the profile form, its `POST /api/profile` upsert and the RLS-scoped read all shipped with `S-01`. The risk this slice removes is a silent one. `/profile` is reachable from exactly one place — the sidebar prompt that disappears the moment a name is saved — so a user who mistyped their date of birth or wrote their life context in a hurry has no route back, and `S-02` keeps ranking on context nobody can correct. That surfaces as bad AI suggestions, not as a visible bug, which makes it exactly the kind of gap that survives to launch. Scope is capped at the account half of the settings page: profile edit, account email visibility, and password change *for a signed-in user* — recovering a password nobody remembers is `S-08`, a different screen for a user who cannot get in at all. No reminder settings (that is `S-04`'s content on the same route), no notification preferences, no data export, no theme toggle, no account deletion unless the Unknown above resolves toward it.
- **Status:** done — implemented against `context/archive/2026-09-04-account-and-profile-settings/plan.md`. Unknowns resolved during planning (2026-09-04): profile edit embeds inline on `/settings` (no `/profile` retirement); email change is fully built (not read-only), proceeding on whatever mailer is configured now rather than blocking on `password-recovery`'s unfinished production wiring; account deletion resolved as "delete my data" (wipe people/rankings/profile rows) rather than full Supabase Auth user removal, since the latter would need this codebase's first service-role/admin client.

### S-08: Password recovery

- **Outcome:** A user who cannot sign in because they forgot their password can request a reset link from `/auth/signin`, receive it by email, set a new password, and land signed in — without an admin, a support request, or a second account. The signin screen actually offers the route out; today it links only to signup.
- **Change ID:** `password-recovery`
- **PRD refs:** FR-001 ("User can create an account and sign in") — its recovery half. The PRD's Socrates note on FR-001 resolves that login stays mandatory for security and AI-cost reasons; a mandatory login with no recovery path converts one forgotten password into a permanently lost circle of people, which is the same requirement failing quietly.
- **Unlocks:** — (leaf outcome). It does settle who sends the product's *auth* email, which `S-07` inherits if its email-change Unknown resolves toward a real change flow.
- **Prerequisites:** F-03 (the auth screens are already styled on the token layer; this adds two more in the same family)
- **Parallel with:** everything. Unauthenticated, touches no table, no RLS, no ranking — `/auth/*` is outside `middleware.ts`'s `PROTECTED_ROUTES`, so it shares nothing with the app shell or the domain model.
- **Blockers:** —
- **Unknowns:** — (resolved during this slice's plan, `context/changes/password-recovery/plan.md`)
  - ~~Which mailer sends the reset email?~~ Resolved: Supabase Auth's SMTP points at Resend's relay (`smtp.resend.com`), reusing `F-04`'s `RESEND_API_KEY` as the SMTP password. Sending identity is `no-reply@get-in-touch.pl` — a real domain verified in Resend for this slice, not `F-04`'s `onboarding@resend.dev` test sender, closing the "can only deliver to the account owner's own inbox" gap `lessons.md` flagged.
  - ~~Does the reset link land on a page that sets the new password immediately, or on an interstitial first?~~ Resolved: `@supabase/ssr` requires the PKCE flow, so a new `/auth/confirm` route exchanges the token for a session server-side before redirecting to `/auth/reset-password` — no user-visible interstitial click, just a fast redirect chain.
- **Risk:** Technically the smallest slice on the board — two pages, two Supabase Auth calls, one link on `/auth/signin` — and that is exactly why it is easy to leave undone until someone is locked out. The failure mode is unrecoverable from the user's side and total: under `F-01`'s owner-scoped RLS nobody else can reach that user's rows to help, and the account holds the only copy of the relationship data the product exists to keep. Scope is capped at forgotten-password recovery — no magic links, no OAuth providers, no 2FA, no account lockout policy, and no password change for a *signed-in* user (that is `S-07`'s half of the same concern).
- **Status:** done

### S-09: Self-profile rhythm fields

- **Outcome:** User can tell the app how much time they realistically have for their close ones in a week, which ways of reaching out they actually prefer, and when in the week they have space for it — three optional pill-selectors on the existing `/profile` form, stored on `profiles` and available to the ranking prompt.
- **Change ID:** `self-profile-rhythm-fields`
- **PRD refs:** FR-002 (its field set — amended by this slice), FR-007 (the self-profile half of what the hierarchy is computed from), PRD Open Question 2 (self-profile half closed by this slice)
- **Unlocks:** `S-02` — without these three fields the ranking can produce a *who* and a *how urgent*, but has nothing to derive a channel, a weekday/weekend slot, or a realistic session length from, and no cap on how many suggestions one user's week can absorb. They are the whole source of the design's `Twój rytm` factor chip. `S-04`'s reminder copy (`Twój rytm: rozmowa telefoniczna w weekend`) reads the same three columns.
- **Prerequisites:** S-01 (the `profiles` table and the `/profile` form this extends)
- **Parallel with:** F-02, F-04, S-05, S-06, S-08 — touches one table's columns and one form, nothing else.
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low, and deliberately so: the columns are nullable/defaulted and the fields are optional, so nothing that exists today breaks and no user is forced back through a form they already filled. The risk this slice removes is `S-02` being designed around a self-profile that cannot answer *when* or *how* — a shape that is cheap to fix now and expensive once a prompt, a ranking view and a reminder template are all built on it. Note the design's own onboarding (`InTouch.dc.html:87-135`) frames these as step 2 of a 3-step wizard; the wizard is explicitly **not** in scope here — the fields land on the existing single-card `/profile`. Also out of scope: the design's `Push` channel (PRD v2 FR-008 is email-only) and every field on the *person* form, which is the still-open half of Open Question 2.
- **Status:** done

### S-10: Add-person form context fields

- **Outcome:** User adds a person through `/people/new` rendered inside the same persistent app shell as every other authenticated page (not a bare centered card), and the form captures the richer per-person context the design bundle specifies: a short "who are they to you" line, a handful of freeform context tags, and optionally roughly when they last were in touch — closing the still-open per-person half of FR-003.
- **Change ID:** `add-person-context-fields`
- **PRD refs:** FR-003 (its still-open field-set half — the design bundle's `Kim jest dla Ciebie?`, context-tag chips, and `Kiedy ostatnio rozmawialiście?` bucket have no shipped counterpart), Open Roadmap Question 2 (per-person half)
- **Unlocks:** — (leaf outcome; no downstream slice currently depends on these specific fields). It does give `S-02`'s ranking prompt more differentiating context per person than the single `Opis` textarea offers today, and gives `S-03`'s `contact_events` table a second write path beyond the did-it-happen marker, if the last-contact bucket is wired to seed one.
- **Prerequisites:** S-01 (the person + form this amends), F-05 (the app shell `/people/new` currently bypasses), S-03 (`contact_events`, if the last-contact bucket seeds a row — see Unknowns)
- **Parallel with:** S-04, S-05, S-07, S-08 — touches the person-creation form and, optionally, `contact_events`; not the ranking, reminders, or account settings.
- **Blockers:** —
- **Unknowns:**
  - Does `Kim jest dla Ciebie?` replace, split, or supplement the existing single `description` textarea `S-01` shipped? Owner: user, during this slice's plan.
  - Does `Kiedy ostatnio rozmawialiście?` write a real `contact_events` row (and with what `occurred_at` per bucket), or stay purely informational with no schema link? Owner: user, during this slice's plan. Block: no — either answer is legitimate; it changes the migration's shape, not whether the slice can be built.
  - Are the context tags a bounded `text[]` column on `people`, or their own table? Where do they surface afterward — the ranking prompt, the catalog card, the history sheet — and is there a cap? Owner: user, during this slice's plan.
- **Risk:** Low technical risk, contained to one form and, depending on the Unknowns above, one additive migration. The real risk is scope bleed from the same mock section this slice draws from: the mock's `Kategoria` selector is an FR-006 concern that stays parked (organizing into tabs is not this slice's job — `relationship_type`'s fixed enum already covers the categorization half), and the mock's weight scale reads 1–5 while `FR-004`'s own Socrates note already widened the shipped scale to 1–10 deliberately (documented, not a bug) — this slice must not regress it back to match the mock. `S-06`'s retro already flagged this same design file as a draft, not a source of truth, after a near-identical mistake shipped once.
- **Status:** done — shipped `badbb26`…`60bf49e`; impl-reviewed (0 critical, 3 warnings + 3 observations, findings pending triage — see `context/changes/add-person-context-fields/reviews/impl-review.md`)

### S-11: Ranking recency floor

- **Outcome:** User marks a contact as having happened, and the suggested time window moves — every time, in the same direction, for the same input. Marking someone contacted today no longer leaves the card saying "within a month", and three consecutive recomputations of an unchanged input no longer produce three different answers.
- **Change ID:** `ranking-recency-floor`
- **PRD refs:** US-01 ("the hierarchy takes into account time since the last (un)successful contact"), FR-007, FR-009, and the PRD's AI-relevance guardrail — this is the guardrail failing in production, reported by a real tester
- **Unlocks:** — (leaf on the board). It restores the `S-03` loop's payoff: before it, confirming a contact changed nothing the user could see, which is precisely the behaviour that stops people confirming. The two triage items that would *show* and *evidence* what this fixed (stale-reason marking, ranking observability) are in `## Parked`.
- **Prerequisites:** S-03 (the `contact_events` this reads), S-10 (`last_contact_bucket`, the stale field it cuts out of the prompt)
- **Parallel with:** — nothing outstanding. The triage designed this to run beside the sign-out fix (disjoint files: `src/lib/ranking/*` versus `src/components/layout/*`); that one is parked.
- **Blockers:** —
- **Unknowns:** — resolved during this slice's research:
  - ~~Pin the model's randomness with `seed`~~ — `seed` does not exist in the Responses API of `openai@7.8.0`; it is a Chat Completions parameter and `@deprecated` there. The available levers are `temperature`, `top_p` and `reasoning.effort`, which is why the deterministic floor lives in code rather than in a model parameter.
- **Risk:** The diagnosis mattered more than the fix. The tester's own hypothesis ("you've got some increment without checking the date") was wrong — nothing in the code increments a time window; it is chosen wholesale by the model. The screenshot proved the real cause: the prompt handed the model two contradictory facts about the same person three lines apart (`last_contact_bucket`, written only by the person forms and never updated by a `contact_event`, saying "2–6 months ago"; the facts block saying zero days) and the model quoted the stale one. Three of the four fixes only improve the odds — cutting the stale field, and inverting the prompt's hierarchy so recency outranks weight. **Only the deterministic floor applied after the model answers makes the behaviour repeatable**, which is the general lesson: an LLM's output is an input to validate, not a result to store.
- **Status:** done — archived 2026-09-08 → `context/archive/2026-09-08-ranking-recency-floor/`

### S-17: Bring-your-own OpenAI key

- **Outcome:** A signed-in user pastes their own OpenAI API key into `/settings`. From that point every ranking computed for them — including the one behind their reminder emails — is billed to their key, and "Przelicz teraz" has no cap. A user with no key keeps the free tier: the automatic 24-hour refresh stays unlimited, and the manual recompute button is allowed once per calendar day in `Europe/Warsaw`.
- **Change ID:** `byok-openai-key`
- **PRD refs:** FR-001 (amended — cost control now has a second mechanism alongside mandatory login; see the dated note under FR-001), FR-007
- **Unlocks:** — (leaf outcome; no downstream slice currently depends on it)
- **Prerequisites:** F-02 (the OpenAI call path this threads a per-owner key through), S-07 (the `/settings` page this section lands on)
- **Parallel with:** — nothing outstanding on the board at the time this shipped.
- **Blockers:** —
- **Unknowns:** — resolved during this slice's research and at the change's opening (`context/changes/byok-openai-key/change.md`):
  - ~~Where does the ciphertext live, and what encrypts it?~~ AES-GCM in a versioned envelope (`v1:<iv>:<ciphertext>`), keyed by a new Worker secret (`OPENAI_KEY_ENCRYPTION_KEY`), on nullable `profiles` columns — not a new table.
  - ~~What happens on a decryption failure versus a provider rejection?~~ Deliberately asymmetric: a decryption failure (our fault) falls back silently to the app key and the free tier; a provider rejection (the user's key being bad) fails the run outright, with no fallback — collapsing the two would turn a bad key into an unlimited free tier billed to the app.
- **Risk:** Low technical risk, additive migrations throughout (`CLAUDE.md` §Rollback). The real risk this unparks: this is the repo's first cryptographic secret and its first user-submitted credential storage, so the asymmetric-failure design above is what stands between BYOK and quietly reopening the cost-control gap FR-001's mandatory login exists to close.
- **Status:** done — shipped `aa0af08`…`8278213`, five phases. Linear GRA-33.

## Backlog Handoff

| Roadmap ID | Change ID                      | Suggested issue title                                         | Ready for `/10x-plan` | Notes                                                       |
| ---------- | ------------------------------ | ------------------------------------------------------------- | --------------------- | ----------------------------------------------------------- |
| F-01       | `per-user-data-isolation`      | Migration path + default-deny RLS for user-owned data          | done                  | Shipped `c7fd8b5`…`54508d1`; impl-reviewed. Linear GRA-5     |
| F-02       | `openai-ranking-call-path`     | Non-blocking OpenAI call path from the Worker                  | done                  | Shipped `7cbd2b3`…`96e19b6`; plan-reviewed                   |
| F-03       | `design-system-foundation`     | Design tokens + palette, drop the starter theme                | done                  | Shipped `e3a00ab`…`402cafb`. Linear GRA-16                   |
| S-01       | `profile-and-first-people`     | Self-profile + add people with description and weight          | done                  | Shipped `4ac61e6`…`a54295b`; impl-reviewed. Linear GRA-7     |
| S-02       | `ai-contact-hierarchy`         | AI-ranked contact hierarchy with suggested time windows        | done                  | Shipped `c5a73a4`…`0acfa76`; impl-reviewed (0 critical)      |
| S-03       | `did-it-happen-feedback-loop`  | Did-it-happen confirmation feeding the next ranking            | done                  | **North star.** Shipped `ec18164`…`fde184b`; impl-reviewed, review findings F1-F2 closed |
| S-09       | `self-profile-rhythm-fields`   | Self-profile rhythm fields feeding the AI schedule             | done                  | Shipped `adae754`…`a4c7f99`; impl-reviewed. Linear GRA-20 |
| F-04       | `resend-email-delivery-path`   | Send one real email from the Worker on a schedule via Resend   | done                  | Shipped `c7df7e9`…`d34bfbf`; impl-reviewed, production-verified |
| F-05       | `design-alignment-pass`        | App shell (sidebar/bottom-nav) + catalog grid reskin from the finished design | done | Shipped `ab2fded`…`ff28367`. Linear GRA-18                  |
| S-04       | `decay-driven-reminders`       | Decay-driven reminders, at most once per day                   | done                  | Shipped `4cebfee`…`f72b686`; impl-reviewed, production-verified 2026-09-08. Linear GRA-10 |
| S-05       | `person-lifecycle-and-erasure` | Edit, deactivate and irreversibly delete a person              | in progress           | Phases 1–4 shipped (`a41d192`…`8209424`). Phase 5 (erasure verification) outstanding — `verify:erasure` does not exist. Linear GRA-11 |
| S-06       | `landing-page`                 | Public landing page at `/` from the existing design + copy     | done                  | Shipped `edcfa48`…`a01cb9f`. Linear GRA-19                   |
| S-07       | `account-and-profile-settings` | Editable profile + account settings on the `/settings` page    | done                  | Archived → `context/archive/2026-09-04-account-and-profile-settings/`. Linear GRA-23 |
| S-08       | `password-recovery`            | Forgot-password reset flow from the signin screen              | done                  | Archived → `context/archive/2026-09-04-password-recovery/`. Supabase Auth SMTP → Resend, sender `no-reply@get-in-touch.pl`. Linear GRA-24 |
| S-10       | `add-person-context-fields`    | Add-person form: shell nav + richer per-person context fields  | done                  | Shipped `badbb26`…`60bf49e`; impl-reviewed (0 critical, 3 warnings pending triage). Linear GRA-21 |
| F-06       | `product-analytics-posthog`    | PostHog funnel instrumentation for the primary success flow    | done                  | Shipped `5e55410`…`e5cc8b2`; archived 2026-09-08. Linear GRA-22 |
| F-07       | `automated-test-harness`       | Test runner that gates CI + an access boundary proven by tests | in progress           | Phase 1 of 5 shipped (`2026-09-07-testing-runner-and-access-boundary`). Phase tracking lives in `test-plan.md` §3, not here. Linear GRA-26 |
| S-11       | `ranking-recency-floor`        | Time window reacts to a recorded contact, deterministically    | done                  | Triage F-1 (P0). Shipped `b9374ca`…`44fe61b`; archived 2026-09-08. Linear GRA-25 |
| S-17       | `byok-openai-key`              | Own OpenAI key unlocks unlimited recomputes; a daily cap on manual recomputes without one | done | Unparked from `## Parked` → Other. Shipped `aa0af08`…`8278213`, five phases. Linear GRA-33 |

## Open Roadmap Questions

1. ~~**AI-suggestion explainability**~~
   > **Resolved and closed** by `S-02` (`c5a73a4`…`0acfa76`). The hierarchy shows a full `Dlaczego teraz` plus factor chips for the top 3 entries, and one-line collapsed rows with `Rozwiń` below them. The suggested time window is an enum bucket rendered through a Polish label map — never model-authored prose — so the AI-relevance guardrail is checked against a fixed vocabulary rather than free text.
2. ~~**Structured-form fields**~~
   > **Resolved and closed** by `S-10` (`badbb26`…`60bf49e`). The self-profile half closed earlier (`S-01` + `S-09`); the per-person half (FR-003) is now closed too: `Kim jest dla Ciebie?` landed as a new `relationship_context` column (supplementing, not replacing, `description`), the context-tag chip list as a capped `text[]` column surfaced in both the ranking prompt and `PersonCard`, and `Kiedy ostatnio rozmawialiście?` as its own `last_contact_bucket` enum column — deliberately kept informational and never linked to `contact_events` (see the slice's `change.md` for why). `Kategoria` stayed parked (FR-006), as planned.
3. ~~**Reminder cadence**~~
   > **Resolved and closed** by `S-04` (`4cebfee`…`f72b686`). The trigger is an urgency gate — only `this_week` / `two_weeks` entries qualify — plus a 3-day per-user cooldown, with the once-per-day NFR as a ceiling above both. Nothing urgent means silence, not a filler email.
4. ~~**Resend sending identity**~~
   > **Resolved and closed.** The channel closed first (FR-008 reminders are email through Resend, PRD v2, wired in `F-04`). The identity closed in two steps: `F-04` proved the path on `onboarding@resend.dev`, then `S-08` verified the real domain and `S-04` moved production sending to the apex domain (`88380ac`). Auth mail (Supabase SMTP → `smtp.resend.com`) and reminder mail (Worker → Resend API) now share one sending identity, `no-reply@get-in-touch.pl`, as intended.
5. ~~**Reminder email content**~~
   > **Resolved and closed** by `S-04`. One hero person with a `Dlaczego akurat teraz` factor list plus a two-line `W kolejce` teaser — "jeden mail, jedna osoba, jedno wezwanie". A digest was rejected precisely because it is read and dismissed without ever feeding the `S-03` loop.
6. ~~**Palette direction**~~
   > **Resolved and closed** by `F-03`. The `S-06` design bundle's warm/personal palette was adopted wholesale into `src/styles/global.css`; `S-06` later confirmed the page needed no tokens of its own.
7. ~~**Dark mode in the MVP**~~
   > **Resolved and closed** by `F-03`: light-only. `src/styles/global.css` defines no `.dark` block, so the accidental three-way split described in `## Baseline` is gone.
8. ~~**Landing page legal/contact placeholders and CTA target**~~
   > **Resolved and closed** by `S-06` (`edcfa48`…`a01cb9f`). Nav links are on-page scroll anchors; the footer's Prywatność / Regulamin / Kontakt row was dropped rather than pointed at pages that do not exist. All three primary CTAs route to `/auth/signup`; the hero's secondary CTA scrolls to how-it-works. **Still open as follow-on work, not as a roadmap question:** no privacy policy, terms or contact page exists, and the landing page should not be promoted to strangers until at least a privacy policy does.
9. ~~**Account-level deletion and email change**~~
   > **Resolved and closed** by `S-07` (2026-09-04). Email change is fully built, not read-only. Account deletion resolved as **"delete my data"** — a wipe of the user's people, rankings and profile rows — rather than removal of the Supabase Auth user, since the latter would need this codebase's first service-role admin client. `S-04` later introduced exactly such a client (`src/lib/supabase-admin.ts`) for the sweep, so full account deletion is now cheaper than it was when this was decided; it stays out of scope until someone asks for it.
10. ~~**Who sends the product's auth emails**~~
    > **Resolved and closed** by `S-08`. Supabase Auth's SMTP points at `smtp.resend.com`, reusing `F-04`'s `RESEND_API_KEY` as the SMTP password, sending as `no-reply@get-in-touch.pl`. Still two channels, one vendor and one identity: reminder mail leaves the Worker through Resend's API, auth mail leaves Supabase through Resend's relay.

11. ~~**What an analytics event may carry, and where it is stored**~~
    > **Resolved and closed** by `F-06` (`5e55410`…`e5cc8b2`). Events go through one typed, consent-aware wrapper in `src/lib/analytics/`, keyed by the Supabase user id, with a documented event catalog and an opt-out control on `/settings`. No person's name, description, `relationship_context`, tags or email leaves the app.

12. **Does a one-person circle deserve a different screen?** — The tester's production account held exactly one person, and the dashboard banner said "based on 1 person". At that size the *ordering* — the product's central claim — carries no information at all, and every bit of value sits in the time window and the explanation, which is exactly what `S-11` had to repair. Is the answer an onboarding nudge to add more people, a different empty-ish state below some threshold, or nothing at all? Owner: user. Block: nothing — but it changes what a first-run user concludes about whether the product works.

13. **Who proves erasure — `S-05` Phase 5 or `F-07` Phase 2?** — Both are chartered to prove the same binary NFR ("deleting a person's data is fully and irreversibly honored"): `S-05`'s outstanding phase specifies a `npm run verify:erasure` script, and `test-plan.md` §3 Phase 2 specifies integration tests for erasure and lifecycle. Building both means maintaining two proofs of one guarantee, and the failure mode is that each assumes the other covers it. Owner: user, before `S-05` closes. Block: `S-05`'s last phase — it is the only thing between that slice and done.

## Parked

### From the 2026-09-08 tester-feedback triage

The `S-11` fix (the reported bug) shipped. These five were the triage's remaining
findings; they are recorded here rather than sequenced on the board. Full diagnosis,
evidence and acceptance criteria for each stay in
`context/changes/feedback-triage-2026-09-08/triage.md` — parking them costs nothing,
because that document is the real source and it is not going anywhere.

- **Sign-out placement (`signout-placement`, triage F-2)** — Move sign-out off the mobile bottom bar (five tiles today, the fifth logs you out on a mis-tap with no confirmation) into `/settings`. Why parked: a usability complaint on a bar the author is not mis-tapping, on a product whose only users are the author and one tester. Revisit before anyone else is invited in — it is the cheapest item on this list and `BottomNav.astro:37-43` already admits in a comment that the tile is not in the mock.
- **Stale-reason marking (`stale-reason-marking`, triage F-3)** — Mark a card's frozen `Dlaczego teraz` prose as predating the user's last answer, instead of rendering it beside a live chip that contradicts it. Why parked: `S-11` removed the cause that made the contradiction routine (the stale `last_contact_bucket` reaching the prompt). What remains is the narrower window where a stored ranking is simply older than an answer — real, but no longer the screen lying about the common case. Revisit if a user reports the contradiction again post-`S-11`.
- **Ranking observability (`ranking-observability`, triage F-4)** — Snapshot `days_since_last_happened` / `failed_attempts_since_last_happened` per `ranking_entries` row, plus a `[ranking]` log line. Why parked: diagnostic capacity, not user-visible behaviour. Worth knowing what it buys — the last production report was diagnosable only because the model happened to quote its own stale input in prose visible on a screenshot. The next one may not be. Revisit at the next "it isn't working" that the database cannot answer.
- **Ranking invalidation on mark (`ranking-invalidation-on-mark`, triage F-5)** — Marking a contact invalidates the current order, so the next `/dashboard` visit recomputes instead of waiting out the flat 24 h in `store.ts:7`. Why parked: it depends on the observability item above (without the fact snapshot there is nothing to verify the invalidation against), and it is the one item that can raise the OpenAI bill per active user — an automatic recompute per marked contact. Price it against `F-06`'s funnel before unparking.
- **Contact-event backdating (`contact-event-backdating`, triage F-6)** — A date field on the contact-event form, defaulting to today, validated server-side as not in the future. Why parked: the only triage item the tester did not actually hit — found while reading the code around what he did. `occurred_at` carries `default now()`, so today the marker can only mean *now*. Note for whoever unparks it: a future-dated event would poison the recency floor `S-11` installed, so the bound belongs on the server, not only in the picker.

### Other

- **Access-boundary hardening (`access-boundary-followups`)** — The three gaps `F-07`'s Phase 1 found and deliberately left alone: `AiJob` records carry no owner (`src/lib/ai-jobs.ts:10-16`), the two FK lookups in `POST /api/contact-events` have no owner filter, and the four protected page routes have no assertions on their own data reads. Why parked: **neither code gap breaches the privacy NFR today** — RLS covers both — so this is missing *redundancy*, not a hole, and Phase 1's suite already pins the current behaviour so nothing can change silently. A change folder is open at `context/changes/access-boundary-followups/` with the full write-up. Two things for whoever unparks it: the `AiJob` owner field must ship forward-compatibly (KV records in flight carry a one-hour TTL, and `CLAUDE.md`'s rollback rule applies to them as it does to migrations), and the comment in `tests/routes/cross-owner.test.ts` explaining why those two FK paths skip the mismatch instrument must be revisited once the filter lands.
- **Categories / tabs for organizing people (FR-006)** — Why parked: nice-to-have in the PRD, purely organizational, does not touch the AI logic. Under `main_goal: speed` it is not on the must-have path.
- **Application-level error tracking / logging library** — Why parked: Workers platform observability is already enabled; adding a vendor is maintenance cost the 3-week after-hours budget does not have. Revisit if `S-02`'s ranking quality becomes hard to debug from platform logs alone. Note `F-06` brings a vendor (PostHog) into the app for *product analytics*; whether its error-tracking or session-replay products are also switched on stays parked here and is explicitly out of `F-06`'s scope — session replay in particular would record screens full of third-party personal data.
- **Calendar integration** — Why parked: PRD §Non-Goals, deferred to v2. Reminders concern weakening relationships, not same-day events.
- **Native mobile app** — Why parked: PRD §Non-Goals; the MVP is web-only.
- **Event / meeting scheduling** — Why parked: PRD §Non-Goals. The app suggests a time window; the user initiates contact themselves.
- **Photos of people** — Why parked: PRD §Non-Goals. Also why the Cloudflare adapter runs with `imageService: "compile"` and no Images binding.
- **Automatic contact detection (phone / address book scan)** — Why parked: PRD §Non-Goals; people are added manually.
- **Social network / shared graph** — Why parked: PRD §Non-Goals. This is a private personal tool.
- **Chat or messaging on the user's behalf** — Why parked: PRD §Non-Goals; the user reaches out through their own channels.
- **Gamification (points, streaks, badges)** — Why parked: PRD §Non-Goals.

## Done

- **F-01: (foundation) migrations + default-deny RLS + a proof of isolation** — Archived 2026-09-04 → `context/archive/2026-08-23-per-user-data-isolation/`. Lesson: —.
- **S-01: fill a self-profile and add people with a weight, and see them** — Archived 2026-09-04 → `context/archive/2026-08-29-profile-and-first-people/`. Lesson: —.
- **S-09: tell the app their own contact rhythm (time budget, channels, slots) so suggestions land in it** — Archived 2026-09-04 → `context/archive/2026-08-31-self-profile-rhythm-fields/`. Lesson: —.
- **S-02: see a ranked "who to reconnect with" list with time windows** — Archived 2026-09-04 → `context/archive/2026-09-01-ai-contact-hierarchy/`. Lesson: —.
- **F-04: (foundation) the Worker can send a real email on a schedule** — Archived 2026-09-04 → `context/archive/2026-09-02-resend-email-delivery-path/`. Lesson: —.
- **S-08: A user who cannot sign in because they forgot their password can request a reset link from `/auth/signin`, receive it by email, set a new password, and land signed in — without an admin, a support request, or a second account. The signin screen actually offers the route out; today it links only to signup.** — Archived 2026-09-04 → `context/archive/2026-09-04-password-recovery/`. Lesson: —.
- **F-03: (foundation) one token layer the screens actually use, no starter theme** — Archived 2026-09-04 → `context/archive/2026-08-22-design-system-foundation/`. Lesson: —.
- **F-02: (foundation) the Worker can call OpenAI without blocking the user** — Archived 2026-09-04 → `context/archive/2026-08-26-openai-ranking-call-path/`. Lesson: —.
- **F-05: (foundation) persistent nav shell (sidebar/bottom-bar) + catalog grid reskin, matching the finished design** — Archived 2026-09-04 → `context/archive/2026-08-30-design-alignment-pass/`. Lesson: —.
- **S-06: see a real marketing page at `/` explaining what InTouch is, before signing in** — Archived 2026-09-04 → `context/archive/2026-09-01-landing-page/`. Lesson: —.
- **S-03: confirm whether a contact happened and see the ranking react** — Archived 2026-09-04 → `context/archive/2026-09-02-did-it-happen-feedback-loop/`. Lesson: —.
- **S-07: edit their own profile after first fill and manage their account from `/settings`** — Archived 2026-09-04 → `context/archive/2026-09-04-account-and-profile-settings/`. Lesson: —.
- **S-10: add a person through a form inside the app shell, with richer per-person context (who they are, freeform tags, roughly when last in touch)** — Archived 2026-09-04 → `context/archive/2026-09-04-add-person-context-fields/`. Lesson: —.
- **S-04: be reminded, unprompted, about relationships going quiet** — Archived 2026-09-08 → `context/archive/2026-09-08-decay-driven-reminders/`. Lesson: —.
- **F-06: (foundation) the PRD's primary funnel is measurable end to end: each step a user completes — signed up, self-profile filled, first person added, hierarchy generated, suggestion confirmed as done — emits one named event to PostHog through a single typed wrapper in `src/lib/analytics/`, keyed by the Supabase user id and nothing else.** — Archived 2026-09-08 → `context/archive/2026-09-04-product-analytics-posthog/`. Lesson: —.
- **F-07 (phase 1 of 5): (foundation) a test runner that starts under the Cloudflare adapter, and an access boundary proven by tests** — Archived 2026-09-08 → `context/archive/2026-09-07-testing-runner-and-access-boundary/`. Lesson: a green test can prove nothing — `delete-data.test.ts` passed with the route's owner filter deleted, because the connection and the claimed identity matched and RLS satisfied the assertion alone. Verify cross-owner tests by mutation.
- **S-11: trust that marking a contact actually moves the suggested time window, deterministically** — Archived 2026-09-08 → `context/archive/2026-09-08-ranking-recency-floor/`. Lesson: an LLM's output is an input to validate, not a result to store — prompt fixes improve the odds, only the deterministic floor applied after the answer makes behaviour repeatable.
- **S-05: User can edit a person, deactivate them so the AI stops considering them while their contact history is retained, and — only after deactivation — delete them permanently.** — Archived 2026-09-08 → `context/archive/2026-09-04-person-lifecycle-and-erasure/`. Lesson: a test that re-states the code's own filter stays green when that filter is deleted — extract the query into a named function so the test calls the app's oracle instead of a copy of it; and erasure spans every table with the FK, whose correct post-delete state is not always "gone" (`reminder_sends` is SET NULL by design, so the row must survive carrying no name).
- **S-17: A signed-in user pastes their own OpenAI API key into `/settings`. From that point every ranking computed for them — including the one behind their reminder emails — is billed to their key, and "Przelicz teraz" has no cap. A user with no key keeps the free tier: the automatic 24-hour refresh stays unlimited, and the manual recompute button is allowed once per calendar day in `Europe/Warsaw`.** — Archived 2026-09-11 → `context/archive/2026-09-09-byok-openai-key/`. Lesson: —.
