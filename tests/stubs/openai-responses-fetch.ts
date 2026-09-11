// Stubs `globalThis.fetch` to stand in for the wire to OpenAI's Responses API,
// so the real SDK -- request building, response parsing, retry logic,
// zodTextFormat/output_parsed extraction -- runs unmodified against canned
// HTTP responses. Extracted from tests/unit/ranking-key-source.test.ts (S-17),
// "the network-edge stubbing precedent the test plan's Phase 3 was going to
// set: rather than mocking the `openai` package, a stub `globalThis.fetch`
// stands in for the wire itself."
import { vi } from "vitest";
import type { RankingOutputEntry } from "@/lib/validation/ranking";

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Installs a one-shot fetch stub and returns it so a test can inspect its calls. */
export function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve(response.clone()));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function authorizationHeader(fetchMock: ReturnType<typeof vi.fn>): string | null {
  const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
  return new Headers(init.headers).get("authorization");
}

export function authenticationErrorResponse(): Response {
  return jsonResponse(401, { error: { message: "Incorrect API key provided.", type: "invalid_request_error" } });
}

export function rateLimitErrorResponse(): Response {
  return jsonResponse(429, { error: { message: "You exceeded your current quota.", type: "insufficient_quota" } });
}

/** A `status: "completed"` Responses-API payload carrying exactly the given entries. */
export function rankingSuccessResponse(entries: RankingOutputEntry[]): Response {
  return jsonResponse(200, {
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ entries }),
          },
        ],
      },
    ],
  });
}

/**
 * A `status: "completed"` payload with no output_text message at all, so
 * `response.output_parsed` ends up falsy -- the "total parse failure" branch
 * (run.ts's `if (!parsed) throw ...`), distinct from a schema-valid-but-empty
 * `entries` array.
 */
export function noOutputResponse(): Response {
  return jsonResponse(200, { status: "completed", output: [] });
}
