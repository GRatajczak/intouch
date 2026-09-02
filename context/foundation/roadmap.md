---
project: "InTouch"
version: 2
status: draft
created: 2026-08-15
updated: 2026-09-02
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
| F-04 | `resend-email-delivery-path` | (foundation) the Worker can send a real email on a schedule       | —             | FR-008, NFR-email-channel      | ready    |
| F-05 | `design-alignment-pass`      | (foundation) persistent nav shell (sidebar/bottom-bar) + catalog grid reskin, matching the finished design | F-03, S-01 | NFR-browser (mobile usability) | done      |
| S-01 | `profile-and-first-people`   | fill a self-profile and add people with a weight, and see them    | F-01, F-03    | FR-001, FR-002, FR-003, FR-004 | done      |
| S-02 | `ai-contact-hierarchy`       | see a ranked "who to reconnect with" list with time windows       | S-01, F-02, S-09 | US-01, FR-007               | done        |
| S-03 | `did-it-happen-feedback-loop`| confirm whether a contact happened and see the ranking react      | S-02          | US-01, FR-009                  | ready    |
| S-04 | `decay-driven-reminders`     | be reminded, unprompted, about relationships going quiet          | S-03, F-04    | FR-008, NFR-once-per-day       | blocked  |
| S-05 | `person-lifecycle-and-erasure`| edit, deactivate and permanently delete a person                  | S-01          | FR-005, NFR-privacy            | ready    |
| S-06 | `landing-page`                | see a real marketing page at `/` explaining what InTouch is, before signing in | F-03          | Access Control ("unauthenticated visitor") | done |
| S-07 | `account-and-profile-settings` | edit their own profile after first fill and manage their account from `/settings`       | S-01, F-05    | FR-001, FR-002, FR-008 (address), Access Control | proposed |
| S-08 | `password-recovery`           | get back into their account after forgetting the password         | F-03          | FR-001                         | proposed |
| S-09 | `self-profile-rhythm-fields`  | tell the app their own contact rhythm (time budget, channels, slots) so suggestions land in it | S-01          | FR-002, FR-007                 | done |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                     | Chain                                | Note                                                                                          |
| ------ | ------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| A      | The loop                  | `F-01` + `F-03` → `S-01` → `S-09` → `S-02` → `S-03` | The must-have path — the shortest chain of `must-have` requirements that reaches the north star, with nothing optional in it. Under `main_goal: speed`, nothing outranks this chain. |
| B      | AI call path              | `F-02`                               | Runs in parallel with `F-01`/`S-01`; joins Stream A at `S-02`.                                 |
| C      | Data lifecycle & erasure  | `S-05`                               | Branches off `S-01`, runs parallel to `S-02`/`S-03`. Carries the binary privacy NFR.           |
| D      | Proactive reminders       | `F-04` → `S-04`                      | `F-04` is unblocked and can start now; `S-04` still waits on the cadence decision.             |
| E      | Visual foundation         | `F-03` → `F-05`                      | Runs in parallel with `F-01`/`F-02`; joins Stream A at `S-01`, the first slice that renders product screens. `F-05` follows once `S-01` ships, since its shell needs real people/profile data to show. |
| F      | Public landing page       | `F-03` → `S-06`                      | Parallel with everything else once `F-03` lands. A leaf outcome — nothing downstream depends on it; it's the first thing a visitor meets, not a foundation for anything. |
| G      | Account & credentials     | `F-05` → `S-07`; `F-03` → `S-08`     | Two independent branches on the same theme. `S-07` fills the `/settings` stub `F-05` created — its account half; the reminder half of that page belongs to `S-04`, so those two meet on one route without depending on each other. `S-08` is unauthenticated and shares nothing but Supabase Auth, so it needs neither `S-01` nor the shell. |

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
- **Status:** ready

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
- **Status:** ready

### S-04: Decay-driven reminders

- **Outcome:** User is reminded by email, without opening the app, about relationships that have gone quiet — at most once a day, in the order the hierarchy proposes.
- **Change ID:** `decay-driven-reminders`
- **PRD refs:** FR-008, NFR "reminders reach the user at most once per day, and address relationship decay — not same-day calendar events", NFR "reminders are delivered by email … through Resend"
- **Prerequisites:** S-03, F-04
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:**
  - How often do reminders fire without becoming spam users mute? The once-per-day NFR is a ceiling, not the trigger rule; the decay-driven trigger logic is unresolved. Owner: user. Block: yes.
  - What does one reminder email actually contain — the single most urgent person, the top few, or the whole hierarchy? Decides whether the email pulls the user into the app (feeding the `S-03` confirmation loop) or is a digest they dismiss without opening it. Owner: user. Block: no — affects the template, not whether the slice can be built. Routed from PRD Open Question 4.
  - How does a scheduled sweep, which runs with no signed-in user, read across users' rows without defeating `F-01`'s owner-scoped RLS? Owner: resolved during this slice's plan. Block: no.
