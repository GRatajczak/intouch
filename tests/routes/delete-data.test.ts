// The blast radius of the repo's most destructive route.
//
// POST /api/settings/delete-data wipes people, rankings and profiles for the
// caller. Two things must hold: an anonymous caller cannot trigger it at all, and
// a signed-in caller's wipe stops at their own owner_id. What is deliberately NOT
// asserted here is completeness -- "no row of A's survives anywhere" is risk #2 in
// the test plan and belongs to its own phase. This file is about access, not erasure.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRlsFixture, destroyRlsFixture, type RlsFixture, type TableName } from "../rls/fixture";
import { createContext, jsonBody } from "./context";
import { clearRouteClient, setRouteClient } from "./route-client";

vi.mock("@/lib/supabase", async () => {
  const state = await import("./route-client");
  return { createClient: () => state.getRouteClient() };
});

const { POST: deleteData } = await import("@/pages/api/settings/delete-data");

let fx: RlsFixture;

beforeAll(async () => {
  fx = await createRlsFixture();
}, 60_000);

afterAll(async () => {
  clearRouteClient();
  await destroyRlsFixture();
});

describe("POST /api/settings/delete-data", () => {
  it("refuses an anonymous caller and never builds a client", async () => {
    // No client installed. The guard runs first, so the handler returns 401; had it
    // fallen through, createClient would have yielded null and the route would have
    // answered 500 "Supabase nie jest skonfigurowany" instead -- a different failure
    // that this assertion would catch.
    clearRouteClient();

    const response = await deleteData(createContext({ user: null }) as never);

    expect(response.status).toBe(401);
    expect(await jsonBody(response)).toEqual({ error: "Musisz być zalogowany" });

    // Nothing was touched: both users still hold everything they were seeded with.
    expect(await ownedCount(fx.clientA, "people")).toBe(1);
    expect(await ownedCount(fx.clientB, "people")).toBe(1);
  });

  it("wipes the caller's own data and leaves the other user's intact", async () => {
    // Both users are fully seeded going in, so "B's rows survived" is a real
    // observation rather than a vacuous one over empty tables.
    expect(await ownedCount(fx.clientB, "people")).toBe(1);
    expect(await ownedCount(fx.clientB, "rankings")).toBe(1);
    expect(await ownedCount(fx.clientB, "profiles")).toBe(1);

    setRouteClient(fx.clientA);
    const response = await deleteData(createContext({ user: { id: fx.userAId } }) as never);

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ success: true });

    // A's own data is gone -- enough to show the route actually ran. Whether every
    // last trace of A survives elsewhere is risk #2's question, not this one's.
    expect(await ownedCount(fx.clientA, "people")).toBe(0);

    // The property this test exists for: A's wipe did not reach across owners.
    expect(await ownedCount(fx.clientB, "people")).toBe(1);
    expect(await ownedCount(fx.clientB, "rankings")).toBe(1);
    expect(await ownedCount(fx.clientB, "profiles")).toBe(1);
  });
});

/** How many rows of `table` this client can see -- under RLS, exactly its own. */
async function ownedCount(client: RlsFixture["clientA"], table: TableName): Promise<number> {
  const { data } = await client.from(table).select("owner_id");
  return data?.length ?? 0;
}
