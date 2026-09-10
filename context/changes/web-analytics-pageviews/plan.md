# Web Analytics: Pageviews, Sessions and Consent — Implementation Plan

## Overview

F-06 made the product's primary funnel measurable. It did not make the product's
*traffic* measurable: there are no `$pageview` events, no browser SDK, and no way to
count daily active users. This change adds a consent-gated PostHog browser client that
emits pageviews and sessions, with a sanitizer that strips person ids and auth tokens
out of every URL before it leaves the page.

The five server-side funnel events from F-06 are not touched. This change adds a second
channel next to them, keyed by the same `distinct_id`.

## Current State Analysis

**What exists (F-06, archived `2026-09-04-product-analytics-posthog`):**

- `src/lib/analytics/capture.ts` — a bare `fetch` POST to `https://eu.i.posthog.com/i/v0/e/`,
  never throwing, always sending `$process_person_profile: false`.
- `src/lib/analytics/events.ts` — a closed discriminated union of exactly five events.
  This union *is* the privacy guarantee: there is no free-form property object in the
  server call path.
- `src/lib/analytics/index.ts` — `dispatch()`, which defers a capture through
  `cfContext.waitUntil()` so no capture sits in a response path.
- `src/lib/analytics/consent.ts` — reads `profiles.analytics_opt_out`, fails open to
  silence (a query error suppresses the event rather than throwing).
- `src/pages/api/settings/analytics.ts` + `src/components/settings/AnalyticsSection/` —
  the opt-out switch under Ustawienia → Prywatność.
- `POSTHOG_API_KEY` in `astro.config.mjs` as `context: "server", access: "secret", optional: true`.

**What is missing, and why the gap is total:**

- No `$pageview` or `$pageleave` anywhere. PostHog's Web Analytics dashboard — visitors,
  sessions, bounce rate, top paths, channels, referrers, UTMs, countries, devices — is
  built entirely on those two events plus `$session_id` and `$current_url`. The tab is
  empty and will stay empty until they exist.
- No browser SDK: `posthog-js` is not a dependency and `src/layouts/Layout.astro` loads
  no analytics script. Every event today originates in the Worker, so PostHog sees the
  Worker's IP, no referrer, no UTM, no device.
- DAU cannot be derived from the five existing events. `signup_started`,
  `profile_completed` and `first_person_added` each fire at most once in an account's
  lifetime; only `hierarchy_generated` and `contact_confirmed` recur. There is no
  sign-in event and no visit event.
- Anonymous traffic is entirely invisible, which is precisely the traffic web analytics
  exists to measure. `profiles.analytics_opt_out` only exists for a signed-in user.

**Constraints discovered while researching this change:**

- **The app is an MPA.** No `ClientRouter` / view transitions anywhere; every navigation
  is a full page load. Any consent scheme that forgets its state per page load (in-memory
  persistence) also restarts the PostHog session per page load, which makes bounce rate
  and session duration meaningless. That ruled out the cookieless variant.
- **`/people/[id]` puts a person id in the path.** `src/lib/analytics/events.ts` and the
  event catalog both forbid a `person_id` "hashed or otherwise". A raw `$current_url`
  would ship one on every person-detail view.
- **Auth tokens and error text ride in the query string.** `src/pages/auth/confirm.ts:19`
  reads `token_hash`; `signin.astro:6`, `signup.astro:6`, `forgot-password.astro:6`,
  `reset-password.astro:7` and `people/new.astro:7` each render `?error=<supabase message>`.
  A pageview that forwards the query string verbatim ships a single-use auth token to a
  vendor.
- **Client env vars are inlined at build time; Workers Secrets are runtime.** Registering
  a `context: "client"` variable in `astro.config.mjs` would force the token into GitHub
  Secrets and a rebuild on every rotation. Rendering the existing server secret into the
  page sidesteps that and keeps one secret in one place.
- **Sign-out is a POST that redirects to `/`** (`src/pages/api/auth/signout.ts`). The
  PostHog cookie survives it, so without an explicit reset the next anonymous visitor on
  that browser is attributed to the account that just left.
- **There is no privacy policy page,** and `src/components/landing/LandingFooter.astro`
  records that the Prywatność / Regulamin links were deliberately omitted because no such
  page exists. The consent banner therefore has to explain itself inline.
