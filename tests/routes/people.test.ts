// test-plan Phase 4, Risk #6a: POST /api/people must bound how many rows one
// request can insert, and must never crash unhandled on a pre-insert failure.
//
// Cap cases run against the real RLS fixture (tests/rls/fixture.ts) so the
// assertion is about the actual enforced boundary at the real route, not a
// schema in isolation. The crash-path case swaps in a purpose-built throwing
// double instead -- forcing a genuine network exception against a live local
// stack is not reliably reproducible, so this file constructs one directly.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRlsFixture, destroyRlsFixture, type RlsFixture } from "../rls/fixture";
import { createContext } from "./context";
import { clearRouteClient, setRouteClient } from "./route-client";
import { PEOPLE_PER_SUBMIT_MAX } from "@/lib/validation/person";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

vi.mock("@/lib/supabase", async () => {
  const state = await import("./route-client");
  return { createClient: () => state.getRouteClient() };
});

const { POST: peoplePost } = await import("@/pages/api/people");

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

/** One row's worth of form fields at index `i`, valid against personSchema. */
function rowFields(i: number): Record<string, string> {
  return {
    [`name-${String(i)}`]: `Person ${String(i)}`,
    [`relationshipType-${String(i)}`]: "friend",
    [`description-${String(i)}`]: `Description ${String(i)}`,
    [`isCollective-${String(i)}`]: "false",
    [`weight-${String(i)}`]: "5",
  };
}

function formForRows(count: number): Record<string, string> {
  const form: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    Object.assign(form, rowFields(i));
  }
  return form;
}

async function countPeople(ownerId: string): Promise<number> {
  const { count } = await fx.clientA.from("people").select("*", { count: "exact", head: true }).eq("owner_id", ownerId);
  return count ?? 0;
}

/**
 * A minimal double whose `people` count query REJECTS -- simulating a genuine
 * network/driver exception, not a returned `{error}` object. `profiles`
 * resolves normally so `hasAnalyticsConsent` behaves as it would for a real
 * account (a missing row already counts as consented either way).
 */
function crashingClient(): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      if (table === "people") {
        return {
          select: () => ({
            eq: () => Promise.reject(new Error("simulated network failure")),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient<Database>;
}

describe("POST /api/people row-count cap and crash guard", () => {
  it(`rejects a submission of ${String(PEOPLE_PER_SUBMIT_MAX + 1)} rows`, async () => {
    setRouteClient(fx.clientA);
    const before = await countPeople(fx.userAId);

    const response = await peoplePost(
      createContext({ user: { id: fx.userAId }, method: "POST", form: formForRows(PEOPLE_PER_SUBMIT_MAX + 1) }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("/people/new?error=");
    expect(await countPeople(fx.userAId)).toBe(before);
  });

  it(`accepts exactly ${String(PEOPLE_PER_SUBMIT_MAX)} rows`, async () => {
    setRouteClient(fx.clientA);
    const before = await countPeople(fx.userAId);

    const response = await peoplePost(
      createContext({ user: { id: fx.userAId }, method: "POST", form: formForRows(PEOPLE_PER_SUBMIT_MAX) }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).not.toContain("error=");
    expect(await countPeople(fx.userAId)).toBe(before + PEOPLE_PER_SUBMIT_MAX);
  });

  it("redirects with an error instead of throwing when the pre-insert check rejects", async () => {
    setRouteClient(crashingClient());

    const response = await peoplePost(
      createContext({ user: { id: fx.userAId }, method: "POST", form: formForRows(1) }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("/people/new?error=");
  });
});
