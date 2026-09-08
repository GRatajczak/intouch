// Astro's origin check, pinned as an executable rule.
//
// context/foundation/lessons.md records this the hard way: Astro runs an
// origin-check middleware BEFORE routing, and rejects any unsafe-method request
// that carries no content-type, or a form-like one, unless Origin matches the
// request URL's origin. The response is 403 "Cross-site POST form submissions are
// forbidden" and it never reaches the route -- so an auth bug and a CSRF rejection
// look nothing alike, and the message talks about form submissions even when the
// caller sent no form.
//
// Encoding it here means a future contributor's mystery 403 is diagnosable from a
// test name instead of from an afternoon.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, createHttpFixture, destroyHttpFixture, type HttpFixture } from "./fixture";

let fx: HttpFixture;

describe.skipIf(!BASE_URL)("Astro's origin check", () => {
  beforeAll(async () => {
    fx = await createHttpFixture();
  }, 120_000);

  afterAll(async () => {
    await destroyHttpFixture();
  });

  it("lets a JSON body through to the route, which then judges it on auth", async () => {
    const response = await fetch(`${fx.baseUrl}/api/rankings`, {
      method: "POST",
      // A non-form content-type skips the check entirely -- no Origin needed.
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(401);
  });

  it("rejects a form-encoded body with no Origin, before routing", async () => {
    const response = await fetch(`${fx.baseUrl}/api/people`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "x" }),
    });

    // 403, not the route's own 302-to-sign-in: the request never got that far.
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Cross-site POST form submissions are forbidden");
  });

  it("accepts the same form-encoded body once Origin matches", async () => {
    const response = await fetch(`${fx.baseUrl}/api/people`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: fx.baseUrl },
      body: new URLSearchParams({ name: "x" }),
    });

    // Reached the route, which redirected it for having no session. The status
    // difference from the previous test is the whole point.
    expect(response.status).toBe(302);
  });

  it("rejects a bodiless POST, which carries no content-type at all", async () => {
    // /api/settings/delete-data reads no body (delete-data.ts:15-44), so a caller
    // has nothing to attach a content-type to -- the case most likely to surprise
    // a machine caller, and the one the lessons entry was written about.
    const response = await fetch(`${fx.baseUrl}/api/settings/delete-data`, { method: "POST" });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Cross-site POST form submissions are forbidden");
  });

  it("accepts the same bodiless POST once Origin matches", async () => {
    const response = await fetch(`${fx.baseUrl}/api/settings/delete-data`, {
      method: "POST",
      headers: { Origin: fx.baseUrl },
    });

    // Reached the route, which refused it on auth rather than on origin.
    expect(response.status).toBe(401);
  });

  it("exempts GET, which needs neither a content-type nor an Origin", async () => {
    const response = await fetch(`${fx.baseUrl}/api/rankings?jobId=none`);

    expect(response.status).toBe(401);
  });
});