- **A previously-identified `distinct_id` stays identified.** PostHog's capture API docs
  state that if a `distinct_id` has ever been used with an identified event, later events
  are treated as identified even when they carry `$process_person_profile: false`. So
  turning on person profiles in the browser retroactively links the F-06 server events to
  the same person, with no change to `capture.ts`.

## Desired End State

A signed-out visitor lands on `/`, sees a consent banner, and until they answer it the
PostHog SDK is loaded but muted. If they accept, pageviews start flowing with the session
cookie set, so PostHog's Web Analytics dashboard fills with visitors, sessions, bounce
rate, top paths, referrers, UTMs, countries and devices. When they sign up and sign in,
the browser identifies them with their Supabase user id — the same `distinct_id` the five
F-06 events already use — so the landing-to-activation path reads as one person, and a
DAU trend over `$pageview` unique users becomes a real number.

No URL that reaches PostHog contains a person id, an auth token, or a Supabase error
message.

**Verification:** `npm test` covers the sanitizer's contract exhaustively; a human look at
PostHog's Web Analytics tab and Activity feed after deploy confirms events land and their
payloads are clean.

### Key Discoveries:

- `src/middleware.ts:7-19` already constructs a Supabase client and resolves `locals.user`
  on every request — the natural place to also resolve analytics consent without a second
  client.
- `src/middleware.ts:26-34` shows the existing pattern for a conditional profiles query
  (the `/people` profile gate), including its `maybeSingle()` shape.
- `src/pages/settings.astro:19-33` shows how `analytics_opt_out` is read and inverted for
  the UI, with the "absent row means consented" default that `consent.ts:16` also applies.
- `src/components/settings/AnalyticsSection/AnalyticsSection.tsx` is the model for the
  banner's optimistic-update-and-toast behaviour, and `lessons.md` requires the
  folder + `types.ts` + barrel `index.ts` shape for any new React component.
- `tests/unit/recency-floor.test.ts` is the model for a pure-function unit test in this
  repo: `it.each` tables, hand-built inputs, no fixtures, no mocks.
- `vitest.config.ts` includes only `tests/unit`, `tests/rls`, `tests/routes`, `tests/http`.
  A new sanitizer test drops into `tests/unit/` with no config change.
- Playwright landed in the repo separately (`test:e2e` script, `@playwright/test`
  devDependency). This plan does not use it — see What We're NOT Doing.

## What We're NOT Doing

- **No autocapture.** The app's screens are full of third-party names and descriptions,
  and autocapture reads text out of the DOM.
- **No session replay.** The roadmap parks it explicitly and for the same reason.
- **No heatmaps, no web vitals, no exception capture.** All available in the same SDK;
  none was asked for.
- **No reverse proxy** under `get-in-touch.pl`. Ad-blocked traffic stays uncounted. Revisit
  once there are numbers showing how much traffic that actually is.
- **No changes to `capture.ts`, `events.ts` or the five server events.** The F-06 funnel
  keeps working exactly as it does today.
- **No Playwright spec** asserting the outbound request payload, and no extension of
  `scripts/verify-analytics.ts`. Both were considered and dropped; the sanitizer's unit
  tests plus a human look in PostHog are the agreed proof.
- **No privacy policy page.** The banner explains itself inline. A real policy page is a
  separate change.
- **No `posthog-node`.** The browser SDK is a browser concern; the Worker keeps its bare
  `fetch`.

## Implementation Approach

Four moving parts, sequenced so that no unsanitized data can ever fly:

1. A **pure sanitizer** (`src/lib/analytics/sanitize-url.ts`) that rewrites any URL-shaped
   string: uuid path segments become `:id`, the query string is reduced to an allow-list of
   attribution parameters, and the fragment is dropped. It imports nothing — no
   `astro:env/server`, no Supabase — so it is safe in a client bundle and trivial to test.
2. A **browser init module** (`src/lib/analytics/browser.ts`) that owns every call into
   `posthog-js`: init with capturing opted out by default, `before_send` wired to the
   sanitizer, and the identify/reset lifecycle.