- **Risk:** Still blocked, but on one decision rather than two — the delivery channel is now settled (email via Resend, PRD v2) and its wiring is lifted into `F-04`, which can proceed immediately and in parallel. What remains is the cadence rule, a one-sitting decision rather than research; resolving it promotes this slice. Deliberately not sequenced earlier despite being the vision's most distinctive promise ("the app decides on your behalf"), because under `top_blocker: time` the scheduled-sweep infrastructure is worth paying for only once the loop it drives is proven. Its sharpest technical risk is the RLS unknown above: this is the first code in the repo that acts on behalf of users who are not present, and a sweep that reaches for a service-role key to get the job done would quietly undo the guarantee `F-01` exists to establish.
- **Status:** blocked

### S-05: Person lifecycle and erasure

- **Outcome:** User can edit a person, deactivate them so the AI stops considering them while their contact history is retained, and — only after deactivation — delete them permanently.
- **Change ID:** `person-lifecycle-and-erasure`
- **PRD refs:** FR-005, NFR "deleting a person's data is fully and irreversibly honored" (binary; GDPR-adjacent)
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Carries the second half of the privacy NFR, which is binary — partial deletion is a failure, not a smaller success. The deactivate-before-delete rule exists because deleting a person otherwise destroys the contact history feeding the ranking, so the two paths must not be collapsed into one "remove" action for speed. Fully parallel with the Stream A chain: it touches the same tables but none of the ranking logic, which under `top_blocker: time` makes it the natural candidate for a separate agent run.
- **Status:** ready

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
- **Status:** proposed

### S-08: Password recovery

- **Outcome:** A user who cannot sign in because they forgot their password can request a reset link from `/auth/signin`, receive it by email, set a new password, and land signed in — without an admin, a support request, or a second account. The signin screen actually offers the route out; today it links only to signup.
- **Change ID:** `password-recovery`
- **PRD refs:** FR-001 ("User can create an account and sign in") — its recovery half. The PRD's Socrates note on FR-001 resolves that login stays mandatory for security and AI-cost reasons; a mandatory login with no recovery path converts one forgotten password into a permanently lost circle of people, which is the same requirement failing quietly.
- **Unlocks:** — (leaf outcome). It does settle who sends the product's *auth* email, which `S-07` inherits if its email-change Unknown resolves toward a real change flow.
- **Prerequisites:** F-03 (the auth screens are already styled on the token layer; this adds two more in the same family)
- **Parallel with:** everything. Unauthenticated, touches no table, no RLS, no ranking — `/auth/*` is outside `middleware.ts`'s `PROTECTED_ROUTES`, so it shares nothing with the app shell or the domain model.
- **Blockers:** —
- **Unknowns:**
  - Which mailer sends the reset email? Supabase's built-in mailer is rate-limited and documented as unsuitable for production, and `supabase/config.toml` has `[auth.email.smtp]` commented out — so making this reliable likely means pointing Supabase Auth's SMTP at **Resend**, the provider `F-04` is already standing up for FR-008. Same vendor, different channel: Supabase Auth sends these, not the Worker, so `F-04`'s code path is not reused — only its account and its sending identity are. Owner: user, during this slice's plan. Block: no — but it is the item worth checking against `F-04`'s sending-identity decision (Open Question 4) so the two do not settle on different senders.
  - Does the reset link land on a page that sets the new password immediately (Supabase establishes a recovery session from the token in the URL), or on an interstitial first? Owner: resolved during this slice's plan. Block: no.
