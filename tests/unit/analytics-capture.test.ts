// test-plan Phase 6, Risk #9: capture()'s payload contract -- the exact POST
// shape, the property allow-list plus $process_person_profile: false, and the
// never-throws guarantee (a non-2xx response or a rejected fetch both resolve
// normally). Stubs globalThis.fetch at the network edge, mirroring
// tests/routes/free-tier-limit.test.ts's stubOpenAiFetch technique applied to
// PostHog's host instead of OpenAI's.
import { afterEach, describe, expect, it, vi } from "vitest";
import { capture } from "@/lib/analytics/capture";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

function stubPostHogFetch(response: Response): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === "string" ? init.body : "{}";
      captured.push({ url, body: JSON.parse(body) as Record<string, unknown> });
      return Promise.resolve(response.clone());
    }),
  );
  return captured;
}

function okResponse(): Response {
  return new Response(null, { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("capture() payload contract", () => {
  it("posts to PostHog's capture endpoint with exactly the allow-listed properties", async () => {
    const captured = stubPostHogFetch(okResponse());

    await capture("owner-1", {
      event: "hierarchy_generated",
      properties: { model: "gpt-5.4-mini", people_total: 3, people_considered: 3, duration_ms: 4200 },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://eu.i.posthog.com/i/v0/e/");
    expect(captured[0].body.event).toBe("hierarchy_generated");
    expect(captured[0].body.distinct_id).toBe("owner-1");
    expect(captured[0].body.properties).toEqual({
      model: "gpt-5.4-mini",
      people_total: 3,
      people_considered: 3,
      duration_ms: 4200,
      $process_person_profile: false,
    });
  });

  it("resolves without throwing when PostHog answers a non-2xx status", async () => {
    stubPostHogFetch(new Response(null, { status: 500 }));

    await expect(capture("owner-1", { event: "signup_started" })).resolves.toBeUndefined();
  });

  it("resolves without throwing when the fetch itself rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    await expect(capture("owner-1", { event: "signup_started" })).resolves.toBeUndefined();
  });
});