3. A **consent banner** (React island) that is the only thing that can call the opt-in.
4. A **consent resolution path** for signed-in users: middleware reads
   `profiles.analytics_opt_out` into `locals`, the layout passes it down, and it overrides
   whatever the browser remembered.

The token reaches the browser as a `data-` attribute rendered by a server-side Astro
component, read by the bundled client script. That keeps `POSTHOG_API_KEY` a single
runtime server secret.

## Critical Implementation Details

**Ordering: the SDK must be mute before it is loud.** `posthog.init` runs with
`opt_out_capturing_by_default: true` on every page load, including for users who already
consented. Capturing is enabled only by an explicit opt-in call once consent is resolved.
The consequence is that the initial automatic `$pageview` is suppressed on the page where
consent is first granted — the banner's accept handler has to capture one explicitly, or
that first visit is lost. Verify the exact opt-in API surface (whether `opt_in_capturing()`
already emits a pageview, and what it names its own event) against the installed
`posthog-js` in `node_modules` before wiring it — `lessons.md` records a case where a
plan's config syntax was right in intent and invented in detail.

**Sign-out leaves a stale identity.** `src/pages/api/auth/signout.ts` redirects to `/`
without touching browser storage. The client module must detect "the layout says nobody is
signed in, but we previously identified someone" and call reset before anything else on
that page load. Store the last identified id under the app's own key rather than reading
PostHog internals.

**Consent for a signed-in user costs one Supabase query per page render.** The middleware
lookup should run only for document requests with a user present, never for `/api/*`, and
must fail open to silence the same way `consent.ts` does — an error resolves to "no
consent", never to a thrown request.

---

## Phase 1: URL sanitizer and its tests

### Overview

The privacy invariant, as a pure function with an exhaustive test table, before anything
can call it. Nothing in the app changes behaviour in this phase.

### Changes Required:

#### 1. The sanitizer

**File**: `src/lib/analytics/sanitize-url.ts` (new)

**Intent**: Rewrite any URL-shaped string so that it cannot carry a person id, an auth
token, or a Supabase error message, while preserving everything PostHog's Web Analytics
dashboard reads. This is the file that makes a pageview safe to send.

**Contract**: A single exported function taking a string and returning a string, plus the
exported allow-list constant so tests and reviewers can see it. Three rules, applied in
order: every path segment matching a uuid becomes `:id`; the query string is rebuilt from
an allow-list of attribution parameters only (`utm_source`, `utm_medium`, `utm_campaign`,
`utm_term`, `utm_content`, `gclid`, `fbclid`, `igshid`); the fragment is dropped entirely.
Absolute and relative inputs both round-trip, and an input that does not parse as a URL
returns a fixed placeholder rather than the original string — failing closed is the whole
point. The function imports nothing.

#### 2. The test table

**File**: `tests/unit/sanitize-url.test.ts` (new)

**Intent**: Pin every rule with a case drawn from a real route in this repo, so that a
future edit that loosens the rule fails rather than passes quietly.

**Contract**: Follows `tests/unit/recency-floor.test.ts` — `describe` per rule, `it.each`
tables, hand-built strings. Cases must include at minimum: `/people/<uuid>` masked;
`/people/<uuid>` inside an absolute URL with an origin; multiple uuids in one path;
`/auth/confirm?token_hash=…&type=recovery` reduced to a bare path; `?error=<message>`
dropped; a UTM-only query preserved verbatim; a mixed query keeping only the allow-listed
keys; a fragment dropped; a malformed input returning the placeholder; and a plain
`/dashboard` passing through unchanged.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test tests/unit/sanitize-url.test.ts`
- Full suite still passes: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Reading the test table, a reviewer can name every category of thing that is stripped without opening the implementation

---

## Phase 2: PostHog browser client, muted by default

### Overview

Load `posthog-js`, wire the sanitizer into it, and give the app a single module that owns
every call into the SDK. Capturing stays opted out for everyone, so this phase ships a
complete client that sends nothing.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Add `posthog-js` as a runtime dependency.

**Contract**: A pinned caret range in `dependencies`, alongside the other client-side
libraries. No change to any script.

#### 2. Browser init module

**File**: `src/lib/analytics/browser.ts` (new)

**Intent**: The only file in the app that imports `posthog-js`. It owns initialization,
the consent gate, and the identify/reset lifecycle, so that no page or component can reach
the SDK directly and skip a rule.

**Contract**: One exported entry point taking the project token, the signed-in user's id
or `null`, and a consent verdict (`"granted" | "denied" | "unknown"`). It initializes
PostHog against `https://eu.i.posthog.com` with: `person_profiles: "identified_only"`,
`autocapture: false`, session recording disabled, exception capture disabled,
`opt_out_capturing_by_default: true`, and `before_send` applying `sanitizeUrl` to every
URL-shaped property on the event (`$current_url`, `$pathname`, `$referrer`, and their
`$initial_*` counterparts). It then resolves consent: granted opts capturing in, denied
opts it out, unknown leaves it muted. Identity: with a user id it identifies and records
that id locally; with `null` and a previously recorded id it resets and clears the record.
Must be import-safe on the server (it is bundled for the client only, but nothing in it may
touch `astro:env/server`).

