// test-plan Phase 3, Risks #3 and #4: every runRanking exit path must reach a
// real terminal job status, and a response that addressed nobody it was sent
// must fail visibly instead of rendering a fully-fabricated ranking.
//
// Uses the same network-edge stubbing precedent as tests/unit/ranking-key-source.test.ts
// (S-17): a fake in-memory Supabase client plus a stubbed globalThis.fetch
// standing in for the OpenAI wire, so the real SDK runs unmodified.
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRanking } from "@/lib/ranking/run";
import { readJob } from "@/lib/ai-jobs";
import { profileRow, personRow, fakeSupabase } from "../stubs/fake-ranking-supabase";
import { stubFetch, rankingSuccessResponse, noOutputResponse } from "../stubs/openai-responses-fetch";

const OWNER = "owner-1";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runRanking terminal states", () => {
  it("fails the job when the response matched nobody it was sent (Risk #3: total fallback)", async () => {
    const supabase = fakeSupabase(profileRow(), [
      personRow({ id: "basia" }),
      personRow({ id: "celina", name: "Celina" }),
    ]);
    // Neither entry's personId matches a sent person -- the model hallucinated
    // both ids, which is reconcileEntries' "matched nobody" case just like an
    // empty `entries: []` array would be.
    stubFetch(
      rankingSuccessResponse([
        { personId: "ghost-1", timeWindow: "this_week", reason: "n/a", contextNote: null, rhythmNote: null },
      ]),
    );

    const status = await runRanking(OWNER, supabase, "job-total-fallback");

    expect(status).toBe("failed");
    const job = await readJob("job-total-fallback");
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("matched no person sent");
    expect(job?.rankingId).toBeUndefined();
  });

  it("keeps today's per-person fallback when the response addresses some but not all sent people (control)", async () => {
    const supabase = fakeSupabase(profileRow(), [
      personRow({ id: "basia" }),
      personRow({ id: "celina", name: "Celina" }),
    ]);
    // Only "basia" addressed -- "celina" is omitted, not hallucinated.
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

    const status = await runRanking(OWNER, supabase, "job-partial-fallback");

    expect(status).toBe("done");
    const job = await readJob("job-partial-fallback");
    expect(job?.status).toBe("done");
    expect(job?.rankingId).toBeDefined();
  });

  it("succeeds when the response addresses every sent person (happy-path control)", async () => {
    const supabase = fakeSupabase(profileRow(), [personRow({ id: "basia" })]);
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

    const status = await runRanking(OWNER, supabase, "job-success");

    expect(status).toBe("done");
    const job = await readJob("job-success");
    expect(job?.status).toBe("done");
    expect(job?.rankingId).toBeDefined();
  });

  it("fails the job when there is no profile row for this account", async () => {
    const supabase = fakeSupabase(null, [personRow()]);

    const status = await runRanking(OWNER, supabase, "job-no-profile");

    expect(status).toBe("failed");
    const job = await readJob("job-no-profile");
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("No profile found for this account");
  });

  it("fails the job when there are no people for this account", async () => {
    const supabase = fakeSupabase(profileRow(), []);

    const status = await runRanking(OWNER, supabase, "job-no-people");

    expect(status).toBe("failed");
    const job = await readJob("job-no-people");
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("No people found for this account");
  });

  it("fails the job on a total parse failure (no output_text message at all)", async () => {
    const supabase = fakeSupabase(profileRow(), [personRow()]);
    stubFetch(noOutputResponse());

    const status = await runRanking(OWNER, supabase, "job-no-output");

    expect(status).toBe("failed");
    const job = await readJob("job-no-output");
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("OpenAI response had no parsed output");
  });
});
