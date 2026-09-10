import posthog from "posthog-js";
import type { CaptureResult } from "posthog-js";
import { sanitizeUrl } from "./sanitize-url";

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
 * `$referrer`'s value for traffic that arrived with no referrer. It is a
 * sentinel, not a URL -- feeding it to `sanitizeUrl` would turn it into the
 * path `/$direct` and quietly break the channels breakdown.
 */
const DIRECT_REFERRER = "$direct";

/**
 * The properties `posthog-js` fills from `window.location` and `document.referrer`.
 *
 * The `$initial_*` ones are generated, not literal, in the SDK: persistence's
 * `get_initial_props()` prefixes stored referrer and campaign info with
 * `$initial_`, and the result is merged into `$set_once` on identify. So they
 * are listed here explicitly rather than discovered.
 */
const URL_PROPERTIES = new Set([
  "$current_url",
  "$pathname",
  "$referrer",
  "$initial_current_url",
  "$initial_pathname",
  "$initial_referrer",
]);

export type ConsentVerdict = "granted" | "denied" | "unknown";

export interface StartAnalyticsOptions {
  /** The PostHog project token, rendered into the page by the server. */
  token: string;
  /** The signed-in user's Supabase id, or `null` for anonymous traffic. */
  userId: string | null;
  /** What the server knows about consent. `"unknown"` leaves the SDK muted. */
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

    before_send: scrubUrls,
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
 * `"granted"` unmutes, `"denied"` mutes, `"unknown"` leaves the decision open.
 *
 * `opt_in_capturing()` captures an `$opt_in` event by default; suppressed here
 * because this runs on EVERY page load for a consenting visitor, and one
 * `$opt_in` per pageview is noise, not consent.
 *
 * It also ends by firing the initial `$pageview` itself -- the SDK's
 * `opt_in_capturing` tail is `this.config.capture_pageview && this.Bu()`, and
 * `Bu()` carries a once-per-load flag. So the pageview suppressed at init is
 * not lost, and nothing else should capture one to "recover" it: that would
 * double-count. (The plan assumed the opposite; see the phase 3 note.)
 */
function applyConsent(consent: ConsentVerdict): void {
  if (consent === "granted") {
    posthog.opt_in_capturing({ captureEventName: false });
    return;
  }
  if (consent === "denied") {
    posthog.opt_out_capturing();
  }
}

/**
 * Rewrite every URL-shaped property through the sanitizer, on the way out.
 *
 * `before_send` is the last hook before an event is queued, and it sees the
 * whole `CaptureResult`, so it is the one place that catches properties the SDK
 * wrote itself -- which is all of the ones that matter here, since none of them
 * come from our code.
 *
 * Returning `null` would drop the event; nothing here drops. The signature is
 * `(cr: CaptureResult | null) => CaptureResult | null`, so the null input case
 * is real and has to be handled.
 */
function scrubUrls(result: CaptureResult | null): CaptureResult | null {
  if (!result) {
    return null;
  }

  scrubBag(result.properties);
  // Person properties travel top-level on the CaptureResult and are merged into
  // `properties` only later, when the request is built -- so they need their own
  // pass. `$initial_current_url` and `$initial_referrer` land here.
  scrubBag(result.$set);
  scrubBag(result.$set_once);

  return result;
}

function scrubBag(bag: Record<string, unknown> | undefined): void {
  if (!bag) {
    return;
  }

  for (const key of Object.keys(bag)) {
    const value = bag[key];

    if (URL_PROPERTIES.has(key)) {
      if (typeof value === "string" && value !== DIRECT_REFERRER) {
        bag[key] = sanitizeUrl(value);
      }
      continue;
    }

    if ((key === "$set" || key === "$set_once") && isBag(value)) {
      scrubBag(value);
    }
  }
}

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