**Contract note**: verify the opt-in / opt-out method names and the `before_send` return
contract (returning `null` to drop an event) against the installed package before writing
the calls.

#### 3. Server-rendered mount point

**File**: `src/components/analytics/AnalyticsScript.astro` (new)

**Intent**: Carry the project token and the signed-in user id from the server into the
browser without turning either into a build-time constant, and start the client module.

**Contract**: Reads `POSTHOG_API_KEY` from `astro:env/server` and renders nothing at all
when it is absent — the same silent-disable posture as `getAnalyticsConfig()`. Otherwise
renders a hidden element carrying the token, the user id and the server-known consent
verdict as `data-` attributes, plus a bundled `<script>` that reads them and calls the
browser module. The component takes the user id and consent verdict as props; it does not
query Supabase itself.

#### 4. Layout wiring

**File**: `src/layouts/Layout.astro`

**Intent**: Mount the analytics script on every page, since every page is a pageview.

**Contract**: Import and render `AnalyticsScript` inside `<head>`, passing
`Astro.locals.user?.id ?? null` and, for now, a consent verdict of `"unknown"` — phase 4
replaces that literal with the real value. No other change to the layout.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Full suite still passes: `npm test`

#### Manual Verification:

- With the app running, every page carries the PostHog script and the browser console shows no errors
- The Network tab shows **zero** requests to `eu.i.posthog.com` on any page, signed in or out — the SDK is loaded and mute
- With `POSTHOG_API_KEY` unset locally, no analytics markup and no script are rendered at all

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding. The "zero requests"
check is the one that proves the ordering is right, and it can only be made in this phase —
after phase 3 there is legitimate traffic to confuse it with.

---

## Phase 3: Consent banner for anonymous traffic

### Overview

The first phase where data actually leaves the browser, and only for a visitor who said
yes. This is what makes anonymous traffic measurable at all.

### Changes Required:

#### 1. Consent storage

**File**: `src/lib/analytics/browser-consent.ts` (new)

**Intent**: Read and write the visitor's own answer, separately from the SDK, so the
banner's state survives the full page loads an MPA does on every navigation.

**Contract**: Two exported functions over one `localStorage` key holding
`"granted" | "denied"`, returning `"unknown"` when absent or unreadable. Every access is
guarded — a browser with storage disabled must degrade to "unknown", never throw.

#### 2. The banner component

**File**: `src/components/analytics/ConsentBanner/ConsentBanner.tsx`, `types.ts`, `index.ts` (new)

**Intent**: Ask once, in plain Polish, what is collected and why, and route the answer to
both the store and the SDK.

**Contract**: Folder-with-barrel shape per `lessons.md`. Renders nothing when the stored
verdict is not `"unknown"` or when the viewer is signed in (their answer lives in their
profile). Two actions, accept and decline, each writing the verdict and calling the
matching entry point on the browser module; accepting must also emit a pageview for the
current page, since the automatic one was suppressed at init. Copy follows
`AnalyticsSection.tsx`'s posture: name the shape of the data, state the boundary about
third parties plainly, and avoid the vague "anonymous usage data" phrasing. A dismiss that
is not an explicit accept counts as neither answer and leaves the banner for next time.

#### 3. Mounting the banner

**File**: `src/components/analytics/AnalyticsScript.astro`

