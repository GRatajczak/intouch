# PostHog Product Analytics for the Primary Success Funnel — Plan Brief

> Full plan: `context/changes/product-analytics-posthog/plan.md`
> Research: `context/changes/product-analytics-posthog/research.md`

## What & Why

The PRD's Success Criteria describe a five-step funnel — signed up → self-profile filled →
first person added → hierarchy generated → contact confirmed — but nothing measures it.
"Did a user get from *added my people* to *confirmed a contact*?" is currently a
`wrangler tail` question with no answer. This change makes it a dashboard question, while
holding the binding privacy constraint: no third party's name, description, relationship
context, tags or contact bucket, and no user email, may ever appear in an event payload.

## Starting Point

The repo has no analytics of any kind — observability today is seven `console.*` calls.
What it does have is everything needed to add it cheaply: a proven non-blocking dispatch
pattern (`cfContext.waitUntil`, in production at `rankings.ts:69-79`), a three-line
null-returning vendor factory convention, and a verification-script template. Two gaps:
funnel step 1 has no emission point at all (signup discards the user id, and email
confirmation never re-enters app code), and steps 2 and 3 cannot distinguish "first time"
from "again".

## Desired End State

Five named events reach a PostHog Cloud EU project through one typed wrapper in
`src/lib/analytics/`, keyed by the Supabase user id and nothing else. A saved funnel insight
answers the Success Criteria question directly. Any user can turn analytics off from
`/settings`, and the `event-catalog.md` in the change folder tells the next contributor what
may be tracked and why.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where the funnel starts | Capture at signup, named `signup_started` | Cheapest by far, and naming it `_started` makes the unconfirmed-account overcount explicit in the event name rather than hiding it in a footnote. | Plan |
| Region | PostHog Cloud EU (Frankfurt) | The app holds personal data about third parties and the user base is Polish; EU residency is the defensible default for a one-way door that costs nothing. | Plan |
| Transport | Bare `fetch` to `/i/v0/e/` | The only things `posthog-node` buys are batching (which PostHog's own Workers recipe disables), retries and typings — against an unmeasured bundle cost and a known type-resolution gotcha. | Research → ratified in Plan |
| Where the event leaves | `cfContext.waitUntil` in routes; a plain `await` in `run.ts` | `runRanking` already executes inside `waitUntil`, so step 4 needs no second deferral. | Research |
| `person_id` in step 5 | Excluded | It joins straight back to `name` and `description`, weakening "nothing in PostHog joins back to a real person" for an analysis the MVP has not asked for. | Plan |
| Property safety | Typed per-event allow-list, never a property object | The mandatory step-4 emission point sits in the same lexical scope as the full people array, the prompt and the raw model output; only a closed union makes the unsafe call impossible. | Research → Plan |
| Person profiles | `$process_person_profile: false` | A funnel needs only consistent event names sharing a `distinct_id`; profiles would pull user attributes into the vendor for nothing. | Research |
| Opt-out | Ship it — column + route + `/settings` section, Button-based | Completes the privacy story and closes the roadmap's fourth Unknown without adding a shadcn `Switch` to the design system inside an analytics foundation. | Plan |
| `config-status.ts` entry | No entry, reasoning recorded in code | `missingConfigs` renders a user-facing banner on every page; an absent analytics key breaks nothing a user can see. | Plan |
| Evidence bar | `verify:analytics` script + one manual PostHog check | No test runner exists yet, and a 2xx from `/i/v0/e/` is returned before ingestion decides anything — so "did it land" has to be a human look. | Plan |

## Scope

**In scope:**

- One typed, consent-aware wrapper in `src/lib/analytics/` with a closed event catalog
- Exactly five events at their five truthful completion points
- `POSTHOG_API_KEY` through `astro:env/server` into all three secret locations plus both CI and deploy workflows
- An `analytics_opt_out` column and a `/settings` control for it
- `scripts/verify-analytics.ts`, a saved PostHog funnel insight, and an in-repo event catalog

**Out of scope:**

- Autocapture, session replay, feature flags, A/B tests, error tracking
- The browser SDK and the reverse proxy (server-side capture is ad-blocker-proof, and steps 1 and 3 have no client-side success callback)
- The `posthog-node` dependency
- Any event beyond the five steps — including `outcome: "not_yet"`
- `person_id` in any payload, hashed or otherwise
- Batching, retries, durable delivery, idempotency
- A new `src/components/ui/` primitive
- Test-runner work, and any change to the email-confirmation flow

## Architecture / Approach

```
signup.ts ─┐
profile.ts ─┤                                   ┌─ events.ts   (closed union = the allow-list)
people.ts  ─┼─► dispatch(cfContext, id, event) ─┤─ consent.ts  (analytics_opt_out)
contact-   ─┘        └─ waitUntil ─┐            ├─ config.ts   (POSTHOG_API_KEY | null)
 events.ts                         └──────────► └─ capture.ts ──► POST eu.i.posthog.com/i/v0/e/
run.ts ──────► await capture(...)  (already inside waitUntil)
```

`events.ts` is the privacy guarantee: `capture` accepts only a member of that union, so the
PII-dense scope in `run.ts` has no way to pass a name or a free-text field. Everything else
is one direction, fire-and-forget, and never throws into a request path.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Wrapper, catalog, secret path | `src/lib/analytics/*`, env schema, CI/deploy plumbing, `analytics_opt_out` column | Nothing emits yet, so the bar is automated gates alone; a missed CI `env:` block turns into a red build later |
| 2. Funnel steps 1–3 | `signup_started`, `profile_completed`, `first_person_added` | The once-only pre-checks must run *before* the write, or they always report "not first" |
| 3. Funnel steps 4–5 | `hierarchy_generated`, `contact_confirmed` | Step 4 sits in the repo's densest PII scope; step 5 must stay gated on `outcome === "happened"` |
| 4. Opt-out control | `/api/settings/analytics` + a "Prywatność" section | Visible UI, and `lessons.md` shows automated checks pass while a control renders unstyled |
| 5. Verification and funnel | `verify:analytics`, the PostHog insight, `event-catalog.md` | `wrangler tail` proves nothing until a `versions deploy`, so assertions must be self-evidencing |

**Prerequisites:** a PostHog Cloud EU project with its API key; `wrangler secret put` and the
GitHub repo secret (both human-only per `CLAUDE.md` §Sekrety); a deployed Worker for Phase 5;
`VERIFY_EMAIL` / `VERIFY_PASSWORD` for a confirmed account in the hosted Supabase project.

**Estimated effort:** ~3–4 sessions across 5 phases, with a manual confirmation stop between each.

## Open Risks & Assumptions

- **The region is a one-way door.** Moving between Cloud EU and Cloud US needs PostHog
  support and a paid plan. Cloud EU is chosen deliberately and is not cheaply reversible.
- **Step 1 knowingly overcounts.** `signup_started` fires before email confirmation, so
  step1→step2 conversion is diluted by everyone who never confirms. The event name carries
  the caveat; separating the two would mean auth work this change declines.
- **Deploy is automatic on push to `main`.** Events begin reaching production as soon as
  Phase 2 lands — two phases before the opt-out UI exists. The consent *column* and the
  wrapper's gate ship in Phase 1 precisely so the mechanism precedes the first event; only
  the control is later.
- **Once-only semantics are best-effort.** A concurrent double submit could fire a duplicate
  `profile_completed`. This inherits the repo's documented posture — the ranking's TOCTOU
  race was accepted and recorded rather than engineered away.
- **No test coverage is claimed.** No runner exists; `test-plan.md` §3 Phase 4 will later
  cover the same three routes and is the natural home for a once-only regression test.

## Success Criteria (Summary)

- Opening one saved PostHog funnel answers "did a user get from *added my people* to
  *confirmed a contact*?" without reading a single Workers log line.
- Inspecting any event of any of the five types finds no third party's name, description,
  relationship context, tags or contact bucket, no user email, and no `person_id`.
- A user who opts out in `/settings` generates no further events, and the app behaves
  identically for them.
