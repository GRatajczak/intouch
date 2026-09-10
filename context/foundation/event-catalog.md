# Event Catalog

> The in-repo answer to "what do we track, and what may an event carry?"
>
> Two channels send to PostHog, with **different guarantees**, and conflating them is the
> mistake this document exists to prevent:
>
> - The **server channel** (F-06) is guaranteed by a closed discriminated union in
>   `src/lib/analytics/events.ts`. Five named events, no free-form property object,
>   an unsafe payload is a compile error.
> - The **browser channel** (`web-analytics-pageviews`) is guaranteed by the _absence_
>   of autocapture plus a URL sanitizer in `src/lib/analytics/sanitize-url.ts`. Its
>   events are written by `posthog-js`, not by this repo, so the union does not and
>   cannot govern them.
>
> Everything below the "Server channel" heading is the F-06 catalog moved here unchanged;
> only its heading levels were demoted so the two channels sit as peers.

## Server channel — the funnel (F-06)

> The enforcing artefact is `src/lib/analytics/events.ts`; this section explains it.
> If the two ever disagree, the code is right and this file is stale.

### The rule

**A property may be added to an event only if it cannot identify or describe a third party.**

Concretely, none of these may ever appear in a payload:

- a person's `name`, `description`, `relationship_context`, `tags` or `last_contact_bucket`
- the user's email address
- any free text the user or the model wrote — notes, `reason`, prompt fragments
- any `person_id`, hashed or otherwise

Presence booleans and counts are fine. They describe the _shape_ of what a user did,
not who anyone is.

This is enforced by types, not by review: `capture()` accepts only a member of the
`AnalyticsEvent` discriminated union. There is no free-form property object anywhere in
the call path, so passing a name is a compile error rather than something a reviewer has
to catch. That matters most at step 4, whose emission point sits in the same lexical
scope as the people array, the literal OpenAI prompt and the raw model output.

### The five events

Exactly the five steps of the PRD's Success Criteria funnel. No sixth event without a
product decision — F-06's own risk note names instrumentation sprawl as one of its two
real risks.

| Event                 | Properties                                                  | Emitted from                      | Gated on                                                     |
| --------------------- | ----------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `signup_started`      | _(none)_                                                    | `src/pages/api/auth/signup.ts`    | `data.user` is non-null after a successful `signUp`          |
| `profile_completed`   | `rhythm_channels_count`, `rhythm_slots_count`               | `src/pages/api/profile.ts`        | no `profiles` row existed **before** the upsert              |
| `first_person_added`  | `people_added`                                              | `src/pages/api/people.ts`         | the owner had **zero** people (any status) before the insert |
| `hierarchy_generated` | `model`, `people_total`, `people_considered`, `duration_ms` | `src/lib/ranking/run.ts`          | reached after `persistRanking` and `writeJob(..., "done")`   |
| `contact_confirmed`   | `has_note`, `from_suggestion`                               | `src/pages/api/contact-events.ts` | `outcome === "happened"`                                     |

`distinct_id` is the Supabase user id on every event, and nothing else. Every event also
carries `$process_person_profile: false`.

#### Notes on individual properties

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

### Decisions made, so nobody relitigates them

