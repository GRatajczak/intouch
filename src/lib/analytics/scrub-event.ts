import { sanitizeUrl } from "./sanitize-url";

/**
 * The property-selection half of the browser channel's privacy guarantee.
 *
 * ./sanitize-url.ts decides what a URL may say. This file decides WHICH
 * properties are URLs, and which are dropped outright — and that is the half
 * that was wrong. An implementation review found three separate leaks here
 * while the sanitizer's own 37-case table passed: `document.title` (a
 * contact's name on a person page), the `$session_entry_*` family, and
 * `$prev_pageview_pathname`.
 *
 * It lives apart from ./browser.ts for the same reason ./sanitize-url.ts does:
 * that module imports `posthog-js`, which cannot be loaded in the node test
 * environment, so anything inside it is unreachable from `tests/unit`. This
 * file imports nothing but the sanitizer, so the guarantee is testable as a
 * table rather than as a human squinting at a Network tab.
 *
 * Structurally typed against `posthog-js`'s `CaptureResult` rather than
 * importing it, which keeps the SDK out of this module entirely.
 */

/**
 * The shape `before_send` receives — the fields of it that matter here.
 *
 * `posthog-js` merges the top-level `$set` / `$set_once` into `properties`
 * only later, when the request body is built, so both have to be walked.
 */
export interface ScrubbableEvent {
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

/**
 * `$referrer`'s value for traffic that arrived with no referrer. A sentinel,
 * not a URL — feeding it to `sanitizeUrl` would turn it into the path
 * `/$direct` and quietly break the channels breakdown.
 */
const DIRECT_REFERRER = "$direct";

/**
 * Properties removed outright rather than rewritten.
 *
 * `title` is `document.title`, which on `/people/[id]` is a third party's name
 * — the first thing ./events.ts forbids. It arrives under a bare key with no
 * `$` prefix and is not a URL, so no amount of URL rewriting would have caught
 * it. Also removed by `property_denylist` at init; the two are one careless
 * edit apart, and only this one is under test.
 */
export const DROPPED_PROPERTIES = new Set(["title"]);

/**
 * The URL-shaped property names, matched by SHAPE rather than enumerated.
 *
 * This began as a list of six names and was wrong, which is the argument for
 * the regex. `posthog-js` does not write these names literally — it derives
 * them by prefixing a small set of base names, in four places added at
 * different times:
 *
 *   - bare, off `window.location`: `$current_url`, `$pathname`, `$referrer`
 *   - `persistence.get_initial_props()` prefixes `$initial_`
 *   - `SessionPropsManager.getSessionProps()` prefixes `$session_entry_`, and
 *     renames `$current_url` to plain `url` on the way
 *   - `PageViewManager` emits `$prev_pageview_pathname` on `$pageleave`
 *
 * An enumeration must be re-derived every time the vendor adds a fifth. The
 * `$session_entry_*` family proved the cost: those values are frozen at session
 * start and re-emitted on EVERY subsequent event, so a user arriving from a
 * reminder email's `/people/<uuid>` link (src/lib/reminders/email.ts) carried a
 * raw person id on every event for the rest of their session.
 *
 * Deliberately NOT matched: `$referring_domain`, `$session_entry_host`,
 * `$initial_referring_domain` and the `utm_*` families. Those are hostnames and
 * plain values, not URLs — `sanitizeUrl` would corrupt them into paths.
 */
const URL_PROPERTY = /^\$(?:initial_|session_entry_|prev_pageview_)?(?:current_url|url|pathname|referrer)$/;

export function isUrlProperty(key: string): boolean {
  // The suffix check is the catch-all for a family nobody has written yet:
  // anything named `*_url` is a URL, whatever prefix the vendor invents next.
  return URL_PROPERTY.test(key) || key.endsWith("_url");
}

/**
 * Rewrite every URL-shaped property and remove every forbidden one, in place.
 *
 * Wired to `before_send`, the last hook before an event is queued. It is the
 * one place that catches properties the SDK wrote itself — which is all of the
 * ones that matter, since none of them come from this repo's code.
 *
 * Mutates and returns the event. Returning `null` would drop it; nothing here
 * drops. The `null` input case is real: `posthog-js` types `before_send` as
 * `(cr: CaptureResult | null) => CaptureResult | null`.
 */
export function scrubEvent<T extends ScrubbableEvent>(result: T | null): T | null {
  if (!result) {
    return null;
  }

  scrubBag(result.properties);
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

    if (DROPPED_PROPERTIES.has(key)) {
      // `Reflect.deleteProperty`, not `delete bag[key]`: the repo's eslint
      // config forbids a dynamically computed delete. Genuinely removes the
      // key rather than leaving it undefined.
      Reflect.deleteProperty(bag, key);
      continue;
    }

    if (isUrlProperty(key)) {
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
