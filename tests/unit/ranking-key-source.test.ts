// S-17: proves which branch runRanking takes on a user-key rejection, without
// asserting on a vendor error string.
//
// This is the network-edge stubbing precedent the test plan's Phase 3 was
// going to set: rather than mocking the `openai` package, a stub
// `globalThis.fetch` stands in for the wire itself, so the real OpenAI SDK --
// request building, response parsing, retry logic -- runs unmodified against
// canned HTTP responses. Everything else runRanking touches (Supabase, the KV job
// store) is faked the same way tests/unit/reminder-sweep.test.ts fakes the
// service-role client: a minimal chain answering only what the code asks.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/db/database.types";
import { runRanking } from "@/lib/ranking/run";
import { encryptApiKey } from "@/lib/crypto/api-key";
import { readJob } from "@/lib/ai-jobs";

const OWNER = "owner-1";
const USER_KEY = "sk-user-owned-key-0123456789";

function profileRow(over: Partial<Tables<"profiles">> = {}): Tables<"profiles"> {
  return {
    owner_id: OWNER,
    name: "Ola",
    birth_date: "1990-01-01",
    life_context: "Pracuje zdalnie.",
    updated_at: new Date().toISOString(),
    availability_windows: [],
    preferred_channels: [],
    reminders_enabled: true,
    weekly_time_budget: null,
    analytics_opt_out: true,
    free_recompute_claimed_on: null,
    openai_api_key_ciphertext: null,
    openai_api_key_hint: null,
    ...over,
  };
}

function personRow(over: Partial<Tables<"people">> = {}): Tables<"people"> {
  return {
    id: "basia",
    owner_id: OWNER,
    name: "Basia",
    description: "Ciocia",
    relationship_type: "family",
    relationship_context: null,
    context_tags: [],
    last_contact_bucket: null,
    is_collective: false,
    status: "active",
    weight: 9,
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/**
 * Answers only what runRanking asks: the profile read, the people read, the
 * (empty) contact-events read, and the two writes persistRanking issues on a
 * successful run. Anything else throws, so a run that starts querying
 * something new fails loudly here rather than silently passing.
 */
function fakeSupabase(profile: Tables<"profiles">, people: Tables<"people">[]): SupabaseClient<Database> {
  const table = (name: string) => {
    const rows: Record<string, unknown>[] =
      name === "profiles"
        ? [profile]
        : name === "people"
          ? people
          : name === "contact_events"
            ? []
            : name === "rankings"
              ? [
                  {
                    id: "ranking-1",
                    owner_id: OWNER,
                    model: "gpt-5.4-mini",
                    people_considered: people.length,
                    people_total: people.length,
                    created_at: new Date().toISOString(),
                  },
                ]
              : name === "ranking_entries"
                ? []
                : (() => {
                    throw new Error(`unexpected table read: ${name}`);
                  })();

    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "insert"]) {
      builder[method] = () => builder;
    }
    builder.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    builder.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    builder.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
      resolve({ data: rows, error: null });
    return builder;
  };

  return { from: (name: string) => table(name) } as unknown as SupabaseClient<Database>;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function authenticationErrorResponse(): Response {
  return jsonResponse(401, { error: { message: "Incorrect API key provided.", type: "invalid_request_error" } });
}

function rateLimitErrorResponse(): Response {
  return jsonResponse(429, { error: { message: "You exceeded your current quota.", type: "insufficient_quota" } });
}

function successResponse(): Response {
  return jsonResponse(200, {
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              entries: [
                {
                  personId: "basia",
                  timeWindow: "this_week",
                  reason: "Minęło sporo czasu.",
                  contextNote: null,
                  rhythmNote: null,
                },
              ],
            }),
          },
        ],
      },
    ],
  });
}

/** Installs a one-shot fetch stub and returns it so a test can inspect its calls. */
function stubFetch(response: Response) {
  const fetchMock = vi.fn(() => Promise.resolve(response.clone()));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function authorizationHeader(fetchMock: ReturnType<typeof vi.fn>): string | null {
  const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
  return new Headers(init.headers).get("authorization");
}

// Each test uses its own jobId, so no shared KV state to reset between them.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runRanking key routing and failure classification", () => {
  it("names the rejected key, not a quota, on a user-key 401 -- and makes exactly one call", async () => {
    const ciphertext = await encryptApiKey(USER_KEY);
    const supabase = fakeSupabase(profileRow({ openai_api_key_ciphertext: ciphertext }), [personRow()]);
    const fetchMock = stubFetch(authenticationErrorResponse());

    const status = await runRanking(OWNER, supabase, "job-401");

    expect(status).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authorizationHeader(fetchMock)).toBe(`Bearer ${USER_KEY}`);
    const job = await readJob("job-401");
    expect(job?.error).toContain("odrzucił");
    expect(job?.error).not.toContain("limit");
  });

  it("names the quota, not a rejection, on a user-key 429 -- and makes exactly one call", async () => {
    const ciphertext = await encryptApiKey(USER_KEY);
    const supabase = fakeSupabase(profileRow({ openai_api_key_ciphertext: ciphertext }), [personRow()]);
    const fetchMock = stubFetch(rateLimitErrorResponse());

    const status = await runRanking(OWNER, supabase, "job-429");

    expect(status).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const job = await readJob("job-429");
    expect(job?.error).toContain("limit");
    expect(job?.error).not.toContain("odrzucił");
  });

  it("calls with the app key when the owner has no ciphertext, and succeeds", async () => {
    const supabase = fakeSupabase(profileRow({ openai_api_key_ciphertext: null }), [personRow()]);
    const fetchMock = stubFetch(successResponse());

    const status = await runRanking(OWNER, supabase, "job-app-key");

    expect(status).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authorizationHeader(fetchMock)).not.toBe(`Bearer ${USER_KEY}`);
    const job = await readJob("job-app-key");
    expect(job?.status).toBe("done");
  });
});
