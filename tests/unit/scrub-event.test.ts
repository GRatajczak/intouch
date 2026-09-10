// The half of the browser channel's privacy guarantee that an implementation
// review found broken in three separate places while tests/unit/sanitize-url.test.ts
// passed all 37 of its cases. That table proves what a URL may say; this one
// proves WHICH properties get treated as URLs at all — the layer the leaks
// were in.
//
// The last describe block is the load-bearing one: it asserts over the whole
// serialized event rather than key by key, so a property family nobody has
// thought of yet still fails the test if it carries a person id or a name.
import { describe, it, expect } from "vitest";
import { scrubEvent, isUrlProperty, DROPPED_PROPERTIES } from "@/lib/analytics/scrub-event";

const PERSON_ID = "3f4a9b2c-7d18-4e6f-9a01-2b5c8d7e6f04";
const PERSON_NAME = "Katarzyna Nowak";
const ORIGIN = "https://get-in-touch.pl";
const PERSON_URL = `${ORIGIN}/people/${PERSON_ID}`;

/**
 * A `$pageleave` fired while leaving a person page, in a session that started
 * on another person page — which is what a reminder email's deep link produces
 * (src/lib/reminders/email.ts links straight to /people/<id>).
 */
function personPageLeave() {
  return {
    event: "$pageleave",
    properties: {
      $current_url: PERSON_URL,
      $pathname: `/people/${PERSON_ID}`,
      $referrer: PERSON_URL,
      $referring_domain: "get-in-touch.pl",
      $host: "get-in-touch.pl",
      title: PERSON_NAME,
      $session_entry_url: PERSON_URL,
      $session_entry_pathname: `/people/${PERSON_ID}`,
      $session_entry_referrer: "$direct",
      $session_entry_host: "get-in-touch.pl",
      $session_entry_utm_source: "reminder",
      $prev_pageview_pathname: `/people/${PERSON_ID}`,
      $session_id: "0198f2c1-aaaa-7000-8000-000000000001",
    },
    $set_once: {
      $initial_current_url: PERSON_URL,
      $initial_pathname: `/people/${PERSON_ID}`,
      $initial_referrer: "$direct",
      $initial_referring_domain: "get-in-touch.pl",
    },
  };
}

describe("isUrlProperty", () => {
  // posthog-js derives these names by prefixing, in four places added at
  // different times. Enumerating them is what failed; this pins the shape.
  it.each([
    "$current_url",
    "$pathname",
    "$referrer",
    "$initial_current_url",
    "$initial_pathname",
    "$initial_referrer",
    "$session_entry_url",
    "$session_entry_pathname",
    "$session_entry_referrer",
    "$prev_pageview_pathname",
  ])("treats %s as a URL", (key) => {
    expect(isUrlProperty(key)).toBe(true);
  });

  // Sanitizing a hostname or a plain value would corrupt it into a path.
  it.each([
    "$referring_domain",
    "$initial_referring_domain",
    "$session_entry_referring_domain",
    "$session_entry_host",
    "$host",
    "$session_entry_utm_source",
    "utm_source",
    "$session_id",
    "$device_id",
  ])("leaves %s alone", (key) => {
    expect(isUrlProperty(key)).toBe(false);
  });

  it("catches a prefixed family nobody has written yet", () => {
    expect(isUrlProperty("$some_future_url")).toBe(true);
  });
});

describe("dropped properties", () => {
  it("removes title, which on a person page is the contact's name", () => {
    const result = scrubEvent(personPageLeave());

    expect(result?.properties).not.toHaveProperty("title");
  });

  it("names title explicitly, so the SDK denylist and this stay in step", () => {
    expect(DROPPED_PROPERTIES.has("title")).toBe(true);
  });
});

describe("URL rewriting across every bag", () => {
  it("masks the person id in the event's own properties", () => {
    const result = scrubEvent(personPageLeave());

    expect(result?.properties.$current_url).toBe(`${ORIGIN}/people/:id`);
    expect(result?.properties.$pathname).toBe("/people/:id");
    expect(result?.properties.$referrer).toBe(`${ORIGIN}/people/:id`);
  });

  // Frozen at session start and re-emitted on every later event, so missing
  // these leaked a person id for a whole session, not just one pageview.
  it("masks the session-entry family", () => {
    const result = scrubEvent(personPageLeave());

    expect(result?.properties.$session_entry_url).toBe(`${ORIGIN}/people/:id`);
    expect(result?.properties.$session_entry_pathname).toBe("/people/:id");
  });

  it("masks the pageleave's previous pathname", () => {
    const result = scrubEvent(personPageLeave());

    expect(result?.properties.$prev_pageview_pathname).toBe("/people/:id");
  });

  // Person properties travel top-level and are merged into `properties` only
  // when the request body is built, so they need their own pass.
  it("masks the initial-person family under $set_once", () => {
    const result = scrubEvent(personPageLeave());

    expect(result?.$set_once.$initial_current_url).toBe(`${ORIGIN}/people/:id`);
    expect(result?.$set_once.$initial_pathname).toBe("/people/:id");
  });

  it("leaves hostnames and attribution values untouched", () => {
    const result = scrubEvent(personPageLeave());

    expect(result?.properties.$referring_domain).toBe("get-in-touch.pl");
    expect(result?.properties.$session_entry_host).toBe("get-in-touch.pl");
    expect(result?.properties.$session_entry_utm_source).toBe("reminder");
  });

  it("leaves the $direct sentinel alone rather than making it a path", () => {
    const result = scrubEvent(personPageLeave());

    expect(result?.properties.$session_entry_referrer).toBe("$direct");
    expect(result?.$set_once.$initial_referrer).toBe("$direct");
  });
});

describe("nothing identifying survives anywhere in the payload", () => {
  // The assertion that would have caught all three review findings at once.
  // Deliberately over the whole serialized event: a property family added by a
  // future SDK version fails here even though no test names it.
  it("carries no person id and no contact name", () => {
    const serialized = JSON.stringify(scrubEvent(personPageLeave()));

    expect(serialized).not.toContain(PERSON_ID);
    expect(serialized).not.toContain(PERSON_NAME);
    expect(serialized).toContain("/people/:id");
  });

  it("carries no auth token and no error message", () => {
    const serialized = JSON.stringify(
      scrubEvent({
        event: "$pageview",
        properties: {
          $current_url: `${ORIGIN}/auth/confirm?token_hash=pkce_9f2b8c&type=recovery`,
          $session_entry_url: `${ORIGIN}/auth/reset-password?error=Token%20has%20expired`,
          title: "InTouch",
        },
      }),
    );

    expect(serialized).not.toContain("pkce_9f2b8c");
    expect(serialized).not.toContain("error");
    expect(serialized).not.toContain("token_hash");
  });
});

describe("the null input before_send is typed for", () => {
  it("returns null rather than throwing", () => {
    expect(scrubEvent(null)).toBeNull();
  });
});
