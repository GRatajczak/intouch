// eraseAnalyticsSubject: a no-op without its secrets, the exact PostHog request
// when configured, and the never-throws guarantee (a non-2xx answer or a failed
// fetch both resolve). Stubs fetch at the network edge, like analytics-capture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

async function loadErase(secrets: { key?: string; project?: string }) {
  vi.resetModules();
  vi.doMock("astro:env/server", () => ({
    POSTHOG_PERSONAL_API_KEY: secrets.key,
    POSTHOG_PROJECT_ID: secrets.project,
  }));
  return await import("@/lib/analytics/erase");
}

function stubFetch(response: Response | Error): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({
        url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>,
      });
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    }),
  );
  return captured;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("astro:env/server");
});

describe("eraseAnalyticsSubject", () => {
  it("does nothing, and sends nothing, when the secrets are absent", async () => {
    const { eraseAnalyticsSubject } = await loadErase({});
    const captured = stubFetch(new Response(null, { status: 200 }));

    await expect(eraseAnalyticsSubject("user-1")).resolves.toBeUndefined();

    expect(captured).toHaveLength(0);
  });

  it("does nothing when only one of the two secrets is set", async () => {
    const { eraseAnalyticsSubject } = await loadErase({ key: "phx_key" });
    const captured = stubFetch(new Response(null, { status: 200 }));

    await eraseAnalyticsSubject("user-1");

    expect(captured).toHaveLength(0);
  });

  it("posts a bulk_delete for the distinct id with the personal key", async () => {
    const { eraseAnalyticsSubject } = await loadErase({ key: "phx_key", project: "12345" });
    const captured = stubFetch(new Response(null, { status: 200 }));

    await eraseAnalyticsSubject("user-1");

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://eu.posthog.com/api/projects/12345/persons/bulk_delete/");
    expect(captured[0].headers.Authorization).toBe("Bearer phx_key");
    expect(captured[0].body).toEqual({ ids: [], distinct_ids: ["user-1"], delete_events: true });
  });

  it("resolves without throwing when PostHog answers a non-2xx status", async () => {
    const { eraseAnalyticsSubject } = await loadErase({ key: "phx_key", project: "12345" });
    stubFetch(new Response(null, { status: 500 }));

    await expect(eraseAnalyticsSubject("user-1")).resolves.toBeUndefined();
  });

  it("resolves without throwing when the fetch itself rejects", async () => {
    const { eraseAnalyticsSubject } = await loadErase({ key: "phx_key", project: "12345" });
    stubFetch(new Error("network down"));

    await expect(eraseAnalyticsSubject("user-1")).resolves.toBeUndefined();
  });
});
