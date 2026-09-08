// The cookie -> middleware -> locals.user -> guard chain, over real HTTP.
//
// Risk #5 names this assumption directly, and it is the one thing tests/routes
// cannot reach: that layer hands `locals.user` to the handler, so it proves the
// guard given a user, not that a real session cookie produces one.
//
// An honest note about middleware, because the test name would otherwise overclaim:
// src/middleware.ts:4 lists /dashboard, /profile, /people and /settings -- NOT /api.
// So middleware runs for API requests and sets locals.user, but does not gate them.
// What this file proves is that the per-route guards work *behind* real middleware.
// The one assertion about middleware actually gating something uses a page route.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, SKIP_REASON, createHttpFixture, destroyHttpFixture, type HttpFixture } from "./fixture";

let fx: HttpFixture;

describe.skipIf(!BASE_URL)("HTTP access boundary", () => {
  beforeAll(async () => {
    fx = await createHttpFixture();
  }, 120_000);

  afterAll(async () => {
    await destroyHttpFixture();
  });

  describe("with no cookie at all", () => {
    it("returns the JSON routes' own 401 rather than a middleware redirect", async () => {
      const response = await fetch(`${fx.baseUrl}/api/rankings`, {
        method: "POST",
        // JSON skips the origin check, so the request reaches the route and is
        // judged on auth. A form-like body would be rejected earlier -- that is
        // origin-check.test.ts's subject, not this one's.
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    it("returns the settings routes' own Polish 401", async () => {
      const response = await fetch(`${fx.baseUrl}/api/settings/delete-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Musisz być zalogowany" });
    });

    it("redirects the form-posted route to sign-in", async () => {
      const response = await fetch(`${fx.baseUrl}/api/people`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: fx.baseUrl },
        body: new URLSearchParams({ name: "x", relationshipType: "friend", description: "x", weight: "5" }),
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/auth/signin");
    });

    it("has middleware gate a PAGE route, which is the only thing it is configured to gate", async () => {
      const response = await fetch(`${fx.baseUrl}/dashboard`, { redirect: "manual" });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/auth/signin");
    });
  });

  describe("with a real session cookie", () => {
    it("turns user A's cookie into locals.user, so the guard lets them through", async () => {
      const response = await fetch(`${fx.baseUrl}/api/contact-events?personId=${encodeURIComponent(personIdA())}`, {
        headers: { Cookie: fx.jarA },
      });

      // The whole chain in one assertion: cookie parsed, session validated,
      // locals.user populated by middleware, guard satisfied, owner filter applied.
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect((body as { events: unknown[] }).events).toHaveLength(1);
    });

    it("refuses user B's cookie against user A's event, and A's row survives", async () => {
      const before = await readOwnEvents(fx.jarA);

      const response = await fetch(`${fx.baseUrl}/api/contact-events/${eventIdA()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: fx.jarB },
        body: JSON.stringify({ note: "tampered over HTTP" }),
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Nie znaleziono zdarzenia" });

      // Independent victim-side read, over HTTP, as the only user who can see it.
      expect(await readOwnEvents(fx.jarA)).toEqual(before);
    });

    it("lets user A edit their own event through the same route (control)", async () => {
      const response = await fetch(`${fx.baseUrl}/api/contact-events/${eventIdA()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: fx.jarA },
        body: JSON.stringify({ note: "edited by its owner" }),
      });

      expect(response.status).toBe(200);
    });

    it("shows user B nothing when they ask about user A's person", async () => {
      const response = await fetch(`${fx.baseUrl}/api/contact-events?personId=${encodeURIComponent(personIdA())}`, {
        headers: { Cookie: fx.jarB },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ events: [] });
    });
  });
});

// Skipped suites are easy to miss, so the reason gets its own line the reporter
// prints as a test name rather than being buried behind a verbose flag.
describe.runIf(!BASE_URL)("HTTP layer (skipped)", () => {
  it(SKIP_REASON, () => {
    expect(BASE_URL).toBeNull();
  });
});

const personIdA = () => fx.users.seededA.people.id as string;
const eventIdA = () => fx.users.seededA.contact_events.id as string;

async function readOwnEvents(jar: string): Promise<unknown> {
  const response = await fetch(`${fx.baseUrl}/api/contact-events?personId=${encodeURIComponent(personIdA())}`, {
    headers: { Cookie: jar },
  });
  return await response.json();
}