**Intent**: Show the banner only where it applies.

**Contract**: Render the banner as a `client:load` island when the component was given no
user id. Signed-in users never see it.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Full suite still passes: `npm test`

#### Manual Verification:

- A fresh browser profile on `/` shows the banner and sends nothing until it is answered
- Accepting produces a `$pageview` for the current page in the Network tab, and further navigations produce one each, all sharing a session id
- Declining sends nothing, and the banner stays gone across navigations and a browser restart
- On `/people/<uuid>` after accepting, the outbound payload's `$current_url` shows `:id`, and no `token_hash` or `error` parameter appears in any payload
- Keyboard focus reaches both banner actions and the banner does not obscure the landing page's primary call to action

**Implementation Note**: Pause for manual confirmation before phase 4. The payload
inspection above is the human half of the privacy proof that the unit tests cannot make.

---

## Phase 4: Signed-in consent and identity

### Overview

Make the existing profile switch govern the browser channel too, and join the anonymous
session to the account so the funnel and the traffic are one dataset.

### Changes Required:

#### 1. Consent on locals

**File**: `src/middleware.ts`, `src/env.d.ts`

**Intent**: Resolve the signed-in user's analytics consent once per page render, where the
Supabase client already exists.

**Contract**: For document requests with a resolved user, query `profiles` for
`analytics_opt_out` and place the resulting verdict on `context.locals`. Skip the query
entirely for `/api/*` and for anonymous requests. An absent row means consented, matching
`consent.ts:16` and `settings.astro:33`; a query error means no consent, matching
`consent.ts`'s fail-open-to-silence rule. `src/env.d.ts` gains the corresponding optional
field on `App.Locals`, documented like `cfContext` is.

#### 2. Passing the verdict through

**File**: `src/layouts/Layout.astro`

**Intent**: Replace phase 2's `"unknown"` placeholder with the real value.

**Contract**: Pass the verdict from `Astro.locals` to `AnalyticsScript`. Anonymous requests
still resolve to `"unknown"`, which is what keeps the banner in charge for them.

#### 3. Identity lifecycle

**File**: `src/lib/analytics/browser.ts`

**Intent**: Close the loop between the two channels, and make sure signing out does not
leave the next visitor wearing someone else's identity.

**Contract**: The identify-and-reset behaviour specified in phase 2 now runs against a
real user id. Signing in identifies with the Supabase user id — the same `distinct_id` the
five F-06 events use. Signing out, detected as "no user id now, a recorded id before",
resets before any capture on that page load.

#### 4. Settings copy

**File**: `src/components/settings/AnalyticsSection/AnalyticsSection.tsx`

**Intent**: The switch now governs more than it did, and the copy currently promises less
than is collected.

**Contract**: Extend the description to name pages visited and traffic source alongside the
funnel steps it already names, keeping the existing sentence about never collecting names,
descriptions or notes. Behaviour and markup unchanged.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Full suite still passes: `npm test`

#### Manual Verification:

- A signed-in user with the switch on produces pageviews carrying their Supabase user id as the distinct id
- Turning the switch off in Ustawienia stops pageviews on the next navigation, with no banner appearing
- Turning it back on resumes them
- Signing out then browsing anonymously produces events under a fresh anonymous id, not the previous account's
- A signed-in user never sees the consent banner, regardless of what a prior anonymous session stored
- `/dashboard` still renders within its usual time — the added profiles query has not made page rendering visibly slower

**Implementation Note**: Pause for manual confirmation before phase 5.

---

## Phase 5: Catalog, dashboard and production proof

### Overview

Make the repo's own documentation true again, and confirm in PostHog that the data is
both present and clean.

### Changes Required:

#### 1. Relocate and extend the event catalog

**File**: `context/foundation/event-catalog.md` (new), `src/lib/analytics/events.ts` (comment only)

**Intent**: The catalog is the in-repo answer to "what do we track", and it currently lives
inside an archived change folder while `events.ts:24` points at a path that no longer
exists. It also now describes only half the system.

