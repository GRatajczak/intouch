// The blast radius of the repo's most destructive route.
//
// POST /api/settings/delete-data wipes people, rankings and profiles for the
// caller. Three things must hold: an anonymous caller cannot trigger it at all, a
// caller's wipe stops at their own owner_id, and the wipe actually happens. What is
// deliberately NOT asserted here is completeness -- "no row of A's survives
// anywhere" is risk #2 in the test plan and belongs to its own phase. This file is
// about access, not erasure.
//
// TWO THINGS THIS FILE HAS TO WORK AROUND
//
// 1. RLS would absorb a missing owner filter. Run this route under the caller's own
//    session and every row it can reach is already the caller's, so deleting
//    `.eq("owner_id", user.id)` from delete-data.ts changes nothing observable. The
//    instrument is cross-owner.test.ts's: hand the handler a connection carrying A's
//    real session while `locals.user` says the caller is B. The route's own filter is
//    then the only thing standing between the handler and A's data. Verified by
//    removing all three filters -- the "wipes only what the handler was told to"
//    test goes red, and nothing else does.
//
// 2. The route signs out the client it was handed (delete-data.ts:42). Any
//    assertion made through that client afterwards returns zero rows because the
//    session is gone, not because the data is -- which would pass whether or not
//    the delete ran. Every post-state read below therefore goes through a session
//    minted after the route returned, via `mintExtraSession`.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRlsFixture,
  destroyRlsFixture,
  mintExtraSession,
  type RlsFixture,
  type TableName,
  type TestClient,
} from "../rls/fixture";
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

  it("wipes only what the handler was told to, not everything the connection can reach", async () => {
    // A's connection, but the handler believes the caller is B. A's rows are the
    // only rows this connection can see, so RLS permits deleting all of them -- the
    // route's own owner filter is what must refuse. Read as: "when this handler
    // believes the caller is B, it must not wipe data owned by A, even on a
    // connection that would allow it."
    setRouteClient(fx.clientA);
    const response = await deleteData(createContext({ user: { id: fx.userBId } }) as never);

    expect(response.status).toBe(200);

    // Through a session the route did not sign out (see note 2 at the top).
    const observerA = await mintExtraSession(fx, "A");
    expect(await ownedCount(observerA, "people")).toBe(1);
    expect(await ownedCount(observerA, "rankings")).toBe(1);
    expect(await ownedCount(observerA, "profiles")).toBe(1);

    // B, whose id the handler was given, owns rows on a connection it never held.
    expect(await ownedCount(fx.clientB, "people")).toBe(1);
  });

  it("wipes the caller's own data and leaves the other user's intact", async () => {
    // Runs last: it is the one test that actually destroys A's rows.
    //
    // fx.clientA was signed out by the previous test, so the route gets a fresh A
    // session -- and the post-state is read through a third one, minted after this
    // route call signed the second out.
    const callerA = await mintExtraSession(fx, "A");

    // Both users are fully seeded going in, so "B's rows survived" is a real
    // observation rather than a vacuous one over empty tables.
    expect(await ownedCount(callerA, "people")).toBe(1);
    expect(await ownedCount(fx.clientB, "people")).toBe(1);
    expect(await ownedCount(fx.clientB, "rankings")).toBe(1);
    expect(await ownedCount(fx.clientB, "profiles")).toBe(1);

    setRouteClient(callerA);
    const response = await deleteData(createContext({ user: { id: fx.userAId } }) as never);

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ success: true });

    // A's own data is gone -- enough to show the route actually ran. Whether every
    // last trace of A survives elsewhere is risk #2's question, not this one's.
    const observerA = await mintExtraSession(fx, "A");
    expect(await ownedCount(observerA, "people")).toBe(0);

    // The property this test exists for: A's wipe did not reach across owners.
    expect(await ownedCount(fx.clientB, "people")).toBe(1);
    expect(await ownedCount(fx.clientB, "rankings")).toBe(1);
    expect(await ownedCount(fx.clientB, "profiles")).toBe(1);
  });
});

/** How many rows of `table` this client can see -- under RLS, exactly its own. */
async function ownedCount(client: TestClient, table: TableName): Promise<number> {
  const { data } = await client.from(table).select("owner_id");
  return data?.length ?? 0;
}
