// POST /api/settings/analytics — the analytics opt-out switch.
//
// Structurally identical to tests/routes/reminders-toggle.test.ts (the route's
// own header comment says so), so this file mirrors that one exactly, adapted
// to analytics_opt_out's INVERTED wire contract: `enabled: true` writes
// `analytics_opt_out: false`.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRlsFixture, destroyRlsFixture, mintExtraSession, type RlsFixture } from "../rls/fixture";
import { createContext } from "./context";
import { clearRouteClient, setRouteClient } from "./route-client";

vi.mock("@/lib/supabase", async () => {
  const state = await import("./route-client");
  return { createClient: () => state.getRouteClient() };
});

const { POST: toggleAnalytics } = await import("@/pages/api/settings/analytics");

let fx: RlsFixture;

beforeAll(async () => {
  fx = await createRlsFixture();
}, 60_000);

afterAll(async () => {
  clearRouteClient();
  await destroyRlsFixture();
});

async function optOutFor(which: "A" | "B"): Promise<boolean | undefined> {
  const client = await mintExtraSession(fx, which);
  const ownerId = which === "A" ? fx.userAId : fx.userBId;
  const { data } = await client.from("profiles").select("analytics_opt_out").eq("owner_id", ownerId).maybeSingle();
  return data?.analytics_opt_out;
}

describe("POST /api/settings/analytics", () => {
  it("refuses an anonymous caller", async () => {
    clearRouteClient();

    const response = await toggleAnalytics(createContext({ method: "POST", json: { enabled: false } }));

    expect(response.status).toBe(401);
  });

  it("rejects a body that is not a boolean toggle", async () => {
    setRouteClient(fx.clientA);

    const response = await toggleAnalytics(
      createContext({ user: { id: fx.userAId }, method: "POST", json: { enabled: "nie" } }),
    );

    expect(response.status).toBe(400);
    // The flag must be untouched by a rejected request.
    expect(await optOutFor("A")).toBe(false);
  });

  it("turns the caller's own analytics off (enabled: false -> opt_out: true), and back on", async () => {
    setRouteClient(fx.clientA);

    const off = await toggleAnalytics(
      createContext({ user: { id: fx.userAId }, method: "POST", json: { enabled: false } }),
    );
    expect(off.status).toBe(200);
    expect(await optOutFor("A")).toBe(true);

    const on = await toggleAnalytics(
      createContext({ user: { id: fx.userAId }, method: "POST", json: { enabled: true } }),
    );
    expect(on.status).toBe(200);
    expect(await optOutFor("A")).toBe(false);
  });

  it("reports 404 rather than success when there is no profile row to update", async () => {
    // PostgREST answers an UPDATE that matched zero rows with `error: null`, so a
    // route checking only `error` would say 200 and write nothing -- telling
    // someone analytics is off when nothing changed.
    setRouteClient(fx.clientA);

    const response = await toggleAnalytics(
      createContext({
        user: { id: "00000000-0000-0000-0000-000000000000" },
        method: "POST",
        json: { enabled: false },
      }),
    );

    expect(response.status).toBe(404);
  });

  it("writes only the row the handler was told to, never the connection's owner", async () => {
    setRouteClient(fx.clientA);

    await toggleAnalytics(createContext({ user: { id: fx.userBId }, method: "POST", json: { enabled: false } }));

    expect(await optOutFor("A")).toBe(false);
    expect(await optOutFor("B")).toBe(false);
  });
});
