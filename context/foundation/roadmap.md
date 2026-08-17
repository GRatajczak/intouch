---
project: "InTouch"
version: 1
status: draft
created: 2026-08-15
updated: 2026-08-15
prd_version: 1
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
| F-01 | `per-user-data-isolation`    | (foundation) migrations + default-deny RLS + a proof of isolation | —             | NFR-privacy, Access Control    | ready    |
| F-02 | `openai-ranking-call-path`   | (foundation) the Worker can call OpenAI without blocking the user | —             | FR-007, NFR-non-blocking       | ready    |
| S-01 | `profile-and-first-people`   | fill a self-profile and add people with a weight, and see them    | F-01          | FR-001, FR-002, FR-003, FR-004 | proposed |
| S-02 | `ai-contact-hierarchy`       | see a ranked "who to reconnect with" list with time windows       | S-01, F-02    | US-01, FR-007                  | proposed |
| S-03 | `did-it-happen-feedback-loop`| confirm whether a contact happened and see the ranking react      | S-02          | US-01, FR-009                  | proposed |
| S-04 | `decay-driven-reminders`     | be reminded, unprompted, about relationships going quiet          | S-03          | FR-008, NFR-once-per-day       | blocked  |
| S-05 | `person-lifecycle-and-erasure`| edit, deactivate and permanently delete a person                  | S-01          | FR-005, NFR-privacy            | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                     | Chain                                | Note                                                                                          |
| ------ | ------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| A      | The loop                  | `F-01` → `S-01` → `S-02` → `S-03`    | The must-have path — the shortest chain of `must-have` requirements that reaches the north star, with nothing optional in it. Under `main_goal: speed`, nothing outranks this chain. |
| B      | AI call path              | `F-02`                               | Runs in parallel with `F-01`/`S-01`; joins Stream A at `S-02`.                                 |
| C      | Data lifecycle & erasure  | `S-05`                               | Branches off `S-01`, runs parallel to `S-02`/`S-03`. Carries the binary privacy NFR.           |
| D      | Proactive reminders       | `S-04`                               | Blocked on two decisions (cadence, delivery channel) before it is plannable at all.            |

## Baseline

