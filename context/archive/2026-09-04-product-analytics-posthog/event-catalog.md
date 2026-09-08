# Event Catalog — Product Analytics (F-06)

> The in-repo answer to "what do we track, and what may an event carry?"
> The enforcing artefact is `src/lib/analytics/events.ts`; this document explains it.
> If the two ever disagree, the code is right and this file is stale.

## The rule

**A property may be added to an event only if it cannot identify or describe a third party.**

Concretely, none of these may ever appear in a payload:

- a person's `name`, `description`, `relationship_context`, `tags` or `last_contact_bucket`
- the user's email address
- any free text the user or the model wrote — notes, `reason`, prompt fragments
- any `person_id`, hashed or otherwise

Presence booleans and counts are fine. They describe the *shape* of what a user did,
not who anyone is.

This is enforced by types, not by review: `capture()` accepts only a member of the
`AnalyticsEvent` discriminated union. There is no free-form property object anywhere in
the call path, so passing a name is a compile error rather than something a reviewer has
to catch. That matters most at step 4, whose emission point sits in the same lexical
scope as the people array, the literal OpenAI prompt and the raw model output.

## The five events

Exactly the five steps of the PRD's Success Criteria funnel. No sixth event without a
product decision — F-06's own risk note names instrumentation sprawl as one of its two
real risks.

| Event | Properties | Emitted from | Gated on |
| --- | --- | --- | --- |
| `signup_started` | *(none)* | `src/pages/api/auth/signup.ts` | `data.user` is non-null after a successful `signUp` |
| `profile_completed` | `rhythm_channels_count`, `rhythm_slots_count` | `src/pages/api/profile.ts` | no `profiles` row existed **before** the upsert |
| `first_person_added` | `people_added` | `src/pages/api/people.ts` | the owner had **zero** people (any status) before the insert |
| `hierarchy_generated` | `model`, `people_total`, `people_considered`, `duration_ms` | `src/lib/ranking/run.ts` | reached after `persistRanking` and `writeJob(..., "done")` |
| `contact_confirmed` | `has_note`, `from_suggestion` | `src/pages/api/contact-events.ts` | `outcome === "happened"` |

`distinct_id` is the Supabase user id on every event, and nothing else. Every event also
carries `$process_person_profile: false`.

### Notes on individual properties

- **`signup_started` is named `_started`, not `signed_up`.** Production requires email
  confirmation and this fires before it, so the count knowingly includes accounts that
  are never confirmed. The caveat lives in the event name rather than in a dashboard
  footnote. Consequence: step1→step2 conversion is diluted by everyone who never
  confirms.
- **`profile_completed` carries counts, never values.** Which channels and availability
  windows a user picked are personal attributes; how many they picked is what a funnel
  analysis reads.
- **`first_person_added`'s count exists because the route is a batch insert.** "First
  person" may in truth be "first N in one submit"; `people_added` records which.
- **`hierarchy_generated.duration_ms` is the same value as the `[ranking] job … done in
  Xms` log line.** They share one variable so they can never disagree.
- **`contact_confirmed.from_suggestion` is `rankingEntryId !== null`.** It is the
  cheapest proxy the MVP has for the PRD's "quality / relevance of AI suggestions"
  guardrail — a confirmed-vs-dismissed rate per generated hierarchy.

## Decisions made, so nobody relitigates them

