// The opt-in HTTP layer's harness.
//
// This layer exists for the one thing neither cheaper layer can reach: that a real
// session cookie becomes `locals.user` through real middleware, and that the guards
// sit behind Astro's origin check exactly as deployed. Everything else is proven
// more cheaply in tests/rls and tests/routes.
//
// THE SUITE NEVER STARTS A SERVER. The developer starts one; this layer skips
// cleanly when TEST_BASE_URL is unset, so `npm test` stays green for someone who
// has not. A wrong TEST_BASE_URL, however, fails loudly -- silently skipping a
// misconfigured run would be worse than not running at all.
import { createRlsFixture, destroyRlsFixture, type Credentials, type RlsFixture } from "../rls/fixture";

// Harness-only, and deliberately not `astro:env/server`: this value addresses the
// server from outside it, never reaches the app, and must be absent by default so
// the layer can skip. The project's "config comes from astro:env/server" rule is
// about the app's own runtime config and is untouched by this.
const RAW_BASE_URL = process.env.TEST_BASE_URL;

/** Set when the layer is enabled; `null` means skip, never fail. */
export const BASE_URL: string | null = RAW_BASE_URL ? RAW_BASE_URL.replace(/\/$/, "") : null;

export const SKIP_REASON =
  "TEST_BASE_URL is not set. Start a server yourself (npm run dev), then run: " +
  "TEST_BASE_URL=http://localhost:4321 npm test tests/http";

export interface HttpFixture {
  baseUrl: string;
  users: RlsFixture;
  /** A `Cookie:` header value carrying user A's real session, minted by the app itself. */
  jarA: string;
  jarB: string;
}

export async function createHttpFixture(): Promise<HttpFixture> {
  if (!BASE_URL) throw new Error(SKIP_REASON);

  await assertServerReachable(BASE_URL);

  // The dev server reads .dev.vars, which points at the same local stack these
  // users are created in -- so a user minted here can sign in over there.
  await warmRoutes(BASE_URL);

  const users = await createRlsFixture();

  return {
    baseUrl: BASE_URL,
    users,
    jarA: await mintJar(BASE_URL, users.credentialsA, "A"),
    jarB: await mintJar(BASE_URL, users.credentialsB, "B"),
  };
}

export async function destroyHttpFixture(): Promise<void> {
  await destroyRlsFixture();
}

/**
 * Signs in through the app's own route and harvests the cookies it sets.
 *
 * Deliberately not hand-crafted: @supabase/ssr chunks the session across
 * `sb-<ref>-auth-token.0` / `.1`, an internal format that shifts between versions.
 * Letting the app mint them is the only way this layer proves anything about the
 * real cookie -> middleware -> locals.user chain rather than about our imitation of it.
 */
async function mintJar(baseUrl: string, credentials: Credentials, label: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/signin`, {
    method: "POST",
    // redirect: "manual" keeps the 302's Set-Cookie headers from being consumed by a follow.
    redirect: "manual",
    // Form-encoded is form-like to Astro's origin check, so Origin must match or the
    // request is rejected before it ever reaches the route. See tests/http/origin-check.
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: baseUrl },
    body: new URLSearchParams({ ...credentials }),
  });

  const location = response.headers.get("location") ?? "";
  if (location.includes("error=")) {
    throw new Error(`sign-in for user ${label} was rejected: ${decodeURIComponent(location)}`);
  }

  const setCookies = response.headers.getSetCookie();
  if (setCookies.length === 0) {
    // Aborting here rather than returning an empty jar: every later assertion would
    // fail for the wrong reason, and "401 because no cookie" reads exactly like the
    // bug this layer is meant to catch.
    throw new Error(`sign-in for user ${label} returned no session cookies (status ${String(response.status)})`);
  }

  return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

/**
 * Compiles every route this layer touches, before any assertion runs.
 *
 * `astro dev` transforms a route's whole module graph on first request, so the
 * first call to /api/rankings -- which reaches openai and the ranking runner --
 * took over five seconds while every later call took under one. Left in place that
 * cost lands inside a test, where it reads as a hang rather than as compilation,
 * and it made the default 5s timeout fire on a route that answers in 90ms warm.
 *
 * Paying it here keeps per-test timings meaningful and a genuine hang still fails
 * fast. Every request below is anonymous and none carries a session cookie -- this
 * runs before any jar is minted -- so warming cannot create or change data. The
 * routes get there by different means, which is worth knowing before adding a
 * target: most refuse on their `locals.user` guard, while /api/auth/signin has no
 * guard to refuse on (sign-in is inherently anonymous) and instead throws on
 * `request.formData()`, because the body below is JSON. Both outcomes are inert
 * here; a new target that is neither would not be.
 */
async function warmRoutes(baseUrl: string): Promise<void> {
  const json = { "Content-Type": "application/json" };
  const targets: [string, RequestInit][] = [
    ["/dashboard", {}],
    ["/api/rankings?jobId=none", {}],
    ["/api/contact-events?personId=none", {}],
    ["/api/settings/delete-data", { method: "POST", headers: json, body: "{}" }],
    ["/api/contact-events/none", { method: "PATCH", headers: json, body: "{}" }],
    ["/api/people", { method: "POST", headers: { ...json }, body: "{}" }],
    ["/api/auth/signin", { method: "POST", headers: json, body: "{}" }],
  ];

  await Promise.all(
    targets.map(([path, init]) => fetch(`${baseUrl}${path}`, { ...init, redirect: "manual" }).catch(() => undefined)),
  );
}

async function assertServerReachable(baseUrl: string): Promise<void> {
  let status: number;
  try {
    status = (await fetch(baseUrl, { redirect: "manual" })).status;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `TEST_BASE_URL is set to ${baseUrl}, but nothing answered there (${reason}). ` +
        "Start the server yourself, fix the URL, or unset TEST_BASE_URL to skip this layer.",
    );
  }
  if (status >= 500) {
    throw new Error(`TEST_BASE_URL is set to ${baseUrl}, but it answered ${String(status)}. Is that the right server?`);
  }
}