What's already in place in the codebase as of `2026-08-15` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind v4 + shadcn/ui; `src/layouts/Layout.astro`, `src/components/ui/button.tsx`, auth forms under `src/components/auth/`.
- **Backend / API:** partial — `output: "server"` with API routes for auth only (`src/pages/api/auth/{signin,signup,signout}.ts`). No domain endpoints yet.
- **Data:** partial — `@supabase/ssr` client wired in `src/lib/supabase.ts`, but `supabase/` holds only `config.toml` (with the starter's default `project_id = "10x-astro-starter"`). No `supabase/migrations/`, no schema, no generated DB types, no RLS.
- **Auth:** present — Supabase cookie-based auth; signup / signin / signout / confirm-email routes, `src/middleware.ts` guards `/dashboard`, `App.Locals.user` typed in `src/env.d.ts`. FR-001's *authentication* half is done; its *data-ownership* half has nothing to own yet.
- **Deploy / infra:** present — Cloudflare Workers (`wrangler.jsonc`), GitHub Actions `ci.yml` + `deploy.yml`, production live at `https://intouch.g-ratajczak97.workers.dev`.
- **Observability:** partial — Workers platform observability enabled in `wrangler.jsonc`; no application-level error tracking or logging library. Deliberately left as-is (see `## Parked`).
- **AI provider:** decided but unwired — OpenAI, API key already held by the user. No SDK in `package.json`, no secret bound.
- **Scheduling / delivery:** absent — no `triggers.crons` in `wrangler.jsonc`, no email or push channel. Blocks FR-008.

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
- **Status:** ready

### F-02: OpenAI call path from the Worker

- **Outcome:** (foundation) the Worker can make a server-side OpenAI call with the key arriving through `astro:env/server`, the request shape does not block the user's view while it runs, and the path has been checked against Cloudflare's production limits rather than only against `astro dev`.
- **Change ID:** `openai-ranking-call-path`
- **PRD refs:** FR-007, NFR "generating the AI hierarchy never blocks the user: they may leave or close the view while it runs, and are notified when the result is ready"
- **Unlocks:** `S-02` — the ranking slice cannot be planned until the non-blocking generation shape is settled. Also reduces the "will this survive the Workers runtime?" unknown recorded in `context/foundation/lessons.md`.
- **Prerequisites:** —
- **Parallel with:** F-01, S-01
- **Blockers:** — (OpenAI chosen; the user already holds the API key, so nothing external is pending)
- **Unknowns:**
  - What is the non-blocking generation shape — deferred work with a "ready" notification, or an in-view async state the user may navigate away from? Owner: user, during F-02's plan. Block: no — resolving this *is* the work of this foundation.
- **Risk:** Sequenced here because `lessons.md` already records that a fast local `astro dev` run proves nothing about the Workers free-tier ceilings, and an LLM call is exactly the kind of per-request work that finds them. Discovering this inside `S-02` would invalidate that slice's whole design rather than just its plan. Scope is capped at one proven call path plus the secret in all three places (`.dev.vars`, `wrangler secret`, GitHub Secrets) — not a prompt, not a ranking, not a schema.
- **Status:** ready

## Slices

### S-01: Profile and first people

- **Outcome:** User can fill a short structured self-profile, add people with a structured description, a single-vs-collective marker and a 1–5 relationship weight, and see them listed as their own private circle.
- **Change ID:** `profile-and-first-people`
- **PRD refs:** FR-001 (its data-ownership half — a user's people belong to their account), FR-002, FR-003, FR-004
- **Prerequisites:** F-01
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:**
  - Exact fields for the self-profile (FR-002) and the per-person form (FR-003) are not pinned in the PRD. Owner: user, during this slice's plan. Block: no — the plan step must propose a concrete field set and get it confirmed before building; it is not a research question.
- **Risk:** This is the only input the AI ever gets, so a form that is too thin starves `S-02` of the context that breaks weight ties, and a form that is too heavy gets abandoned by exactly the rushed persona the PRD describes. The PRD already moved both forms from free text to structured for this reason — the plan should hold that line. Sequenced first because nothing downstream has data without it.
- **Status:** proposed

### S-02: AI contact hierarchy

- **Outcome:** User can see a ranked "who to reconnect with" list computed from their self-profile, their people's descriptions and weights, where each entry carries a suggested time window ("worth contacting Maciej within 2 weeks").
- **Change ID:** `ai-contact-hierarchy`
- **PRD refs:** US-01, FR-007
- **Prerequisites:** S-01, F-02
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:**
  - How much of the "why this order / why this time window" reasoning is shown to the user? Owner: user, during this slice's plan. Block: no — affects the depth of the view, not whether the slice can be built.
- **Risk:** The PRD names AI relevance as a guardrail: a nonsensical ranking makes the core feature worthless even when every other part works. Two acceptance criteria are the real test — two people with the same weight must not be ordered identically, and a user with no people must get an explanatory empty state rather than an error. Sequenced immediately after its two prerequisites because it carries the product's biggest unknown and `main_goal: speed` means finding out early beats polishing around it.
- **Status:** proposed

### S-03: Did-it-happen feedback loop

- **Outcome:** User can confirm, after a suggested contact's intended date, whether it actually happened (yes/no), and the next ranking visibly takes that answer — and the time since it — into account.
- **Change ID:** `did-it-happen-feedback-loop`
- **PRD refs:** US-01 (acceptance criterion: "the hierarchy takes into account time since the last (un)successful contact"), FR-009
- **Prerequisites:** S-02
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the north star, and its risk is behavioural rather than technical: the PRD already flags that users will not bother marking did-it-happen unless the marker is frictionless, and an empty loop leaves the hierarchy permanently stale. Note this slice deliberately lands *before* reminders (`S-04`) — the confirmation can be prompted inside the app from the hierarchy view, which means the loop closes without waiting on a delivery channel that is still undecided.
- **Status:** proposed

### S-04: Decay-driven reminders

- **Outcome:** User is reminded, without opening the app, about relationships that have gone quiet — at most once a day, in the order the hierarchy proposes.
- **Change ID:** `decay-driven-reminders`
- **PRD refs:** FR-008, NFR "reminders reach the user at most once per day, and address relationship decay — not same-day calendar events"
- **Prerequisites:** S-03
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:**
  - How often do reminders fire without becoming spam users mute? The once-per-day NFR is a ceiling, not the trigger rule; the decay-driven trigger logic is unresolved. Owner: user. Block: yes.
  - Through what channel does a reminder actually reach the user — email, web push, or something else? The PRD requires reminders but never names a channel, and the repo has neither. Owner: user. Block: yes.
- **Risk:** Blocked, and deliberately not sequenced earlier despite being the vision's most distinctive promise ("the app decides on your behalf"). It is the only slice needing infrastructure the project does not have — a scheduled trigger plus a delivery channel — and under `top_blocker: time` that cost is worth paying only once the loop it drives is proven. Both unknowns are one-sitting decisions, not research; resolving them promotes this slice immediately.
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
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                      | Suggested issue title                                         | Ready for `/10x-plan` | Notes                                                       |
| ---------- | ------------------------------ | ------------------------------------------------------------- | --------------------- | ----------------------------------------------------------- |
| F-01       | `per-user-data-isolation`      | Migration path + default-deny RLS for user-owned data          | yes                   | Run `/10x-plan per-user-data-isolation`                      |
| F-02       | `openai-ranking-call-path`     | Non-blocking OpenAI call path from the Worker                  | yes                   | Parallel with F-01; API key already held                     |
| S-01       | `profile-and-first-people`     | Self-profile + add people with description and weight          | no                    | Needs F-01; pin the form fields during planning              |
| S-02       | `ai-contact-hierarchy`         | AI-ranked contact hierarchy with suggested time windows        | no                    | Needs S-01 and F-02                                          |
| S-03       | `did-it-happen-feedback-loop`  | Did-it-happen confirmation feeding the next ranking            | no                    | North star. Needs S-02                                       |
| S-04       | `decay-driven-reminders`       | Decay-driven reminders, at most once per day                   | no                    | Blocked: reminder cadence + delivery channel undecided       |
| S-05       | `person-lifecycle-and-erasure` | Edit, deactivate and irreversibly delete a person              | no                    | Needs S-01; then runs parallel to the whole Stream A chain   |

## Open Roadmap Questions

1. **AI-suggestion explainability** — how much of the "why this order / why this time window" should be shown so users trust the hierarchy? Ties to the PRD's AI-relevance guardrail. Owner: user, during design. Block: `S-02`.
2. **Structured-form fields** — the exact fields for the self-profile (FR-002) and the per-person form (FR-003) are not pinned. Owner: user, during design. Block: `S-01`.
3. **Reminder cadence** — how frequently reminders fire without becoming spam users mute. Bounded by the once-per-day NFR, but the decay-driven trigger logic is unresolved. Owner: user, during design. Block: `S-04`.
4. **Reminder delivery channel** — FR-008 requires reminders to reach the user, but neither the PRD nor the repo names a channel (email, web push, other), and no scheduled trigger exists. Owner: user. Block: `S-04`.

## Parked

- **Categories / tabs for organizing people (FR-006)** — Why parked: nice-to-have in the PRD, purely organizational, does not touch the AI logic. Under `main_goal: speed` it is not on the must-have path.
- **Application-level error tracking / logging library** — Why parked: Workers platform observability is already enabled; adding a vendor is maintenance cost the 3-week after-hours budget does not have. Revisit if `S-02`'s ranking quality becomes hard to debug from platform logs alone.
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
