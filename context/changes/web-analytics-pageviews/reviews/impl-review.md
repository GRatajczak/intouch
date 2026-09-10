<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Web Analytics: Pageviews, Sessions and Consent

- **Plan**: context/changes/web-analytics-pageviews/plan.md
- **Scope**: Phases 1, 2, 4, 5 (phase 3 dropped by decision 2026-09-10)
- **Date**: 2026-09-10
- **Verdict**: REJECTED — all findings triaged 2026-09-10: 8 fixed, 1 skipped, 1 accepted
- **Findings**: 3 critical, 7 warnings

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

The three critical findings share one root cause, and it is the corollary this repo
wrote down itself in `lessons.md` §"A URL is a payload": *when a vendor SDK writes
properties itself, ask which hook runs last before the wire.* The sanitizer is correct
and well tested. The layer that decides **which keys to hand it** is an enumeration of
six names, written from a partial reading of the SDK, and never tested.

## Findings

### F1 — Every visit to a person's page sends that contact's real name to PostHog

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; the fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/analytics/browser.ts:51 (URL_PROPERTIES), src/pages/people/[id].astro:33
- **Detail**: `posthog-js` attaches `document.title` to every `$pageview` under the key
  `title` — verified in the installed package: `"$pageview"===i&&s&&(h.title=s.title)`,
  and again on the standalone path `this.capture(En,{title:s.title},…)`. The key is not
  `$`-prefixed and is not a URL, so `scrubBag` never looks at it.
  `src/pages/people/[id].astro:33` renders `<AppShell title={person.name}>`, which reaches
  `<title>` in Layout.astro. So on a person page `document.title` **is the third party's
  name**. This is the first item `src/lib/analytics/events.ts:19` forbids outright, and it
  makes the promise in AnalyticsSection.tsx ("Nigdy imion, opisów ani notatek o Twoich
  ludziach") false. The sanitizer's whole purpose was to stop a `person_id` reaching the
  vendor; the name itself walks past it.
- **Fix**: Add `property_denylist: ["title"]` to the `init` config in browser.ts (verified
  present at `@posthog/types/dist/posthog-config.d.ts:1553`), and drop `title` in
  `scrubBag` as a second line of defence. The app has no use for page titles in analytics.
  - Strength: One config key removes the whole class; the denylist is safe because `title`
    is a fixed SDK-owned name, not app-supplied.
  - Tradeoff: None material — top-paths breakdowns key on the sanitized path, not title.
  - Confidence: HIGH — option verified in the installed types; the leak path was read out
    of the bundle and traced to a real page in this repo.
  - Blind spot: Does not address the underlying habit of putting a contact's name in
    `<title>`, which is also visible in browser history and tab titles on a shared screen.
- **Decision**: FIXED — property_denylist: ["title"] at init plus DROPPED_PROPERTIES in the scrubber. The <title> itself still carries person.name; not changed.

### F2 — Two more SDK-generated URL families reach the wire unsanitized

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; enumeration vs. shape-driven matching
- **Dimension**: Safety & Quality
- **Location**: src/lib/analytics/browser.ts:51-58
- **Detail**: `URL_PROPERTIES` covers `$current_url`, `$pathname`, `$referrer` and their
  `$initial_*` forms. The SDK generates two further families the same way:
  (a) `SessionPropsManager.getSessionProps()` prefixes the session-entry props —
  `getSessionProps(){…"$current_url"===e&&(e="url");t[`$session_entry_${w(e)}`]=i}` —
  producing `$session_entry_url`, `$session_entry_pathname`, `$session_entry_referrer`,
  merged into **every** event's property bag before `before_send` runs;
  (b) `$prev_pageview_pathname`, carried on every `$pageleave`.
  These are frozen at session start and re-emitted for the life of the session, so
  sanitizing `$current_url` does not help them.
  **Concrete failure path from this repo's own code**: `src/lib/reminders/email.ts:143`
  builds the reminder email's primary call to action as `${baseUrl}/people/${hero.person.id}`.
  A user who clicks it starts their session on a person page, so `$session_entry_url`
  carries the raw `person_id` on every event for the rest of that session. The
  `?error=<supabase message>` case arrives the same way via `/auth/reset-password?error=…`.
- **Fix**: Replace the fixed set with a shape-driven predicate that encodes the SDK's own
  prefix+base naming, e.g. `/^\$(initial_|session_entry_)?(current_url|url|pathname|referrer)$/`
  plus a `_url` suffix fallback, and add `$prev_pageview_pathname`. Keep the explicit list
  as documentation.
  - Strength: The SDK has now generated names by prefixing twice; matching on shape
    survives the third time, which an enumeration provably did not.
  - Tradeoff: A regex is less obvious than a list, and must not match `$referring_domain`
    or `$session_entry_host` — hostnames, which sanitizing would corrupt.
  - Confidence: HIGH — both families read out of the installed bundle and the merge order
    relative to `before_send` confirmed.
  - Blind spot: Only the currently-installed version was enumerated. See F7.
- **Decision**: FIXED — shape-driven predicate replacing the enumeration. Verified against 20 key names in both directions.

### F3 — A user who switched analytics OFF still has their browser contact PostHog

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/analytics/AnalyticsScript.astro:30, src/lib/analytics/browser.ts:96-151
- **Detail**: `AnalyticsScript.astro:30` renders the runtime whenever a token exists.
  `consent` is passed *through* to the client, never used to decide whether to load the
  SDK at all. So `posthog.init()` runs for a denied user, and two request paths fire that
  `before_send` cannot see and consent does not gate: the remote-config `GET
  <assets>/array/<token>/config`, and `POST /flags/?v=2`, whose body carries `distinct_id`,
  `$device_id` and `person_properties` including `$initial_current_url` and
  `$initial_pathname`. Neither goes through the `before_send` runner. Compounding it,
  `browser.ts` calls `identify(userId)` after `applyConsent` unconditionally — `identify`
  gates on `person_profiles !== "never"`, not on consent — so the flags request carries the
  real Supabase user id. `applyConsent`'s claim that a denial "mutes" the SDK is true only
  of `capture()`.
- **Fix A ⭐ Recommended**: Gate the mount: `{token && consent !== "denied" && <AnalyticsRuntime … />}`.
  A denied user never downloads `posthog-js`.
  - Strength: Removes every SDK-internal channel at once rather than one at a time, and it
    is the only fix that is robust to future SDK request paths.
  - Tradeoff: A user who switches off mid-session keeps the loaded SDK until the next
    navigation — but it is muted for `capture()`, and F10's observation covers the rest.
  - Confidence: HIGH — the mount point is one line and already conditional on `token`.
  - Blind spot: None significant.
- **Fix B**: Keep loading the SDK, add `advanced_disable_flags: true` to `init` and guard
  `identify` on consent.
  - Strength: Also worth doing on its own merits — the app uses no feature flags, surveys,
    web experiments or remote config, so it is one fewer request for everyone.
  - Tradeoff: Whack-a-mole. It closes the two paths found today and nothing about the next
    one; the SDK still loads and still writes storage for a user who said no.
  - Confidence: MEDIUM — `advanced_disable_flags` verified present, but proving *every*
    remaining request path is gated would need another sweep.
  - Blind spot: Remote config may have paths not enumerated here.
- **Decision**: FIXED via Fix A — AnalyticsScript.astro declines to mount for a denied user, so the SDK never loads.

### F4 — The layer all three critical findings live in has no test

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; needs a small extraction to become testable
- **Dimension**: Architecture
- **Location**: tests/unit/sanitize-url.test.ts, src/lib/analytics/browser.ts:190-215
- **Detail**: The sanitizer's own table is good — 37 cases, drawn from real routes, with
  fail-closed and fixed-point suites. But it tests the *pure function*, and F1, F2 and F3
  are all in the layer that decides which keys to hand it. `scrubUrls`, `scrubBag` and
  `URL_PROPERTIES` are untested, because they sit in the one module that imports
  `posthog-js` and so cannot be loaded in the node test environment. The plan routed
  verification of exactly this layer to a human reading the Network tab.
- **Fix**: Extract `scrubUrls`/`scrubBag`/the key predicate into an import-free
  `src/lib/analytics/scrub-event.ts` — mirroring why `sanitize-url.ts` imports nothing —
  and add `tests/unit/scrub-event.test.ts` feeding it a realistic `CaptureResult`
  containing `title`, `$session_entry_url`, `$prev_pageview_pathname` and
  `$set_once.$initial_current_url`, asserting that no uuid and no name survives anywhere
  in `JSON.stringify(result)`.
  - Strength: That single assertion shape would have caught F1, F2 and F3 before commit.
  - Tradeoff: One more module in the analytics folder.
  - Confidence: HIGH — the extraction is mechanical and the pattern already exists here.
  - Blind spot: Cannot cover F3's bypassing request paths, which need a browser test.
- **Decision**: FIXED — scrubUrls extracted to the import-free src/lib/analytics/scrub-event.ts; tests/unit/scrub-event.test.ts added (31 cases). Mutation-tested: the old enumeration fails 9 of them, removing the title drop fails 3.

### F5 — /people/* and /settings now query the profiles table twice per render

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:27-36 and :46-64
- **Detail**: Two sequential awaited queries against the same table and the same row —
  `select("owner_id")` for the profile gate, then `select("analytics_opt_out")` for
  consent. `/settings` makes it three, since settings.astro selects from that row again.
  Each is a serial round trip on the request path of every document render, added to TTFB
  for all users to serve a feature only analytics needs. `lessons.md` §"astro dev does not
  enforce Cloudflare's production limits" is about exactly this kind of accretion.
- **Fix**: Merge into one query — `select("owner_id, analytics_opt_out")` at the profile
  gate — and derive both verdicts from it. The standalone consent query stays for paths
  that are not profile-gated.
- **Decision**: FIXED — the profile gate and the consent verdict now share one query.

### F6 — A `<div>` is emitted inside `<head>`, which silently closes it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/analytics/AnalyticsRuntime.astro:30, mounted at src/layouts/Layout.astro:66
- **Detail**: `AnalyticsScript` is mounted inside `<head>` and `AnalyticsRuntime` renders a
  `<div>`. Per the HTML parsing spec a `<div>` start tag in the "in head" insertion mode
  pops `<head>` and reprocesses in "after head", opening `<body>`. It works today only
  because the analytics mount is the *last* thing in `<head>`. The moment anyone adds a
  `<meta>` or `<link>` after it in Layout.astro, that tag is silently relocated into the
  body — an invisible SEO regression with every automated check green. Same failure
  signature as the `<Button asChild>` entry in lessons.md.
- **Fix**: Move `<AnalyticsScript … />` to the top of `<body>`. The hoisted script is
  `type="module"` and therefore deferred either way, so behaviour is unchanged.
- **Decision**: FIXED — AnalyticsScript moved to the top of <body>.

### F7 — posthog-js is on a caret range while the privacy guarantee depends on its internals

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: package.json:45
- **Detail**: `"posthog-js": "^1.429.2"`, while browser.ts states that every SDK contract
  was read out of that exact version — and F1, F2 and F3 are all cases where the guarantee
  is an enumeration of that version's property names and request paths. A caret range
  permits a minor bump that adds another generated prefix, which is precisely how
  `$session_entry_*` came to exist alongside `$initial_*`. The repo already pins where an
  exact version matters (`eslint-plugin-jsx-a11y`, `husky`, `prettier-plugin-astro`).
- **Fix**: Pin `"posthog-js": "1.429.2"` and note in browser.ts that a version bump
  requires re-deriving the property surface.
- **Decision**: FIXED — posthog-js pinned to 1.429.2, with a note in browser.ts that a bump requires re-deriving the property surface.

### F8 — The new catalog misdescribes the code in two places

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/event-catalog.md:156-162, src/lib/analytics/sanitize-url.ts:29
- **Detail**: The catalog says the browser channel sends "Two automatic events and nothing
  else", but `identify()` also captures `$identify` (`this.capture(Tn,…)`, `Tn="$identify"`).
  The catalog does describe `identify` in later sections, so nothing is hidden — but the
  sentence a reader would quote when asking "what does the browser send" is wrong, and
  phase 5 exists precisely to stop the catalog misdescribing the code. Separately,
  sanitize-url.ts's comment says "These seven are what PostHog's Web Analytics dashboard
  reads" directly above an eight-element `ATTRIBUTION_PARAMS`.
- **Fix**: Correct both sentences; and once F1/F2 land, the catalog's sanitizer section
  needs to name `title`, `$session_entry_*` and `$prev_pageview_pathname` too.
- **Decision**: FIXED — catalog corrected on $identify and extended with the new property families and the review's findings; sanitize-url.ts comment corrected to eight.

### F9 — middleware duplicates consent.ts, including its log line byte for byte

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/middleware.ts:46-63 vs src/lib/analytics/consent.ts:30-43
- **Detail**: The query, the `maybeSingle()`, the `consentFromOptOut` call and the error
  string are copies. The log message is identical to consent.ts's, so when it fires in
  production you cannot tell whether it came from the middleware (every document render)
  or from `hasAnalyticsConsent` (a server-event gate). The two also encode the same
  fail-closed intent in different vocabularies (`false` vs `"denied"`), which a future
  reader has to reconcile by hand in two places.
- **Fix**: Add `analyticsVerdict(supabase, ownerId): Promise<ConsentVerdict>` to consent.ts
  and call it from the middleware. Give the two call sites distinguishable log prefixes.
- **Decision**: SKIPPED — the substance dissolved into F5: the middleware now calls consentFromOptOut on a row it already holds, which is consent.ts's own documented pattern, and the log prefix is now [middleware]. Two error-mapping lines judged too little to warrant an abstraction.

### F10 — Anonymous visitors get PostHog device storage having been asked nothing

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; this is the scope decision, revisited
- **Dimension**: Safety & Quality
- **Location**: src/lib/analytics/browser.ts:175-181
- **Detail**: `applyConsent` treats `"unknown"` as consent, and `posthog-js` then writes a
  first-party cookie and localStorage for a visitor who has been asked nothing and, having
  no account, has no control. This is a documented decision (change.md, 2026-09-10) taken
  with the banner alternative on the table, and the exposure is the visitor's own data, not
  a third party's — which is why it is a WARNING and not a CRITICAL. It is recorded here
  because config.ts already commits to EU residency on the reasoning that this app holds
  personal data and the user base is Polish, and ePrivacy Art. 5(3) is about storage on the
  device rather than about where the data lands.
- **Fix A ⭐ Recommended**: Accept and leave as decided. The decision was made deliberately
  with the alternatives written down.
  - Strength: Full traffic measurement, which is what the change was for.
  - Tradeoff: Device storage without a consent step for anonymous visitors.
  - Confidence: HIGH — the decision and its rejected alternatives are on record.
  - Blind spot: No legal review was done; this review is not one.
- **Fix B**: `persistence: "memory"` while `consent === "unknown"`.
  - Strength: Keeps landing-page, UTM and referrer numbers without device storage.
  - Tradeoff: The session restarts on every page load in an MPA, so bounce rate and
    session duration stop meaning anything — the exact reason cookieless was rejected.
  - Confidence: MEDIUM — behaviour verified in docs, not in this app.
  - Blind spot: Unique-visitor counts would inflate.
- **Decision**: ACCEPTED — deliberate scope decision of 2026-09-10, taken with the alternatives written down. Full traffic measurement is what the change was for; the exposure is the visitor's own data.

## Smaller observations, not raised as findings

- Turning the switch off on `/settings` does not tell the live PostHog instance, so the
  `$pageleave` for the settings page itself is still captured after the user opted out.
- `https://eu.i.posthog.com` is hardcoded in both browser.ts and config.ts with no link
  between them, though config.ts calls the region a settled one-way door.
- `startAnalytics` has no top-level try/catch, unlike capture.ts ("NEVER THROWS") and
  consent.ts. No page-breaking failure was demonstrated — the caller is a module script,
  so an exception stays isolated.
- `env.d.ts` types `analyticsConsent` by reaching into browser.ts, the one module that
  imports posthog-js, pulling the SDK's types through the global namespace.
- Phase 5 requires the PostHog dashboard and DAU insight URLs to be recorded in change.md.
  They are not there yet; Progress rows 5.5-5.8 are correspondingly unchecked.
- The F-06 catalog now exists in two places: the archived copy and the new living one.
  The server section is verbatim apart from heading demotion, so they do not yet disagree.

## Checked and found sound

Recorded so they are not re-litigated:

- The uuid regex covers every id shape this app uses; all id columns are `uuid` and
  `/people/[id]` is the only dynamic rendered route.
- The middleware query cannot throw: postgrest-js converts network failures into `{error}`
  when `shouldThrowOnError` is false, so the `if (error)` branch really does cover them.
- All thirteen `init` options exist in the installed version — the lessons.md rule about
  verifying config API against node_modules was honoured.
- No double pageview: `opt_in_capturing`'s tail calls the pageview helper synchronously and
  init's `setTimeout` then finds the once-flag set.
- The `reset`-before-`opt_in` ordering is correct and load-bearing.
- `$direct` is correctly excluded from sanitization.
- `sanitize-url.ts` importing nothing, and its absence from the analytics barrel, are both
  correct — exporting it there would drag `astro:env/server` into the client bundle.
- The data-attribute token strategy is what lessons.md prescribes, and the
  AnalyticsScript/AnalyticsRuntime split is a legitimate workaround for the parser
  disagreement.