**Contract**: Move the F-06 catalog to `context/foundation/event-catalog.md` verbatim, then
add a section for the browser channel: what `$pageview` and `$pageleave` carry, the
sanitizer's three rules and where they are enforced, the consent model split between the
banner and the profile column, and the fact that person profiles now exist for signed-in
users. State plainly that the closed union in `events.ts` governs the server channel only,
and that the browser channel's guarantee is the sanitizer plus the absence of autocapture.
Update the stale path in the `events.ts` header comment. No code change.

#### 2. Record the deltas

**File**: `context/foundation/lessons.md`

**Intent**: Two findings here generalize beyond this change.

**Contract**: Append two entries in the file's existing format. First: client-context env
vars in Astro are build-time, so a runtime Workers secret that a browser needs is rendered
into the page, not registered as a public var. Second: URLs are a payload — this repo puts
a person id in a path and an auth token in a query string, so anything that forwards a URL
to a third party sanitizes it first.

#### 3. PostHog project configuration

**File**: none (vendor-side)

**Intent**: Turn the raw events into the two artifacts this change was asked for.

**Contract**: In PostHog, confirm the Web Analytics dashboard populates, and save a Trends
insight showing unique users per day over `$pageview` — the DAU number. Record both, with
their PostHog URLs, in the change's `change.md` notes so the next person can find them.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm test`
- Build succeeds: `npm run build`
- Linting passes: `npm run lint`
- The path referenced in the `events.ts` header comment exists: `test -f context/foundation/event-catalog.md`

#### Manual Verification:

- PostHog's Web Analytics tab shows visitors, sessions, top paths and referrers for the deployed site
- A saved DAU insight returns a plausible number
- Spot-checking recent events in PostHog's Activity view: no `$current_url` contains a uuid, a `token_hash`, or an `error` parameter
- A signed-in user's pageviews and their F-06 funnel events appear under one person
- The catalog, read cold, correctly describes both channels

---

## Testing Strategy

### Unit Tests:

- `sanitizeUrl` against the table in phase 1 — uuid masking, query allow-list, fragment
  removal, malformed input, and pass-through of an already-clean path.

### Integration Tests:

None. The behaviour that matters here is what a browser sends to a third party, which this
repo's test layers (`tests/routes`, `tests/http`, `tests/rls`) cannot observe — they run in
node against the app's own surface. Asserting the outbound payload would need the Playwright
layer, which this change deliberately leaves alone.

### Manual Testing Steps:

1. Fresh browser profile, open `/`, confirm the banner and zero outbound requests.
2. Accept, confirm a `$pageview` for the current page, navigate twice, confirm one per page
   sharing a session id.
3. Open a person detail page, inspect the payload, confirm `:id` in place of the uuid.
4. Visit `/auth/signin?error=test`, confirm no `error` parameter in any payload.
5. Sign in, confirm the distinct id becomes the Supabase user id.
6. Turn the switch off in Ustawienia, navigate, confirm silence and no banner.
7. Turn it back on, sign out, browse anonymously, confirm a fresh anonymous id.
8. Decline in a second fresh profile, restart the browser, confirm the banner stays gone and
   nothing is sent.

## Performance Considerations

Two costs, both bounded and both worth naming.

The SDK is roughly 40 kB gzipped on every page, loaded from PostHog's CDN. It is a
`<script>` in `<head>` and must not block rendering.

The middleware's consent query adds one Supabase round trip per document render for
signed-in users. The request already makes one for `auth.getUser()`, and `/people` already
makes a second for its profile gate, so this is a third on those routes and a second
elsewhere — comfortably inside the Worker's 50-subrequest budget, but it is real latency on
every page and the reason the query is scoped to document requests only.

## Migration Notes

No database migration. `profiles.analytics_opt_out` already exists and keeps its meaning;
this change gives it a second consumer.

Rollback is code-only and safe in both directions: reverting the Worker removes the script
and the banner, and the column goes back to governing only the server events. Nothing
written to PostHog is undone by a rollback, which is the usual one-way property of sending
data to a vendor and the reason phases 2 and 3 are separated.

## References

- F-06, the change this extends: `context/archive/2026-09-04-product-analytics-posthog/`
  (its `plan.md`, `event-catalog.md` and `research.md`)