- **Risk:** Technically the smallest slice on the board — two pages, two Supabase Auth calls, one link on `/auth/signin` — and that is exactly why it is easy to leave undone until someone is locked out. The failure mode is unrecoverable from the user's side and total: under `F-01`'s owner-scoped RLS nobody else can reach that user's rows to help, and the account holds the only copy of the relationship data the product exists to keep. The real risk in the slice is the mailer above: a reset flow that "works" on Supabase's default mailer can start silently dropping mail under its rate limits, which looks identical to a user mistyping their address. Scope is capped at forgotten-password recovery — no magic links, no OAuth providers, no 2FA, no account lockout policy, and no password change for a *signed-in* user (that is `S-07`'s half of the same concern).
- **Status:** proposed

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

## Backlog Handoff

| Roadmap ID | Change ID                      | Suggested issue title                                         | Ready for `/10x-plan` | Notes                                                       |
| ---------- | ------------------------------ | ------------------------------------------------------------- | --------------------- | ----------------------------------------------------------- |
| F-01       | `per-user-data-isolation`      | Migration path + default-deny RLS for user-owned data          | done                  | Shipped `c7fd8b5`…`54508d1`; impl-reviewed. Linear GRA-5     |
| F-02       | `openai-ranking-call-path`     | Non-blocking OpenAI call path from the Worker                  | done                  | Shipped `7cbd2b3`…`96e19b6`; plan-reviewed                   |
| F-03       | `design-system-foundation`     | Design tokens + palette, drop the starter theme                | done                  | Shipped `e3a00ab`…`402cafb`. Linear GRA-16                   |
| S-01       | `profile-and-first-people`     | Self-profile + add people with description and weight          | done                  | Shipped `4ac61e6`…`a54295b`; impl-reviewed. Linear GRA-7     |
| S-02       | `ai-contact-hierarchy`         | AI-ranked contact hierarchy with suggested time windows        | done                  | Shipped `c5a73a4`…`0acfa76`; impl-reviewed (0 critical)      |
| S-03       | `did-it-happen-feedback-loop`  | Did-it-happen confirmation feeding the next ranking            | yes                   | **North star.** S-02 done — unblocked. Next on Stream A      |
| S-09       | `self-profile-rhythm-fields`   | Self-profile rhythm fields feeding the AI schedule             | done                  | Shipped `adae754`…`a4c7f99`; impl-reviewed. Linear GRA-20 |
| F-04       | `resend-email-delivery-path`   | Send one real email from the Worker on a schedule via Resend   | yes                   | Parallel with F-01/F-02/F-03; start the sending domain first  |
| F-05       | `design-alignment-pass`        | App shell (sidebar/bottom-nav) + catalog grid reskin from the finished design | done | Shipped `ab2fded`…`ff28367`. Linear GRA-18                  |
| S-04       | `decay-driven-reminders`       | Decay-driven reminders, at most once per day                   | no                    | Needs S-03 and F-04. Blocked: reminder cadence undecided      |
| S-05       | `person-lifecycle-and-erasure` | Edit, deactivate and irreversibly delete a person              | yes                   | S-01 done — unblocked; runs parallel to the whole Stream A chain |
| S-06       | `landing-page`                 | Public landing page at `/` from the existing design + copy     | done                  | Shipped `edcfa48`…`a01cb9f`. Linear GRA-19                   |
| S-07       | `account-and-profile-settings` | Editable profile + account settings on the `/settings` page    | yes                   | S-01 and F-05 done — unblocked. Replaces the stub's placeholder copy |
| S-08       | `password-recovery`            | Forgot-password reset flow from the signin screen              | yes                   | F-03 done — unblocked. Check the mailer against F-04's sender   |

## Open Roadmap Questions

1. ~~**AI-suggestion explainability**~~
   > **Resolved and closed** by `S-02` (`c5a73a4`…`0acfa76`). The hierarchy shows a full `Dlaczego teraz` plus factor chips for the top 3 entries, and one-line collapsed rows with `Rozwiń` below them. The suggested time window is an enum bucket rendered through a Polish label map — never model-authored prose — so the AI-relevance guardrail is checked against a fixed vocabulary rather than free text.
2. **Structured-form fields** — the exact fields for the self-profile (FR-002) and the per-person form (FR-003) are not pinned. Owner: user, during design. Block: `S-01`.
3. **Reminder cadence** — how frequently reminders fire without becoming spam users mute. Bounded by the once-per-day NFR, but the decay-driven trigger logic is unresolved. Owner: user, during design. Block: `S-04`.
4. **Resend sending identity** — an owned domain (DNS records plus a verification wait nobody can compress) or Resend's `onboarding@resend.dev` test sender (instant, but delivers only to the account owner's own address). Owner: user, during `F-04`'s plan. Block: `F-04` — not hard-blocking (F-04 is `ready`), but it is the longest-lead item on the board, so start it before writing any reminder code. Whatever identity is chosen also serves the auth emails in Open Question 10, so decide it once.
   > Resolved and closed: **reminder delivery channel**. FR-008 reminders are email, sent through Resend (PRD v2). The wiring lives in `F-04`; what remains open is only the sending identity above.
