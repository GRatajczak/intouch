/**
 * The privacy invariant of the browser analytics channel, as a pure function.
 *
 * The server channel's guarantee is the closed union in ./events.ts: there is
 * no free-form property object, so nothing unsafe can be attached. The browser
 * channel has no such union -- `posthog-js` writes `$current_url`, `$pathname`,
 * `$referrer` and their `$initial_*` counterparts itself, straight off
 * `window.location`. In this app a URL is a payload:
 *
 *   - `/people/<uuid>` carries a `person_id`, which ./events.ts forbids
 *     outright ("a stable identifier that joins straight back to `name` and
 *     `description`").
 *   - `/auth/confirm?token_hash=...` carries a single-use auth token
 *     (src/pages/auth/confirm.ts).
 *   - `?error=<supabase message>` is rendered by signin, signup,
 *     forgot-password, reset-password and people/new.
 *
 * So every URL-shaped property is rewritten through `sanitizeUrl` before an
 * event leaves the page. This module imports NOTHING -- not `astro:env/server`,
 * not Supabase -- so it is safe in a client bundle and testable as a table.
 */

/**
 * The only query parameters that survive.
 *
 * An allow-list, not a deny-list: a deny-list is a promise to have thought of
 * every parameter this app will ever put in a URL, and the two that matter
 * today (`token_hash`, `error`) were both found by reading routes rather than
 * by anticipating them. These seven are what PostHog's Web Analytics dashboard
 * reads for its channels/referrers/campaigns breakdowns; everything else is
 * dropped whether or not it looks sensitive.
 */
export const ATTRIBUTION_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "igshid",
] as const;

const ALLOWED = new Set<string>(ATTRIBUTION_PARAMS);

/** RFC 4122 shape, any version, either case -- what Supabase hands out as an id. */
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What an input that cannot be reduced to a safe URL becomes.
 *
 * Not the original string: failing closed is the whole point, and an input this
 * function could not parse is exactly the input whose contents are unknown.
 * Shaped like a path so it groups as one row in PostHog's top-paths table
 * instead of splitting into noise.
 */
const UNPARSEABLE = "/:unparseable";

/** Only ever used to give a relative input an origin to parse against. */
const SENTINEL_ORIGIN = "http://sanitize.invalid";

/**
 * Rewrite a URL-shaped string so it cannot carry a person id, an auth token or
 * an error message, while preserving what the Web Analytics dashboard reads.
 *
 * Three rules, applied in order:
 *
 *   1. Every path segment shaped like a uuid becomes `:id`.
 *   2. The query string is rebuilt from `ATTRIBUTION_PARAMS` only.
 *   3. The fragment is dropped.
 *
 * Absolute inputs round-trip as absolute, relative ones as relative, so a
 * caller can hand this `$current_url` and `$pathname` alike. Anything that does
 * not parse -- or that is not http(s), which no legitimate page URL is -- comes
 * back as the fixed placeholder.
 */
export function sanitizeUrl(input: string): string {
  if (input.trim() === "") {
    return UNPARSEABLE;
  }

  const parsed = parse(input);
  if (!parsed) {
    return UNPARSEABLE;
  }
  const { url, absolute } = parsed;

  url.pathname = url.pathname.split("/").map(maskUuid).join("/");
  url.search = attributionOnly(url.searchParams).toString();
  url.hash = "";

  return absolute ? url.toString() : `${url.pathname}${url.search}`;
}

function parse(input: string): { url: URL; absolute: boolean } | null {
  try {
    const url = new URL(input);
    // `data:`, `javascript:` and friends parse happily and put their whole
    // payload in `pathname`, where none of the three rules can reach it.
    return url.protocol === "http:" || url.protocol === "https:" ? { url, absolute: true } : null;
  } catch {
    // Not absolute -- try it as a path against a sentinel origin.
  }

  try {
    const url = new URL(input, SENTINEL_ORIGIN);
    // A protocol-relative input (`//host/path`) resolves to a different origin
    // here; returning just its path would silently drop the host it named.
    return url.origin === SENTINEL_ORIGIN ? { url, absolute: false } : null;
  } catch {
    return null;
  }
}

function maskUuid(segment: string): string {
  return UUID_SEGMENT.test(segment) ? ":id" : segment;
}

function attributionOnly(params: URLSearchParams): URLSearchParams {
  const kept = new URLSearchParams();
  // Iterating the input preserves the caller's order and any repeated key,
  // so an untouched attribution query comes back exactly as it went in.
  for (const [key, value] of params) {
    if (ALLOWED.has(key)) {
      kept.append(key, value);
    }
  }
  return kept;
}