- Roadmap entry and its parked decisions: `context/foundation/roadmap.md:167-181`
- Rules this plan is bound by: `context/foundation/lessons.md`
- The server channel this sits beside: `src/lib/analytics/capture.ts`, `src/lib/analytics/events.ts`
- Consent semantics to mirror: `src/lib/analytics/consent.ts:16`, `src/pages/settings.astro:33`
- Unit test shape to follow: `tests/unit/recency-floor.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: URL sanitizer and its tests

#### Automated

- [x] 1.1 Unit tests pass: `npm test tests/unit/sanitize-url.test.ts` — 4b75491
- [x] 1.2 Full suite still passes: `npm test` — 4b75491
- [x] 1.3 Type checking passes: `npx astro check` — 4b75491
- [x] 1.4 Linting passes: `npm run lint` — 4b75491

#### Manual

- [x] 1.5 Test table names every stripped category without opening the implementation — 4b75491

### Phase 2: PostHog browser client, muted by default

#### Automated

- [x] 2.1 Build succeeds: `npm run build` — f3a34b4
- [x] 2.2 Type checking passes: `npx astro check` — f3a34b4
- [x] 2.3 Linting passes: `npm run lint` — f3a34b4
- [x] 2.4 Full suite still passes: `npm test` — f3a34b4

#### Manual

- [x] 2.5 Script present on every page, no console errors — f3a34b4
- [x] 2.6 Zero requests to eu.i.posthog.com, signed in or out — f3a34b4
- [x] 2.7 No analytics markup rendered when POSTHOG_API_KEY is unset — f3a34b4

### Phase 3: Consent banner for anonymous traffic

> **Dropped 2026-09-10 by decision — not implemented.** The switch under
> Ustawienia → Prywatność is the only consent control; anonymous traffic is
> collected by default. Rationale and the rejected alternatives are in this
> change's `change.md`. The rows below are void and stay unchecked; the phase
> block above is kept as the record of what was considered.

#### Automated

- [ ] 3.1 Build succeeds: `npm run build`
- [ ] 3.2 Type checking passes: `npx astro check`
- [ ] 3.3 Linting passes: `npm run lint`
- [ ] 3.4 Full suite still passes: `npm test`

#### Manual

- [ ] 3.5 Fresh profile shows the banner and sends nothing until answered
- [ ] 3.6 Accepting emits a pageview for the current page; navigations share a session id
- [ ] 3.7 Declining sends nothing and survives a browser restart
- [ ] 3.8 Person-detail payload shows `:id`; no token_hash or error parameter anywhere
- [ ] 3.9 Banner is keyboard reachable and does not obscure the landing CTA

### Phase 4: Signed-in consent and identity

> **Note on 4.6 and 4.9.** Both mention the consent banner, which was dropped
> on 2026-09-10 (see the Phase 3 note). 4.9 holds vacuously — there is no banner
> for anyone to see — and 4.6 was verified on its substantive half, that the
> switch stops pageviews on the next navigation.

#### Automated

- [x] 4.1 Build succeeds: `npm run build`
- [x] 4.2 Type checking passes: `npx astro check`
- [x] 4.3 Linting passes: `npm run lint`
- [x] 4.4 Full suite still passes: `npm test`

#### Manual

- [x] 4.5 Signed-in pageviews carry the Supabase user id as distinct id
- [x] 4.6 Switch off stops pageviews on the next navigation, with no banner
- [x] 4.7 Switch back on resumes them
- [x] 4.8 Sign out then browse anonymously yields a fresh anonymous id
- [x] 4.9 Signed-in user never sees the banner
- [x] 4.10 No visible slowdown on /dashboard from the added profiles query

### Phase 5: Catalog, dashboard and production proof

#### Automated

- [ ] 5.1 Full suite passes: `npm test`
- [ ] 5.2 Build succeeds: `npm run build`
- [ ] 5.3 Linting passes: `npm run lint`
- [ ] 5.4 Catalog exists at the path referenced by events.ts

#### Manual

- [ ] 5.5 Web Analytics tab shows visitors, sessions, top paths and referrers
- [ ] 5.6 Saved DAU insight returns a plausible number
- [ ] 5.7 Spot-check: no uuid, token_hash or error parameter in recent event URLs
- [ ] 5.8 Signed-in pageviews and F-06 funnel events appear under one person
- [ ] 5.9 Catalog read cold describes both channels correctly