5. **Reminder email content** — one email per most-urgent person, a top-few, or the whole hierarchy? Decides whether the email pulls the user back into the app to close the FR-009 loop or is a digest they read and dismiss. Owner: user, during design. Block: `S-04` — not hard-blocking; affects the email's template, not whether the slice can be built.
6. **Palette direction** — warm and personal versus neutral-utility (shadcn's current `baseColor: neutral`). The PRD never describes a visual character, and the repo's current look is the starter's, not the product's. Owner: user, during design. Block: `F-03`. The `S-06` landing design (`.ai/intouch-design-preparation/`) already proposes a concrete warm/personal palette and type scale — a candidate answer to confirm or reject during `F-03`'s plan, not a foregone conclusion.
7. **Dark mode in the MVP** — light-only, dark-only, or both with a toggle. Today all three states are partly present and none is chosen (see `## Baseline`). Owner: user, during design. Block: `F-03`. The `S-06` landing design is light-only with no `.dark` variant — a data point toward light-only, not a decision by itself.
8. ~~**Landing page legal/contact placeholders and CTA target**~~
   > **Resolved and closed** by `S-06` (`edcfa48`…`a01cb9f`). Nav links are on-page scroll anchors; the footer's Prywatność / Regulamin / Kontakt row was dropped rather than pointed at pages that do not exist. All three primary CTAs route to `/auth/signup`; the hero's secondary CTA scrolls to how-it-works. **Still open as follow-on work, not as a roadmap question:** no privacy policy, terms or contact page exists, and the landing page should not be promoted to strangers until at least a privacy policy does.
9. **Account-level deletion and email change** — may a user delete their whole account (and with it every person they entered), and can they change the email their account and its FR-008 reminders hang off? The PRD's irreversible-deletion NFR is written about a *person* (`S-05`), never about an account, and an email change in Supabase is a re-verification round trip rather than a field update. Owner: user, during `S-07`'s plan. Block: `S-07` — not hard-blocking; read-only email and no self-serve account deletion are legitimate MVP answers, but they should be decisions rather than omissions.
10. **Who sends the product's auth emails** — Supabase's built-in mailer (rate-limited, documented as not for production; `[auth.email.smtp]` is commented out in `supabase/config.toml`) or Supabase Auth pointed at **Resend**, the provider `F-04` already stands up for FR-008. Note these are two channels, not one path: reminder mail leaves the Worker, auth mail leaves Supabase — they share a vendor and a sending identity, not code. Owner: user, during `S-08`'s plan, cross-checked against Open Question 4. Block: `S-08` — not hard-blocking; the built-in mailer is enough to prove the flow, just not to rely on it.

## Parked

- **Categories / tabs for organizing people (FR-006)** — Why parked: nice-to-have in the PRD, purely organizational, does not touch the AI logic. Under `main_goal: speed` it is not on the must-have path.
- **Application-level error tracking / logging library** — Why parked: Workers platform observability is already enabled; adding a vendor is maintenance cost the 3-week after-hours budget does not have. Revisit if `S-02`'s ranking quality becomes hard to debug from platform logs alone.
- **User-supplied OpenAI API key ("bring your own key")** — Why parked: the MVP runs on the author's single key in Workers Secrets (`F-02`), and that is also what keeps AI spend under the app's control — the exact reason the PRD makes login mandatory in FR-001. Accepting a user's own key turns a secret the app owns into user-submitted credential storage: encryption at rest, rotation, revocation, and a real error path for the day someone's key hits its quota — none of which buys anything while the only user is the author. Revisit if AI cost per user becomes the thing limiting who can be invited; `S-07`'s settings page is where it would land.
- **Calendar integration** — Why parked: PRD §Non-Goals, deferred to v2. Reminders concern weakening relationships, not same-day events.
- **Native mobile app** — Why parked: PRD §Non-Goals; the MVP is web-only.
- **Event / meeting scheduling** — Why parked: PRD §Non-Goals. The app suggests a time window; the user initiates contact themselves.
- **Photos of people** — Why parked: PRD §Non-Goals. Also why the Cloudflare adapter runs with `imageService: "compile"` and no Images binding.
- **Automatic contact detection (phone / address book scan)** — Why parked: PRD §Non-Goals; people are added manually.
- **Social network / shared graph** — Why parked: PRD §Non-Goals. This is a private personal tool.
- **Chat or messaging on the user's behalf** — Why parked: PRD §Non-Goals; the user reaches out through their own channels.
- **Gamification (points, streaks, badges)** — Why parked: PRD §Non-Goals.

## Done

(Empty on first generation — `/10x-archive` is this section's only writer.)
