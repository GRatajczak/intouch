// POST /api/settings/delete-account removes the caller's whole account: every
// owner row AND the auth.users row. Four things must hold: an anonymous caller
// cannot trigger it, the SQL function behind it cannot be called by `anon`, the
// deletion stops at the connection's own identity, and the account really goes.
//
// THE CROSS-OWNER INSTRUMENT CHANGED WITH THE MECHANISM. The old route deleted
// by an `.eq("owner_id", user.id)` filter, so the test had to hand it A's
// connection while `locals.user` said B. The new route has no filter at all: it
// calls `delete_my_account()`, which deletes `auth.uid()` -- the CONNECTION's
// identity, read from the JWT. There is no argument to forge, so the property
// worth proving is the mirror image: a handler told the caller is A, running on
// B's connection, deletes B and cannot touch A. Verified by that mismatch, not
// by trusting `locals.user`.
//
// The route also signs out the client it was handed, and after deletion the
// user no longer exists, so every post-state read of a DELETED user goes through
// the service-role client (read-only here, used only for observation).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRlsFixture,
  createServiceClient,
  destroyRlsFixture,
  type RlsFixture,
  type TestClient,
} from "../rls/fixture";
import { createContext, jsonBody } from "./context";
import { clearRouteClient, setRouteClient } from "./route-client";

vi.mock("@/lib/supabase", async () => {
  const state = await import("./route-client");
  return { createClient: () => state.getRouteClient() };
});

const { POST: deleteAccount } = await import("@/pages/api/settings/delete-account");

let fx: RlsFixture;
let admin: TestClient;

beforeAll(async () => {
  fx = await createRlsFixture();
  admin = createServiceClient();
}, 60_000);

afterAll(async () => {
  clearRouteClient();
  await destroyRlsFixture();
});

describe("POST /api/settings/delete-account", () => {
  it("refuses an anonymous caller and never builds a client", async () => {
    // The guard runs first, so the handler returns 401; had it fallen through,
    // createClient would have yielded null and the route would have answered 500.
    clearRouteClient();

    const response = await deleteAccount(createContext({ user: null }) as never);

    expect(response.status).toBe(401);
    expect(await jsonBody(response)).toEqual({ error: "Musisz być zalogowany" });
    expect(await accountExists(fx.userAId)).toBe(true);
    expect(await accountExists(fx.userBId)).toBe(true);
  });

  it("does not let the anon role call delete_my_account directly", async () => {
    const { error } = await fx.anonClient.rpc("delete_my_account");

    expect(error).not.toBeNull();
    expect(await accountExists(fx.userAId)).toBe(true);
    expect(await accountExists(fx.userBId)).toBe(true);
  });

  it("deletes the connection's own account, not whoever the handler was told the caller is", async () => {
    // B's connection, but the handler believes the caller is A. With no owner
    // filter in the route, the only thing deciding who dies is auth.uid().
    setRouteClient(fx.clientB);
    const response = await deleteAccount(createContext({ user: { id: fx.userAId } }) as never);

    expect(response.status).toBe(200);

    expect(await accountExists(fx.userBId)).toBe(false);
    expect(await ownedRows(fx.userBId)).toBe(0);

    // A, whose id the handler was given, is untouched -- account and every row.
    expect(await accountExists(fx.userAId)).toBe(true);
    expect(await ownedRows(fx.userAId)).toBeGreaterThan(0);
  });

  it("deletes the caller's account entirely and signs them out", async () => {
    expect(await accountExists(fx.userAId)).toBe(true);

    setRouteClient(fx.clientA);
    const response = await deleteAccount(createContext({ user: { id: fx.userAId } }) as never);

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ success: true });

    // The auth row is gone -- the point of replacing delete-data -- and so is
    // every row that hung off it.
    expect(await accountExists(fx.userAId)).toBe(false);
    expect(await ownedRows(fx.userAId)).toBe(0);

    // The old credentials no longer work.
    const { error } = await fx.anonClient.auth.signInWithPassword(fx.credentialsA);
    expect(error).not.toBeNull();
  });
});

async function accountExists(userId: string): Promise<boolean> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data.user !== null;
}

/** Rows owned by `ownerId` across the owner-scoped tables, read past RLS. */
async function ownedRows(ownerId: string): Promise<number> {
  let total = 0;
  for (const table of ["people", "profiles", "rankings", "contact_events", "reminder_sends"] as const) {
    const { data } = await admin.from(table).select("owner_id").eq("owner_id", ownerId);
    total += data?.length ?? 0;
  }
  return total;
}
