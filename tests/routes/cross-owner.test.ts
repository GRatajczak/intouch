// Risk #1 at the route layer: an authenticated user reaching another user's row
// through an id-addressed route, and the responses leaking whether that row exists.
//
// HOW THESE TESTS ISOLATE THE ROUTE'S OWN FILTER
//
// The boundary here is two independent layers: RLS in Postgres, and each route's
// redundant `.eq("owner_id", ownerId)`. tests/rls already proves the first. If
// these tests also ran with the attacker's own session, deleting a route's owner
// filter would leave them green -- Postgres would silently catch what the route
// stopped catching, and the suite would be proving one layer twice while claiming
// to prove two.
//
// So the instrument is a deliberate mismatch: the database connection carries user
// A's real session, while `locals.user` says the caller is user B. The route's own
// filter is then the only thing standing between the handler and A's row. Read the
// assertions as: "when this handler believes the caller is B, it must not touch a
// row owned by A -- even on a connection that would allow it." Remove the filter
// and these go red; that is the whole point.
//
// (The obvious alternative, a service-role client, does not work here and should
// not be made to: this schema grants table privileges to `anon` and `authenticated`
// only, so `service_role` gets "permission denied for table people" from PostgREST.
// That is a good property of the schema, not an obstacle to route back around.)
//
// The one exception is POST /api/contact-events, whose two FK lookups carry no
// owner filter at all -- there RLS *is* the protection, by design and documented at
// contact-events.ts:39-42 and :48-50. Those cases run under the attacker's own real
// session, because asserting them any other way would assert a bug.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRlsFixture, destroyRlsFixture, type RlsFixture } from "../rls/fixture";
import { createContext, jsonBody } from "./context";
import { clearRouteClient, setRouteClient } from "./route-client";

vi.mock("@/lib/supabase", async () => {
  const state = await import("./route-client");
  return { createClient: () => state.getRouteClient() };
});

const { PATCH: peoplePatch, DELETE: peopleDelete } = await import("@/pages/api/people/[id]");
const { PATCH: eventPatch, DELETE: eventDelete } = await import("@/pages/api/contact-events/[id]");
const { POST: eventsPost, GET: eventsGet } = await import("@/pages/api/contact-events");

/** Well-formed but belonging to nobody -- the "absent" half of the existence-leak test. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

let fx: RlsFixture;

beforeAll(async () => {
  fx = await createRlsFixture();
}, 60_000);

afterAll(async () => {
  clearRouteClient();
  await destroyRlsFixture();
});

type Handler = (context: never) => Promise<Response> | Response;

/**
 * Invokes a real handler. `client` is what src/lib/supabase.ts would have built
 * from the request's cookies; `init.user` is what middleware would have put on
 * locals. Handing them in separately is what makes the mismatch above possible.
 */
async function run(client: unknown, handler: Handler, init: Parameters<typeof createContext>[0]): Promise<Response> {
  setRouteClient(client);
  return await handler(createContext(init) as never);
}

/** The attacker's view: A's connection, but the handler is told the caller is B. */
const asAttacker = (handler: Handler, init: Parameters<typeof createContext>[0]) =>
  run(fx.clientA, handler, { ...init, user: { id: fx.userBId } });

/** The control: A's connection and the handler correctly told the caller is A. */
const asOwner = (handler: Handler, init: Parameters<typeof createContext>[0]) =>
  run(fx.clientA, handler, { ...init, user: { id: fx.userAId } });

const personIdA = () => fx.seededA.people.id as string;
const personIdB = () => fx.seededB.people.id as string;
const eventIdA = () => fx.seededA.contact_events.id as string;

describe("PATCH /api/people/[id]", () => {
  it("lets the owner edit their own person (control: the route works when ownership matches)", async () => {
    const response = await asOwner(peoplePatch, {
      method: "PATCH",
      params: { id: personIdA() },
      json: { name: "Renamed by the owner" },
    });

    expect(response.status).toBe(200);
  });

  it("returns 404 to a second user and leaves the row untouched", async () => {
    const before = await readPersonName(personIdA());

    const response = await asAttacker(peoplePatch, {
      method: "PATCH",
      params: { id: personIdA() },
      json: { name: "Renamed by an attacker" },
    });

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: "Nie znaleziono osoby" });

    // The status code is only half of it -- an independent read, as the owner,
    // proves the write did not land.
    expect(await readPersonName(personIdA())).toBe(before);
  });

  it("answers identically for someone else's id and an id that does not exist", async () => {
    const notYours = await asAttacker(peoplePatch, {
      method: "PATCH",
      params: { id: personIdA() },
      json: { name: "x" },
    });
    const absent = await asAttacker(peoplePatch, {
      method: "PATCH",
      params: { id: ABSENT_ID },
      json: { name: "x" },
    });

    // Equality is the property: any difference tells an attacker which ids exist,
    // which leaks existence even though neither response returns data.
    expect(notYours.status).toBe(absent.status);
    expect(await jsonBody(notYours)).toEqual(await jsonBody(absent));
  });
});

