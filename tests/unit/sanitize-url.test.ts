// The unit half of this change's privacy proof. The other half is a human
// reading outbound payloads in the Network tab (plan.md, phase 3) -- this file
// exists so that a future edit which loosens a rule fails here first.
//
// Every case is drawn from a route that actually exists in this repo, so the
// table doubles as the list of things a URL in this app is known to carry.
// Pure function, so no fixtures, no mocks -- same shape as recency-floor.test.ts.
import { describe, it, expect } from "vitest";
import { sanitizeUrl, ATTRIBUTION_PARAMS } from "@/lib/analytics/sanitize-url";

const UNPARSEABLE = "/:unparseable";
const PERSON_ID = "3f4a9b2c-7d18-4e6f-9a01-2b5c8d7e6f04";
const OTHER_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const ORIGIN = "https://get-in-touch.pl";

describe("sanitizeUrl", () => {
  describe("rule 1: a uuid path segment is a person id", () => {
    it.each([
      [`/people/${PERSON_ID}`, "/people/:id"],
      [`/people/${PERSON_ID}/edit`, "/people/:id/edit"],
      [`${ORIGIN}/people/${PERSON_ID}`, `${ORIGIN}/people/:id`],
      [`/people/${PERSON_ID}/contacts/${OTHER_ID}`, "/people/:id/contacts/:id"],
      [`/people/${PERSON_ID.toUpperCase()}`, "/people/:id"],
    ])("masks %s", (input, expected) => {
      expect(sanitizeUrl(input)).toBe(expected);
    });

    it("leaves a segment that merely looks id-ish alone", () => {
      expect(sanitizeUrl("/people/new")).toBe("/people/new");
      expect(sanitizeUrl("/people/not-a-uuid-at-all")).toBe("/people/not-a-uuid-at-all");
    });
  });

  describe("rule 2: the query string is an allow-list", () => {
    // src/pages/auth/confirm.ts:19 -- a single-use token, in a URL, in the bar.
    it("drops a Supabase auth token", () => {
      expect(sanitizeUrl("/auth/confirm?token_hash=pkce_9f2b8c&type=recovery")).toBe("/auth/confirm");
    });

    // signin, signup, forgot-password, reset-password and people/new all render this.
    it("drops a rendered Supabase error message", () => {
      expect(sanitizeUrl("/auth/signin?error=Invalid%20login%20credentials")).toBe("/auth/signin");
    });

    it("keeps an attribution-only query verbatim", () => {
      const query = "utm_source=newsletter&utm_medium=email&utm_campaign=launch";

      expect(sanitizeUrl(`/?${query}`)).toBe(`/?${query}`);
    });

    it("keeps only the allow-listed keys from a mixed query", () => {
      expect(sanitizeUrl("/dashboard?utm_source=twitter&error=nope&token_hash=abc&fbclid=IwAR1")).toBe(
        "/dashboard?utm_source=twitter&fbclid=IwAR1",
      );
    });

    it.each(ATTRIBUTION_PARAMS.map((param) => [param]))("keeps %s", (param) => {
      expect(sanitizeUrl(`/?${param}=value`)).toBe(`/?${param}=value`);
    });

    it("strips the query from a person page without losing the mask", () => {
      expect(sanitizeUrl(`${ORIGIN}/people/${PERSON_ID}?error=boom`)).toBe(`${ORIGIN}/people/:id`);
    });
  });

  describe("rule 3: the fragment is dropped", () => {
    it.each([
      ["/settings#prywatnosc", "/settings"],
      [`${ORIGIN}/settings?utm_source=email#prywatnosc`, `${ORIGIN}/settings?utm_source=email`],
      [`/people/${PERSON_ID}#notes`, "/people/:id"],
    ])("drops the fragment of %s", (input, expected) => {
      expect(sanitizeUrl(input)).toBe(expected);
    });
  });

  describe("failing closed", () => {
    it.each([
      ["", "empty string"],
      ["   ", "whitespace"],
      ["http://", "a scheme with no host"],
      ["data:text/html,<b>hi</b>", "a data URL, whose payload lives in the path"],
      ["javascript:alert(document.cookie)", "a javascript URL"],
      ["//evil.example/people", "a protocol-relative URL naming another host"],
    ])("returns the placeholder for %s (%s)", (input) => {
      expect(sanitizeUrl(input)).toBe(UNPARSEABLE);
    });
  });

  describe("clean URLs pass through", () => {
    it.each([
      ["/dashboard", "/dashboard"],
      ["/", "/"],
      ["/people", "/people"],
      [`${ORIGIN}/dashboard`, `${ORIGIN}/dashboard`],
      [`${ORIGIN}/`, `${ORIGIN}/`],
    ])("leaves %s unchanged", (input, expected) => {
      expect(sanitizeUrl(input)).toBe(expected);
    });
  });

  describe("the output is a fixed point", () => {
    it.each([
      `/people/${PERSON_ID}?token_hash=abc#x`,
      `${ORIGIN}/auth/signin?error=nope`,
      "data:text/html,x",
      "/dashboard?utm_source=email",
    ])("sanitizing %s twice changes nothing the second time", (input) => {
      const once = sanitizeUrl(input);

      expect(sanitizeUrl(once)).toBe(once);
    });
  });
});
