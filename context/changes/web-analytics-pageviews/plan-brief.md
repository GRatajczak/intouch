# Web Analytics: Pageviews, Sessions and Consent — Plan Brief

> Full plan: `context/changes/web-analytics-pageviews/plan.md`

## What & Why

PostHog is wired into this app, but only for the five server-side funnel events F-06
shipped. There is no `$pageview`, no browser SDK and no way to count daily active users —
three of those five events fire once in an account's lifetime. This change adds a
consent-gated browser channel that emits pageviews and sessions, so the product's traffic
becomes measurable alongside its funnel.

## Starting Point

`src/lib/analytics/` sends five typed events by bare `fetch` from the Worker, keyed by the
Supabase user id, with person profiles suppressed. Consent is a single boolean column
(`profiles.analytics_opt_out`) read server-side, which by definition covers only signed-in
users. PostHog's Web Analytics dashboard is empty because nothing produces the events it
reads.

## Desired End State

An anonymous visitor is asked once whether to allow analytics. If they accept, pageviews
flow and PostHog's Web Analytics dashboard fills with visitors, sessions, bounce rate, top
paths, referrers, UTMs, countries and devices. When they sign in, the browser identifies
them with the same `distinct_id` the funnel events already use, so landing-to-activation
reads as one person and a DAU trend becomes a real number. No URL leaving the page carries
a person id, an auth token, or a Supabase error message.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Channel | `posthog-js` in the layout; funnel stays server-side | Only the browser SDK produces the session data the Web Analytics dashboard reads. |
| Consent for anonymous traffic | Opt-in banner with PostHog's cookies | The app is an MPA, so a cookieless variant would restart the session on every navigation and make bounce rate meaningless. |
| Consent source of truth | Banner governs guests, the profile column governs accounts | Each layer keeps its own ground; the existing switch and the server path are untouched. |
| Person profiles | `identified_only` plus identify on sign-in | Joins the anonymous visit to the account. Server events attach automatically, since a once-identified `distinct_id` stays identified. |
| URL sanitization | Global rewrite: uuid path segments masked, query reduced to a UTM allow-list, fragment dropped | Works for routes that do not exist yet. Research found two leaks, not one: `person_id` in `/people/[id]` and `token_hash` in `/auth/confirm`. |
| Token delivery | Rendered into the page from the existing server secret | Astro's client env vars are build-time; Workers Secrets are runtime. A public var would force the token into GitHub Secrets and a rebuild per rotation. |
| Reverse proxy | Not now | Ad-blocked traffic stays uncounted until there are numbers showing how much that is. |
| SDK scope | Pageviews only | No autocapture, replay, heatmaps, web vitals or exception capture — the app's screens are full of third-party names. |
| Verification | Unit tests on the sanitizer plus a human look in PostHog | The Playwright spec and a `verify:analytics` extension were considered and dropped. |
| `capture.ts` | Untouched | The F-06 funnel needs no change to participate in person profiles. |

## Scope

**In scope:** a pure URL sanitizer with an exhaustive test table; a single browser module
owning every SDK call; a consent banner for guests; consent and identity resolution for
signed-in users; the event catalog moved out of the archive and extended to describe both
channels.

**Out of scope:** autocapture, session replay, heatmaps, web vitals, exception capture, a
reverse proxy, a privacy policy page, Playwright coverage, any change to the five server
events or to `capture.ts`, any database migration.

## Architecture / Approach

Four parts. A pure `sanitize-url.ts` that imports nothing and rewrites any URL-shaped
string. A `browser.ts` that is the only importer of `posthog-js`, initialising it opted out
by default with the sanitizer wired into `before_send`, and owning the identify/reset
lifecycle. A React consent banner that is the only caller of the opt-in. And a consent path
for accounts: middleware reads the column into `locals`, the layout passes it to a
server-rendered mount point that carries the token and user id into the browser as data
attributes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Sanitizer + tests | The privacy invariant as a tested pure function | A rule that looks right but misses a real route's shape |
| 2. Browser client, muted | Complete client that sends nothing | Getting the opt-out-by-default ordering wrong, so a pageview escapes before consent |
| 3. Consent banner | First real traffic, from guests who said yes | The suppressed first pageview is lost if accept does not emit one |
| 4. Signed-in consent + identity | The two channels become one dataset | A stale identity after sign-out attributing a guest to the previous account |
| 5. Catalog, dashboard, proof | Documentation true again; DAU insight saved | Vendor-side config drifting from what the repo claims |

**Prerequisites:** `POSTHOG_API_KEY` already set in all three secret locations (it is, from
F-06). A deployed Worker for phase 5; `astro dev` cannot prove production behaviour.

**Estimated effort:** roughly 3-4 sessions. Phase 1 is short; phases 2 and 3 carry the
manual verification weight.

## Open Risks & Assumptions

- **No privacy policy page exists,** and the landing footer records that its links were
  deliberately omitted for that reason. The banner explains itself inline, which is thinner
  than a policy link. A policy page is a separate change and arguably owed before this ships
  to real traffic.
- **The exact `posthog-js` opt-in API is unverified.** Whether the opt-in call emits its own
  event, and whether it replays a suppressed pageview, must be checked against the installed
  package — `lessons.md` records a case where a plan was right in intent and invented in
  detail.
- **Consent costs one Supabase query per page render** for signed-in users. Bounded and
  scoped to document requests, but it is real latency on every page.
- **The sanitizer cannot protect a URL it never sees.** It covers the properties the SDK
  sends; anything added later that forwards a URL needs the same treatment.
- **Turning on person profiles is not reversible in the data already sent.** Rollback removes
  the code, not the rows.
- **Ad-blocked traffic is silently missing** and its share is unknown until the first data
  arrives.

## Success Criteria (Summary)

- PostHog's Web Analytics dashboard shows real visitors, sessions, top paths and referrers
  for the deployed site.
- A saved Trends insight answers "how many unique users per day" — the DAU number that does
  not exist today.
- Spot-checking recent events, no URL carries a person id, an auth token or an error
  message, and a signed-in user's pageviews sit under the same person as their funnel events.
