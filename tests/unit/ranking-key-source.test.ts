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
//
// The fake-Supabase and fetch-stub helpers below moved to tests/stubs/ in
// test-plan Phase 3, so tests/unit/ranking-terminal-states.test.ts (Risks #3
// and #4) can reuse them without re-implementing this file's fixtures.
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRanking } from "@/lib/ranking/run";
import { encryptApiKey } from "@/lib/crypto/api-key";
import { readJob } from "@/lib/ai-jobs";
import { profileRow, personRow, fakeSupabase } from "../stubs/fake-ranking-supabase";
import {
  stubFetch,
  authorizationHeader,
  authenticationErrorResponse,
  rateLimitErrorResponse,
  rankingSuccessResponse,
} from "../stubs/openai-responses-fetch";

const OWNER = "owner-1";
const USER_KEY = "sk-user-owned-key-0123456789";

// Each test uses its own jobId, so no shared KV state to reset between them.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runRanking key routing and failure classification", () => {
  it("names the rejected key, not a quota, on a user-key 401 -- and makes exactly one call", async () => {
    const ciphertext = await encryptApiKey(USER_KEY);
    const profile = profileRow({ openai_api_key_ciphertext: ciphertext });
    const supabase = fakeSupabase(profile, [personRow()]);
    const fetchMock = stubFetch(authenticationErrorResponse());

    const status = await runRanking(OWNER, supabase, "job-401");

    expect(status).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authorizationHeader(fetchMock)).toBe(`Bearer ${USER_KEY}`);
    const job = await readJob("job-401");
    expect(job?.error).toContain("odrzucił");
    expect(job?.error).not.toContain("limit");
    // Phase 5: a rejected USER key marks the owner's row, so /settings can
    // say so without anyone having to watch this background job.
    expect(profile.openai_api_key_failure_reason).toBe("auth");
    expect(profile.openai_api_key_failed_at).not.toBeNull();
  });

  it("names the quota, not a rejection, on a user-key 429 -- and makes exactly one call", async () => {
    const ciphertext = await encryptApiKey(USER_KEY);
    const profile = profileRow({ openai_api_key_ciphertext: ciphertext });
    const supabase = fakeSupabase(profile, [personRow()]);
    const fetchMock = stubFetch(rateLimitErrorResponse());

    const status = await runRanking(OWNER, supabase, "job-429");

    expect(status).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const job = await readJob("job-429");
    expect(job?.error).toContain("limit");
    expect(job?.error).not.toContain("odrzucił");
    expect(profile.openai_api_key_failure_reason).toBe("quota");
    expect(profile.openai_api_key_failed_at).not.toBeNull();
  });

  it("clears an earlier failure mark on a successful run made with a user key", async () => {
    const ciphertext = await encryptApiKey(USER_KEY);
    const profile = profileRow({
      openai_api_key_ciphertext: ciphertext,
      openai_api_key_failed_at: "2026-01-01T00:00:00.000Z",
      openai_api_key_failure_reason: "auth",
    });
    const supabase = fakeSupabase(profile, [personRow()]);
    stubFetch(
      rankingSuccessResponse([
        {
          personId: "basia",
          timeWindow: "this_week",
          reason: "Minęło sporo czasu.",
          contextNote: null,
          rhythmNote: null,
        },
      ]),
    );

    const status = await runRanking(OWNER, supabase, "job-cleared");

    expect(status).toBe("done");
    expect(profile.openai_api_key_failed_at).toBeNull();
    expect(profile.openai_api_key_failure_reason).toBeNull();
  });

  it("calls with the app key when the owner has no ciphertext, and succeeds", async () => {
    const supabase = fakeSupabase(profileRow({ openai_api_key_ciphertext: null }), [personRow()]);
    const fetchMock = stubFetch(
      rankingSuccessResponse([
        {
          personId: "basia",
          timeWindow: "this_week",
          reason: "Minęło sporo czasu.",
          contextNote: null,
          rhythmNote: null,
        },
      ]),
    );

    const status = await runRanking(OWNER, supabase, "job-app-key");

    expect(status).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authorizationHeader(fetchMock)).not.toBe(`Bearer ${USER_KEY}`);
    const job = await readJob("job-app-key");
    expect(job?.status).toBe("done");
  });
});
