import posthog from "posthog-js";
import { scrubEvent } from "./scrub-event";

/**
 * The only file in this app that imports `posthog-js`.
 *
 * Everything the browser channel is allowed to do passes through here:
 * initialization, the consent gate, and the identify/reset lifecycle. No page
 * or component reaches the SDK directly, so no caller can skip a rule -- the
 * same containment argument src/lib/analytics/events.ts makes for the server
 * channel, made structurally rather than by a closed union.
 *
 * Bundled for the client only. Nothing here may touch `astro:env/server`; the
 * project token arrives as an argument, rendered into the page by
 * src/components/analytics/AnalyticsScript.astro.
 *
 * Every SDK contract below was read out of node_modules/posthog-js@1.429.2
 * rather than taken from a doc, per the lessons.md rule about plans that are
 * right in intent and invented in detail. The two that changed the design are
 * called out at their call sites.
 *
 * `posthog-js` is PINNED to an exact version in package.json, not a caret
 * range, and that is load-bearing rather than cautious. The privacy guarantee
 * in ./scrub-event.ts is derived from THIS version's property names and request
 * paths; a minor bump is exactly how the `$session_entry_*` family came to
 * exist alongside `$initial_*`, and it leaked a person id for a whole session
 * before a review caught it. Re-derive the property surface before bumping.
 */

/** PostHog Cloud EU, matching src/lib/analytics/config.ts's one-way-door choice. */
const POSTHOG_HOST = "https://eu.i.posthog.com";

/**
 * Who we last told PostHog this browser is.
 *
 * Our own key, not a read of PostHog internals: the only question asked of it
 * is "did somebody sign out since the last page load", and that answer must
 * survive the SSR round trip an MPA does on every navigation.
 */
const IDENTITY_KEY = "intouch.analytics.identified-as";

/**
 * What the server knows about this visitor's analytics consent.
 *
 * `"unknown"` is not a refusal and not a pending question -- it means nobody is
 * signed in, so there is no `profiles` row to read a verdict from. Anonymous
 * traffic is collected by default; see `applyConsent`.
 */
export type ConsentVerdict = "granted" | "denied" | "unknown";

export interface StartAnalyticsOptions {
  /** The PostHog project token, rendered into the page by the server. */
  token: string;
  /** The signed-in user's Supabase id, or `null` for anonymous traffic. */
  userId: string | null;
  /**
   * What the server knows about consent.
   *
   * `"granted"` / `"denied"` come from `profiles.analytics_opt_out`.
   * `"unknown"` means anonymous, which resolves to collecting.
   */
  consent: ConsentVerdict;
}

/**
 * Load PostHog, mute it, then decide whether to unmute.
 *
 * Called once per page load. The order below is not cosmetic:
 *
 *   1. `init` with `opt_out_capturing_by_default`, so the SDK is inert the
 *      moment it exists.
 *   2. `reset` for a stale identity, BEFORE any opt-in. `reset()` clears stored
 *      consent along with the identity, so calling it after `opt_in_capturing()`
 *      would silently re-mute the SDK -- the package's own docs flag this.
 *   3. Apply consent.
 *   4. Identify, if there is somebody to identify.
 */
export function startAnalytics({ token, userId, consent }: StartAnalyticsOptions): void {
  posthog.init(token, {
    api_host: POSTHOG_HOST,

    // Person profiles only once somebody is identified, so anonymous traffic
    // stays counted but not profiled.
    person_profiles: "identified_only",

    // Autocapture reads text out of the DOM, and this app's screens are full of
    // third parties' names and descriptions. Off, permanently -- see the plan's
    // "What We're NOT Doing".
    autocapture: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_performance: false,
    capture_exceptions: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_web_experiments: true,

    // The app is an MPA: no ClientRouter, no view transitions, every navigation
    // is a full page load. So `true` (one pageview per load) is right and
    // `'history_change'` would be dead weight. `$pageleave` is what makes
    // bounce rate and session duration real numbers rather than blanks.
    capture_pageview: true,
    capture_pageleave: true,

    // Nothing is sent until something calls `opt_in_capturing()`. This is the
    // ordering the whole privacy posture rests on.
    opt_out_capturing_by_default: true,

    // `document.title` rides on every `$pageview` under the key `title` -- no
    // `$` prefix, not a URL, so `before_send`'s URL pass would never look at
    // it. On /people/[id] that title IS the contact's name (the page renders
    // `<AppShell title={person.name}>`), which is the first thing
    // ./events.ts forbids. Analytics has no use for page titles here; the path
    // is what the dashboard reads.
    property_denylist: ["title"],

    before_send: scrubEvent,
  });

  const previousIdentity = readIdentity();
  if (userId === null && previousIdentity !== null) {
    // Sign-out is a POST that redirects to `/` (src/pages/api/auth/signout.ts)
    // and never touches browser storage. Without this, the next anonymous
    // visitor on this browser is attributed to the account that just left.
    posthog.reset();
    writeIdentity(null);
  }

  applyConsent(consent);

  if (userId !== null) {
    // The Supabase user id, which is exactly the `distinct_id` the five F-06
    // server events already use -- that shared key is what makes the funnel and
    // the traffic one dataset. Guarded on the SDK's own view of who it is
    // rather than on our record, so a cleared localStorage still re-identifies.
    if (posthog.get_distinct_id() !== userId) {
      posthog.identify(userId);
    }
    writeIdentity(userId);
  }
}

/**
 * `"denied"` mutes. Everything else unmutes.
 *
 * A denied user does not normally reach this function at all --
 * AnalyticsScript.astro declines to mount the SDK for them, because muting only
 * stops `capture()` and not the SDK's own config and flags requests. This
 * branch remains as the second gate for the case where a verdict arrives after
 * init.
 *
 * `"unknown"` -- an anonymous visitor -- collects. There is no consent banner:
 * anonymous traffic is exactly the traffic this channel exists to measure (the
 * landing page, referrers, UTMs, the path into signup), and none of it happens
 * after a `profiles` row exists to carry a verdict. The control is the switch
 * under Ustawienia -> Prywatnosc, which governs from the moment there is an
 * account to attach it to. Dropping the banner was a deliberate scope decision
 * on 2026-09-10, recorded in this change's change.md.
 *
 * `opt_in_capturing()` captures an `$opt_in` event by default; suppressed here
 * because this runs on EVERY page load for a consenting visitor, and one
 * `$opt_in` per pageview is noise, not consent.
 *
 * It also ends by firing the initial `$pageview` itself -- the SDK's
 * `opt_in_capturing` tail is `this.config.capture_pageview && this.Bu()`, and
 * `Bu()` carries a once-per-load flag. So the pageview suppressed at init is
 * not lost, and nothing else should capture one to "recover" it: that would
 * double-count. The plan assumed the opposite and was checked against the
 * installed package instead.
 */
function applyConsent(consent: ConsentVerdict): void {
  if (consent === "denied") {
    posthog.opt_out_capturing();
    return;
  }
  posthog.opt_in_capturing({ captureEventName: false });
}

function readIdentity(): string | null {
  try {
    return window.localStorage.getItem(IDENTITY_KEY);
  } catch {
    // Storage disabled. Degrading to "we have never identified anyone" costs a
    // missed reset on sign-out; throwing here would cost the whole page.
    return null;
  }
}

function writeIdentity(userId: string | null): void {
  try {
    if (userId === null) {
      window.localStorage.removeItem(IDENTITY_KEY);
    } else {
      window.localStorage.setItem(IDENTITY_KEY, userId);
    }
  } catch {
    // As above: storage is a convenience here, never a requirement.
  }
}