| Decision | Choice | Why |
| --- | --- | --- |
| Region | PostHog Cloud **EU** (`https://eu.i.posthog.com`) | A **one-way door** — moving between Cloud EU and Cloud US needs PostHog support and a paid plan. The app holds personal data about third parties and the user base is Polish, so EU residency is the defensible default. Pinned as a constant in `config.ts`, not a second secret. |
| Transport | Bare `fetch` to `/i/v0/e/` | The only things `posthog-node` buys are batching (which PostHog's own Workers recipe disables), retries and typings — against an unmeasured bundle cost. No dependency added. |
| Person profiles | `$process_person_profile: false` | A funnel needs only consistently named events sharing a `distinct_id`. Profiles would pull user-level attributes into the vendor for nothing. |
| `person_id` in step 5 | **Excluded** | It joins straight back to `name` and `description` in `people`, weakening "nothing in PostHog joins back to a real person" — for an analysis the MVP never asked for. |
| Property safety | Typed per-event allow-list, never a property object | The step-4 emission point sits in the repo's densest PII scope. Only a closed union makes the unsafe call impossible. |
| `config-status.ts` entry | **None** | `missingConfigs` renders a Polish banner to end users on every page. An absent analytics key breaks nothing a user can see, so surfacing it there advertises an internal ops gap to the wrong audience. Matches what `OPENAI_API_KEY` and `RESEND_API_KEY` actually did. Reasoning is repeated in `src/lib/analytics/config.ts`. |
| Opt-out | Shipped — column + route + `/settings` switch | Completes the privacy story. The column landed in phase 1, two phases before the control, so the gate existed before the first event could fire. |
| Failure handling | Log and resolve; never throw | A failed capture must not turn a successful profile save into a 500. Every failure is a `console.error("[analytics] …")`, mirroring the `[ranking]` convention. |
| Batching / retries / idempotency | **None** | One event per user action against ~43 spare subrequests answers no measured need. A rarely double-fired event is not worth the machinery — the same posture the ranking route's documented TOCTOU race already established. |

## Explicitly out of scope

Autocapture, session replay, feature flags, A/B tests, error tracking, the browser SDK,
and a reverse proxy. Session replay in particular would record screens full of
third-party personal data. The roadmap's parked "error tracking / logging library" entry
stays parked and is **not** silently resolved by this change.

Also out: any event beyond these five — including `outcome: "not_yet"`, which is
interesting but is not step 5.

## Consent

`profiles.analytics_opt_out` (boolean, `not null default false` — i.e. opted in).

- Read through `src/lib/analytics/consent.ts` before every capture except
  `signup_started`, where no `profiles` row exists yet and the default applies.
- A missing row counts as consented. A query error **suppresses the event** and logs —
  it never throws into the caller's request path.
- `profile_completed` needs no consent read at all: the only branch that emits is the one
  where no `profiles` row exists, so no opt-out could ever have been recorded.
- Flipped from `/settings` → "Prywatność". The wire contract and the switch are positive
  (`enabled`); the column is negative. `src/pages/api/settings/analytics.ts` is the single
  place that inverts.

## Divergences from `plan.md`

Recorded here because the plan is frozen and this file is the living document.

1. **`profile_completed` dropped `has_life_context` and `has_birth_date`.** `profileSchema`
   requires both fields, so both booleans would be a constant `true` on every event ever
   sent — a property of the schema, not of user behaviour, that reads in a breakdown as a
   real 100%. Re-add only if those fields become optional.
2. **`profile_completed` dropped its consent read.** See Consent above — it was dead code,
   and `tsc` proved it by narrowing the value to `never`.
3. **`first_person_added` counts people of every status,** not `status = 'active'` as the
   dashboard head-count the plan pointed at does. Filtering by active would re-fire the
   event for someone who added a person, deactivated them, then added another.
4. **`contact-events.ts`'s consent read rides in the existing `Promise.all`** with
   `loadPersonContactFacts`, which that route already awaited. The subrequest is real; the
   added latency is zero.
5. **The `/settings` control is a switch, not an action-labelled Button.** `RemindersSection`
   landed with S-04 on 2026-09-08 — two days after this plan was written — and already
   solves "a toggle without adding a `ui/` primitive" with a native `<button role="switch">`.
   The plan's constraint holds; the two toggles now match.

## What proves this

- `npm run verify:analytics -- <deployed-url>` — the app's half: statuses, non-blocking
  timing, the opt-out round trip, and that an opted-out user's routes behave identically.
- **A human look in PostHog** — the other half. `/i/v0/e/` returns 2xx before ingestion
  decides anything, so "did it land, and does its payload carry no personal data" cannot
  be asserted from a script without PostHog read credentials.
