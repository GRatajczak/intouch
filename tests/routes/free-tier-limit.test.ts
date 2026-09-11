// POST /api/rankings' daily gate -- S-17's free-tier cap on manual "Przelicz
// teraz" recomputes, once per Europe/Warsaw calendar day, skipped entirely
// for an owner with a usable OpenAI key of their own.
//
// The cross-owner instrument mirrors delete-data.test.ts's / openai-key.test.ts's:
// hand claimFreeRecompute a connection carrying A's session while asking it to
// claim for B's id. RLS alone already refuses to touch B's row from A's
// session, so the property this file actually proves is the one RLS cannot:
// that such a mismatched call does not silently spend A's OWN claim instead --
// which is exactly what happens if claimFreeRecompute's own `.eq("owner_id",
// …)` is deleted, verified by removing it and confirming the last test here
// goes red.
//
// OpenAI validation is stubbed at the network edge -- the technique
// tests/unit/ranking-key-source.test.ts and tests/routes/openai-key.test.ts
// established -- with a passthrough for every other host, since this file
// (like openai-key.test.ts) runs against the real RLS fixture.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRlsFixture, destroyRlsFixture, type RlsFixture } from "../rls/fixture";
import { createContext, jsonBody } from "./context";
import { clearRouteClient, setRouteClient } from "./route-client";
import { claimFreeRecompute } from "@/lib/ranking/free-tier";
import { appCalendarDate } from "@/lib/dates";
import { encryptApiKey } from "@/lib/crypto/api-key";
import { readJob, writeJob, writeLatestRankingJobId } from "@/lib/ai-jobs";

vi.mock("@/lib/supabase", async () => {
  const state = await import("./route-client");
  return { createClient: () => state.getRouteClient() };
});

const { POST: rankings } = await import("@/pages/api/rankings");

let fx: RlsFixture;

beforeAll(async () => {
  fx = await createRlsFixture();
}, 60_000);

afterAll(async () => {
  clearRouteClient();
  await destroyRlsFixture();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubOpenAiFetch(response: Response): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("api.openai.com")) {
        return Promise.resolve(response.clone());
      }
      return realFetch(input, init);
    }),
  );
}

function stubOpenAiSuccess(): void {
  stubOpenAiFetch(
    new Response(
      JSON.stringify({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ entries: [] }) }] }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

function yesterday(): string {
  return appCalendarDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

/**
 * The route dispatches `runRanking` fire-and-forget (`void work`, since a
 * synthetic test context carries no `cfContext.waitUntil`), so a second
 * request issued immediately after the first can still find the first job
 * "pending" and get reused by the in-flight guard before ever reaching the
 * gate. Polling the KV job to a terminal status is what makes "the second
 * request is gated, not reused" an observation about the gate rather than a
 * race with the background job.
 */
async function waitForJobSettled(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const job = await readJob(jobId);
    if (job && job.status !== "pending") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${jobId} never left "pending"`);
}

// fx.clientA / fx.clientB directly, never mintExtraSession: neither
// /api/rankings nor claimFreeRecompute ever calls auth.signOut(), so a fresh
// session per read/write would only spend the stage project's sign-in rate
// limit for nothing.
function clientFor(which: "A" | "B") {
  return which === "A" ? fx.clientA : fx.clientB;
}

async function dateFor(which: "A" | "B"): Promise<string | null> {
  const ownerId = which === "A" ? fx.userAId : fx.userBId;
  const { data } = await clientFor(which)
    .from("profiles")
    .select("free_recompute_claimed_on")
    .eq("owner_id", ownerId)
    .maybeSingle();
  return data?.free_recompute_claimed_on ?? null;
}

async function setDateFor(which: "A" | "B", date: string | null): Promise<void> {
  const ownerId = which === "A" ? fx.userAId : fx.userBId;
  await clientFor(which).from("profiles").update({ free_recompute_claimed_on: date }).eq("owner_id", ownerId);
}

async function setCiphertextFor(which: "A" | "B", ciphertext: string | null): Promise<void> {
  const ownerId = which === "A" ? fx.userAId : fx.userBId;
  await clientFor(which).from("profiles").update({ openai_api_key_ciphertext: ciphertext }).eq("owner_id", ownerId);
}

describe("POST /api/rankings daily gate", () => {
  it("dispatches a key-less owner's first same-day force, and refuses the second with reason daily_limit", async () => {
    await setDateFor("A", null);
    await setCiphertextFor("A", null);
    setRouteClient(fx.clientA);
    stubOpenAiSuccess();

    const first = await rankings(createContext({ user: { id: fx.userAId }, method: "POST", json: { force: true } }));
    expect(first.status).not.toBe(429);
    const firstBody = await jsonBody(first);
    if (typeof firstBody.jobId === "string") {
      await waitForJobSettled(firstBody.jobId);
    }

    const second = await rankings(createContext({ user: { id: fx.userAId }, method: "POST", json: { force: true } }));
    expect(second.status).toBe(429);
    expect(await jsonBody(second)).toMatchObject({ jobId: null, reason: "daily_limit" });
  });

  it("never gates a non-forced call, even after the claim is already spent", async () => {
    await setDateFor("A", appCalendarDate());
    setRouteClient(fx.clientA);
    stubOpenAiSuccess();

    const response = await rankings(createContext({ user: { id: fx.userAId }, method: "POST", json: {} }));

    expect(response.status).not.toBe(429);
  });

  it("never gates an owner whose ciphertext decrypts, no matter how many manual recomputes", async () => {
    const ciphertext = await encryptApiKey("sk-owner-b-real-looking-key-0000000000");
    await setCiphertextFor("B", ciphertext);
    await setDateFor("B", appCalendarDate());
    setRouteClient(fx.clientB);
    stubOpenAiSuccess();

    const first = await rankings(createContext({ user: { id: fx.userBId }, method: "POST", json: { force: true } }));
    const second = await rankings(createContext({ user: { id: fx.userBId }, method: "POST", json: { force: true } }));

    expect(first.status).not.toBe(429);
    expect(second.status).not.toBe(429);
  });

  it("a claim dated yesterday is claimable today; one dated today is not -- boundary in Europe/Warsaw", async () => {
    await setDateFor("A", yesterday());

    const first = await claimFreeRecompute(fx.clientA, fx.userAId);
    expect(first).toBe("claimed");
    expect(await dateFor("A")).toBe(appCalendarDate());

    const second = await claimFreeRecompute(fx.clientA, fx.userAId);
    expect(second).toBe("spent");
  });

  it("does not spend the claim when the in-flight guard reuses an existing job", async () => {
    await setDateFor("A", null);
    setRouteClient(fx.clientA);
    const pendingJobId = crypto.randomUUID();
    await writeJob(pendingJobId, { status: "pending" });
    await writeLatestRankingJobId(fx.userAId, pendingJobId);

    const response = await rankings(createContext({ user: { id: fx.userAId }, method: "POST", json: { force: true } }));

    expect(response.status).toBe(202);
    expect(await jsonBody(response)).toEqual({ jobId: pendingJobId });
    expect(await dateFor("A")).toBeNull();
  });

  it("claiming for B under A's session must not spend A's own claim", async () => {
    await setDateFor("A", null);

    const result = await claimFreeRecompute(fx.clientA, fx.userBId);

    // RLS hides B's row from A's session entirely, so the function reports it
    // as unreachable rather than "spent" -- but the property under test is the
    // second line: A's own claim, which a missing owner filter would spend.
    expect(result).toBe("no-profile");
    expect(await dateFor("A")).toBeNull();
  });
});
