// POST /api/settings/reminders — the reminder kill switch.
//
// Small route, but it is the only thing standing between a user and email they
// asked to stop receiving, and the sweep reads the flag it writes through a
// SECURITY DEFINER function that bypasses RLS. So the two failures worth
// pinning are: an anonymous caller must not be able to flip anybody's flag,
// and a signed-in caller's flip must stop at their own row.
//
// The cross-owner instrument is delete-data.test.ts's, for the same reason it
// exists there: run the handler under the caller's own session and RLS absorbs
// a missing owner filter, so the test would pass against a route that had none.
// Handing the handler a connection carrying A's session while `locals.user`
// says B makes the route's own `.eq("owner_id", …)` the only guard left.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRlsFixture, destroyRlsFixture, mintExtraSession, type RlsFixture } from "../rls/fixture";
import { createContext } from "./context";
import { clearRouteClient, setRouteClient } from "./route-client";

vi.mock("@/lib/supabase", async () => {
  const state = await import("./route-client");
  return { createClient: () => state.getRouteClient() };
});

const { POST: toggleReminders } = await import("@/pages/api/settings/reminders");

let fx: RlsFixture;

beforeAll(async () => {
  fx = await createRlsFixture();
}, 60_000);

afterAll(async () => {
  clearRouteClient();
  await destroyRlsFixture();
});

async function remindersEnabledFor(which: "A" | "B"): Promise<boolean | undefined> {
  const client = await mintExtraSession(fx, which);
  const ownerId = which === "A" ? fx.userAId : fx.userBId;
  const { data } = await client.from("profiles").select("reminders_enabled").eq("owner_id", ownerId).maybeSingle();
  return data?.reminders_enabled;
}

describe("POST /api/settings/reminders", () => {
  it("refuses an anonymous caller", async () => {
    clearRouteClient();

    const response = await toggleReminders(createContext({ method: "POST", json: { enabled: false } }));

    expect(response.status).toBe(401);
  });

  it("rejects a body that is not a boolean toggle", async () => {
    setRouteClient(fx.clientA);

    const response = await toggleReminders(
      createContext({ user: { id: fx.userAId }, method: "POST", json: { enabled: "nie" } }),
    );

    expect(response.status).toBe(400);
    // The flag must be untouched by a rejected request.
    expect(await remindersEnabledFor("A")).toBe(true);
  });

  it("turns the caller's own reminders off, and back on", async () => {
    setRouteClient(fx.clientA);
    const context = () => createContext({ user: { id: fx.userAId }, method: "POST", json: { enabled: false } });

    const off = await toggleReminders(context());
    expect(off.status).toBe(200);
    expect(await remindersEnabledFor("A")).toBe(false);

    const on = await toggleReminders(
      createContext({ user: { id: fx.userAId }, method: "POST", json: { enabled: true } }),
    );
    expect(on.status).toBe(200);
    expect(await remindersEnabledFor("A")).toBe(true);
  });

  it("writes only the row the handler was told to, never the connection's owner", async () => {
    // A's session, B's identity. A route that updated `profiles` without an
    // owner filter would silently switch A's reminders off here -- and A would
    // simply stop receiving email with nothing to point at.
    setRouteClient(fx.clientA);

    await toggleReminders(createContext({ user: { id: fx.userBId }, method: "POST", json: { enabled: false } }));

    expect(await remindersEnabledFor("A")).toBe(true);
    expect(await remindersEnabledFor("B")).toBe(true);
  });
});