describe("DELETE /api/people/[id]", () => {
  it("returns 404 to a second user before it ever reaches the deactivate-first rule", async () => {
    const response = await asAttacker(peopleDelete, { method: "DELETE", params: { id: personIdA() } });

    // A's person is still `active`, so its owner would get 409 here. B gets 404,
    // which shows the owner filter runs before the business rule -- otherwise the
    // 409 itself would confirm the row exists.
    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: "Nie znaleziono osoby" });
    expect(await readPersonName(personIdA())).not.toBeNull();
  });

  it("gives the owner 409 for the same call, proving the 404 above is about ownership", async () => {
    const response = await asOwner(peopleDelete, { method: "DELETE", params: { id: personIdA() } });

    expect(response.status).toBe(409);
  });

  it("answers identically for someone else's id and an id that does not exist", async () => {
    const notYours = await asAttacker(peopleDelete, { method: "DELETE", params: { id: personIdA() } });
    const absent = await asAttacker(peopleDelete, { method: "DELETE", params: { id: ABSENT_ID } });

    expect(notYours.status).toBe(absent.status);
    expect(await jsonBody(notYours)).toEqual(await jsonBody(absent));
  });
});

describe("PATCH and DELETE /api/contact-events/[id]", () => {
  it("returns 404 to a second user and leaves the event's note untouched", async () => {
    const before = await readEventNote(eventIdA());

    const response = await asAttacker(eventPatch, {
      method: "PATCH",
      params: { id: eventIdA() },
      json: { note: "tampered by an attacker" },
    });

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: "Nie znaleziono zdarzenia" });
    expect(await readEventNote(eventIdA())).toBe(before);
  });

  it("refuses a second user's DELETE and leaves the event present", async () => {
    const response = await asAttacker(eventDelete, { method: "DELETE", params: { id: eventIdA() } });

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: "Nie znaleziono zdarzenia" });
    expect(await readEventNote(eventIdA())).not.toBeNull();
  });

  it("answers identically for someone else's id and an id that does not exist", async () => {
    const notYours = await asAttacker(eventDelete, { method: "DELETE", params: { id: eventIdA() } });
    const absent = await asAttacker(eventDelete, { method: "DELETE", params: { id: ABSENT_ID } });

    expect(notYours.status).toBe(absent.status);
    expect(await jsonBody(notYours)).toEqual(await jsonBody(absent));
  });
});

describe("GET /api/contact-events", () => {
  it("returns an empty list, not an error, for another owner's personId", async () => {
    const response = await asAttacker(eventsGet, {
      method: "GET",
      searchParams: { personId: personIdA() },
    });

    // An error would be a leak of a different kind: it would distinguish "this
    // person is not yours" from "you have no events with this person".
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ events: [] });
  });

  it("returns the owner's own events for the same route (control)", async () => {
    const response = await asOwner(eventsGet, { method: "GET", searchParams: { personId: personIdA() } });

    const body = await jsonBody(response);
    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
  });
});

// These run under the attacker's OWN real session, not the mismatched one: this is
// the single route on the surface whose FK lookups carry no owner filter, so RLS is
// the protection by design. Driving them any other way would assert the known gap
// instead of the intended behaviour.
describe("POST /api/contact-events (protected by RLS, not by a route filter)", () => {
  it("returns 404 when personId belongs to another owner", async () => {
    const response = await run(fx.clientB, eventsPost, {
      user: { id: fx.userBId },
      method: "POST",
      json: { personId: personIdA(), outcome: "happened" },
    });

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: "Nie znaleziono osoby" });
  });

  it("returns 404 when rankingEntryId belongs to another owner", async () => {
    const response = await run(fx.clientB, eventsPost, {
      user: { id: fx.userBId },
      method: "POST",
      json: {
        // B's own person, so the first FK check passes and the second one is
        // genuinely the thing being exercised.
        personId: personIdB(),
        outcome: "happened",
        rankingEntryId: fx.seededA.ranking_entries.id as string,
      },
    });

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: "Nie znaleziono wpisu rankingu" });
  });

  it("accepts the same shape when both ids are the caller's own (control)", async () => {
    const response = await run(fx.clientB, eventsPost, {
      user: { id: fx.userBId },
      method: "POST",
      json: {
        personId: personIdB(),
        outcome: "happened",
        rankingEntryId: fx.seededB.ranking_entries.id as string,
      },
    });

    expect(response.status).toBe(201);
  });
});

/** Independent read as the owner -- the only user who can see the row at all. */
async function readPersonName(id: string): Promise<string | null> {
  const { data } = await fx.clientA.from("people").select("name").eq("id", id).maybeSingle();
  return data?.name ?? null;
}

async function readEventNote(id: string): Promise<string | null> {
  const { data } = await fx.clientA.from("contact_events").select("note").eq("id", id).maybeSingle();
  return data?.note ?? null;
}
