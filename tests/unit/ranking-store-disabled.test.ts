// The prompt sent to OpenAI contains a third party's name, description and
// contact notes. OpenAI's Responses API stores a response for at least 30 days
// unless the request says `store: false`, and that default is silent -- nothing
// fails if the field is dropped. This pins the request body on the wire, for
// both key sources, so removing it from run.ts turns a test red.
//
// Same network-edge stubbing as ranking-key-source.test.ts: the real SDK builds
// the request, a stub `fetch` captures it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRanking } from "@/lib/ranking/run";
import { encryptApiKey } from "@/lib/crypto/api-key";
import { profileRow, personRow, fakeSupabase } from "../stubs/fake-ranking-supabase";
import { stubFetch, rankingSuccessResponse } from "../stubs/openai-responses-fetch";

const OWNER = "owner-1";

afterEach(() => {
  vi.unstubAllGlobals();
});

function successForBasia() {
  return rankingSuccessResponse([
    { personId: "basia", timeWindow: "this_week", reason: "Minęło sporo czasu.", contextNote: null, rhythmNote: null },
  ]);
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("runRanking asks OpenAI not to store the request", () => {
  it("sends store:false with the app's own key", async () => {
    const supabase = fakeSupabase(profileRow(), [personRow()]);
    const fetchMock = stubFetch(successForBasia());

    await runRanking(OWNER, supabase, "job-store-app-key");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody(fetchMock).store).toBe(false);
  });

  it("sends store:false with a user's own key", async () => {
    const ciphertext = await encryptApiKey("sk-user-owned-key-0123456789");
    const supabase = fakeSupabase(profileRow({ openai_api_key_ciphertext: ciphertext }), [personRow()]);
    const fetchMock = stubFetch(successForBasia());

    await runRanking(OWNER, supabase, "job-store-user-key");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody(fetchMock).store).toBe(false);
  });
});