| Decision                         | Choice                                              | Why                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region                           | PostHog Cloud **EU** (`https://eu.i.posthog.com`)   | A **one-way door** — moving between Cloud EU and Cloud US needs PostHog support and a paid plan. The app holds personal data about third parties and the user base is Polish, so EU residency is the defensible default. Pinned as a constant in `config.ts`, not a second secret.                                               |
| Transport                        | Bare `fetch` to `/i/v0/e/`                          | The only things `posthog-node` buys are batching (which PostHog's own Workers recipe disables), retries and typings — against an unmeasured bundle cost. No dependency added.                                                                                                                                                    |
| Person profiles                  | `$process_person_profile: false`                    | A funnel needs only consistently named events sharing a `distinct_id`. Profiles would pull user-level attributes into the vendor for nothing.                                                                                                                                                                                    |
| `person_id` in step 5            | **Excluded**                                        | It joins straight back to `name` and `description` in `people`, weakening "nothing in PostHog joins back to a real person" — for an analysis the MVP never asked for.                                                                                                                                                            |
| Property safety                  | Typed per-event allow-list, never a property object | The step-4 emission point sits in the repo's densest PII scope. Only a closed union makes the unsafe call impossible.                                                                                                                                                                                                            |
| `config-status.ts` entry         | **None**                                            | `missingConfigs` renders a Polish banner to end users on every page. An absent analytics key breaks nothing a user can see, so surfacing it there advertises an internal ops gap to the wrong audience. Matches what `OPENAI_API_KEY` and `RESEND_API_KEY` actually did. Reasoning is repeated in `src/lib/analytics/config.ts`. |
| Opt-out                          | Shipped — column + route + `/settings` switch       | Completes the privacy story. The column landed in phase 1, two phases before the control, so the gate existed before the first event could fire.                                                                                                                                                                                 |
| Failure handling                 | Log and resolve; never throw                        | A failed capture must not turn a successful profile save into a 500. Every failure is a `console.error("[analytics] …")`, mirroring the `[ranking]` convention.                                                                                                                                                                  |
| Batching / retries / idempotency | **None**                                            | One event per user action against ~43 spare subrequests answers no measured need. A rarely double-fired event is not worth the machinery — the same posture the ranking route's documented TOCTOU race already established.                                                                                                      |

### Explicitly out of scope

Autocapture, session replay, feature flags, A/B tests, error tracking, the browser SDK,
and a reverse proxy. Session replay in particular would record screens full of
third-party personal data. The roadmap's parked "error tracking / logging library" entry
stays parked and is **not** silently resolved by this change.

Also out: any event beyond these five — including `outcome: "not_yet"`, which is
interesting but is not step 5.

### Consent

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

### Divergences from `plan.md`

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

### What proves this

- `npm run verify:analytics -- <deployed-url>` — the app's half: statuses, non-blocking
  timing, the opt-out round trip, and that an opted-out user's routes behave identically.
- **A human look in PostHog** — the other half. `/i/v0/e/` returns 2xx before ingestion
  decides anything, so "did it land, and does its payload carry no personal data" cannot
  be asserted from a script without PostHog read credentials.

---

## Browser channel — web analytics (`web-analytics-pageviews`)

> The enforcing artefacts are `src/lib/analytics/sanitize-url.ts` (what may leave) and
> `src/lib/analytics/browser.ts` (what is switched on at all). Same rule as above: if the
> code and this file disagree, the code is right.

### What it sends

`posthog-js`, loaded from `src/components/analytics/AnalyticsRuntime.astro` on every page
via `Layout.astro`. Two automatic events, plus `$identify` when a signed-in user is
resolved (see Identity lifecycle below) — and nothing else:

| Event        | When                    | What it carries that matters                                                              |
| ------------ | ----------------------- | ----------------------------------------------------------------------------------------- |
| `$pageview`  | Once per full page load | `$current_url`, `$pathname`, `$referrer`, `$session_id`, UTMs, device, country, browser   |
| `$pageleave` | On unload               | The same session key, which is what turns pageviews into bounce rate and session duration |

The app is an MPA — no `ClientRouter`, no view transitions — so `capture_pageview` is
`true`, not `'history_change'`: one pageview per real page load, and history-change
detection would be dead weight.

**Everything else in the SDK is off**, explicitly rather than by default: `autocapture`,
`capture_heatmaps`, `capture_dead_clicks`, `capture_performance`, `capture_exceptions`,
`disable_session_recording`, `disable_surveys`, `disable_web_experiments`. Autocapture is
the important one: it reads text out of the DOM, and this app's screens are full of third
parties' names and descriptions. It stays off permanently.

### The sanitizer — three rules, one place

The server channel's guarantee is that no property can carry personal data. The browser
channel cannot make that promise the same way, because `posthog-js` writes the URL
properties itself, straight off `window.location`. **In this app a URL is a payload:**

- `/people/<uuid>` carries a `person_id` — which the rule at the top of this document
  forbids outright, "hashed or otherwise".
- `/auth/confirm?token_hash=…` carries a single-use auth token.
- `?error=<supabase message>` is rendered by signin, signup, forgot-password,
  reset-password and people/new.

Two things leave on the way out. First, `title` — which is `document.title`, and on
`/people/[id]` **is the contact's name**, because the page renders
`<AppShell title={person.name}>`. It arrives under a bare key with no `$` prefix and is not
a URL, so no amount of URL rewriting would have caught it. It is removed twice over: by
`property_denylist: ["title"]` at init, and by `DROPPED_PROPERTIES` in the scrubber.

Second, every URL-shaped property is rewritten by `sanitizeUrl`:

1. **Every path segment shaped like a uuid becomes `:id`.** `/people/<uuid>` →
   `/people/:id`.
2. **The query string is rebuilt from an allow-list**, `ATTRIBUTION_PARAMS`:
   `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`,
   `fbclid`, `igshid`. Everything else is dropped whether or not it looks sensitive — an
   allow-list, because a deny-list is a promise to have anticipated every parameter this
   app will ever put in a URL, and the two that mattered were found by reading routes.
3. **The fragment is dropped entirely.**

Anything that does not parse, and anything that is not `http(s)` — a `data:` or
`javascript:` URL parses fine and hides its payload in the path — returns a fixed
placeholder rather than the original string. Failing closed is the point.

**Where it is enforced:** `src/lib/analytics/scrub-event.ts`, wired to `before_send` — the
SDK's last hook before an event is queued. It walks `properties`, and separately `$set` and
`$set_once`, because person properties travel top-level on the `CaptureResult` and are
merged into `properties` only when the request is built. `$referrer`'s `"$direct"` sentinel
is left alone; it is not a URL, and sanitizing it would turn it into the path `/$direct`
and break the channels breakdown.

**Which keys count as URLs is matched by SHAPE, not enumerated,** and that distinction was
bought the hard way. `posthog-js` does not write these names literally — it derives them by
prefixing a small set of base names, in four places added at different times:

| Where                                   | Names it produces                                          |
| --------------------------------------- | ---------------------------------------------------------- |
| bare, off `window.location`             | `$current_url`, `$pathname`, `$referrer`                   |
| `persistence.get_initial_props()`       | `$initial_*`                                               |
| `SessionPropsManager.getSessionProps()` | `$session_entry_*`, renaming `$current_url` to plain `url` |
| `PageViewManager` on `$pageleave`       | `$prev_pageview_pathname`                                  |

The first implementation enumerated the first two families and missed the other two. The
`$session_entry_*` values are frozen at session start and re-emitted on **every** subsequent
event, so a user arriving from a reminder email's `/people/<id>` deep link
(`src/lib/reminders/email.ts`) carried a raw person id on every event for the rest of their
session. Hostnames — `$referring_domain`, `$session_entry_host` — are deliberately NOT
matched: they are not URLs, and sanitizing them would corrupt them into paths.

**Two test tables, because there are two ways to get this wrong.**
`tests/unit/sanitize-url.test.ts` pins what a URL may say. `tests/unit/scrub-event.test.ts`
pins which properties are treated as URLs at all, and closes with an assertion over the
whole serialized event — no person id and no contact name anywhere in it — so a property
family added by a future SDK version fails the test even though no case names it.

### Consent — and how it differs from the plan

**Anonymous traffic is collected by default. There is no consent banner.**

The plan for this change specified one; it was dropped by decision on 2026-09-10 (see
`context/changes/web-analytics-pageviews/change.md` for the rationale and the two rejected
alternatives). The reasoning in one line: a visitor before signup has no `profiles` row to
carry a verdict, and anonymous traffic — the landing page, referrers, UTMs, the path into
signup — is exactly what this channel exists to measure.

So the model is:

| Visitor   | Verdict source                                                                     | Default                     |
| --------- | ---------------------------------------------------------------------------------- | --------------------------- |
| Anonymous | none — `locals.analyticsConsent` is absent, the layout passes `"unknown"`          | **collect**                 |
| Signed in | `profiles.analytics_opt_out`, read once per document render in `src/middleware.ts` | collect unless switched off |

`applyConsent()` in `browser.ts` mutes only an explicit `"denied"`. The SDK still
initializes with `opt_out_capturing_by_default: true` and is unmuted a moment later —
that ordering is what guarantees nothing can fly before the verdict is known.

**The middleware's fail-open direction is inverted relative to `consent.ts`.** That module
fails open to silence by returning `false`. Here a read failure must resolve to `"denied"`
_explicitly_, because dropping the banner made `"unknown"` mean collect. A broken query
must not be able to start sending pageviews for a user who switched them off.

The control is the switch under **Ustawienia → Prywatność**, unchanged since F-06 except
that its copy now names pages visited and traffic source, and names the sanitizer. It
governs both channels.

### Person profiles now exist

F-06 sends `$process_person_profile: false` on every server event and still does — nothing
in `capture.ts` changed. But the browser client runs with
`person_profiles: "identified_only"` and calls `identify()` with the Supabase user id,
which is **the same `distinct_id` the five server events already use**.

PostHog's capture API treats a `distinct_id` that has ever been used with an identified
event as identified from then on. So turning on person profiles in the browser
retroactively links the F-06 server events to the same person, with no change to the
server channel. That is the intended effect — it is what makes the funnel and the traffic
one dataset — but it is worth stating plainly, because it means the F-06 decision row
"Person profiles: `$process_person_profile: false`" above is now true of the _call_ and no
longer true of the _outcome_.

### Identity lifecycle

- **Signing in** — `identify(<supabase user id>)`, guarded on the SDK's own
  `get_distinct_id()` so a cleared `localStorage` still re-identifies.
- **Signing out** — sign-out is a POST that redirects to `/` and never touches browser
  storage, so without an explicit reset the next anonymous visitor on that browser is
  attributed to the account that just left. `browser.ts` records the last identified id
  under its own key, notices "no user now, someone before", and calls `reset()`.
- **Ordering** — `reset()` **before** any opt-in, never after. `reset()` clears stored
  consent along with the identity, so with `opt_out_capturing_by_default` the reverse
  order silently re-mutes the SDK. The package's own docs flag this.

### Explicitly out of scope

Session replay, autocapture, heatmaps, web vitals, exception capture — all available in
the same SDK, none asked for, and the first two for the same third-party-data reason F-06
gave. Also out: a reverse proxy under `get-in-touch.pl`, so ad-blocked traffic stays
uncounted. Revisit once there are numbers showing how much traffic that actually is.

### Divergences from `plan.md`

Recorded here because the plan is frozen and this file is the living document.

1. **The consent banner was never built** and anonymous traffic collects by default. See
   Consent above.
2. **`opt_in_capturing()` already fires the initial `$pageview`.** The plan assumed the
   opposite and specified that the banner's accept handler capture one explicitly. Reading
   the installed package showed its tail is `capture_pageview && Bu()`, and `Bu()` carries
   a once-per-load flag — so an explicit capture would have been dead code or a double
   count, depending on ordering.
3. **`AnalyticsScript.astro` was split in two.** A `<script>` inside a `{token && …}`
   expression compiles correctly — the Astro compiler reads it as raw text — but prettier
   reads the same body as JSX and fails on the first `{`. The build passed while the lint
   failed. The conditional moved up a level: `AnalyticsScript.astro` reads the key and
   renders `AnalyticsRuntime.astro`, which holds the script at a template top level.
4. **The bundle is larger than the plan estimated** — 299 kB raw, 97 kB gzipped, against
   the plan's "roughly 40 kB gzipped". One chunk, loaded on every page, not
   render-blocking.
5. **Three privacy leaks were found by implementation review, after the phases were
   committed**, and all three lived in the layer that decides which keys to sanitize
   rather than in the sanitizer: `title` carrying a contact's name, the two unenumerated
   URL families above, and the SDK loading at all for a user who had switched analytics
   off. That last one matters beyond its own fix: `opt_out_capturing()` stops `capture()`
   and nothing else — `init()` still issues a remote-config GET and a `POST /flags/?v=2`
   carrying `distinct_id`, `$device_id` and `$initial_current_url`, and **neither request
   passes through `before_send`**. So a denied user is no longer served the SDK at all
   (`AnalyticsScript.astro` declines to mount), which is the only fix robust to whatever
   request path the vendor adds next.
6. **`posthog-js` is pinned to an exact version**, not a caret range, because the
   guarantee is derived from that version's property names and request paths. A minor bump
   is exactly how `$session_entry_*` came to exist alongside `$initial_*`. Re-derive the
   property surface before bumping.

### What proves this

- `tests/unit/sanitize-url.test.ts` — the sanitizer's contract, exhaustively.
- **A human look in PostHog** — the other half, and the only one that can see what a
  browser actually sent. Spot-check recent events for a uuid, a `token_hash` or an
  `error` parameter in any `$current_url`.
