// Risk #2, and the binary NFR this whole slice exists to satisfy: "deleting a
// person's data is fully and irreversibly honored."
//
// WHY THIS FILE ASSERTS FOUR TABLES AND NOT ONE
//
// The test plan names the anti-pattern directly: "asserting only on the people
// table and calling erasure proven." A person's data is spread across four tables
// today, and the correct post-delete state is NOT the same in all four -- three
// cascade to nothing, and the fourth deliberately does not:
//
//   contact_events   ON DELETE CASCADE   -> gone
//   ranking_entries  ON DELETE CASCADE   -> gone
//   reminder_sends   ON DELETE SET NULL  -> SURVIVES, carrying no name
//
// That last one is a decision, not an oversight, taken by S-04 with S-05 named in
// its rationale (20260908090338_create_reminder_sends.sql:44-47): deleting one
// person must not erase the evidence that the once-a-day rule was honoured for
// that owner, and what survives is an owner, a timestamp and a status -- no person.
// So the assertion below is the opposite of the other three's on purpose. A future
// migration that "fixes" it to CASCADE, or one that adds a fifth person-referencing
// table with no decision at all, is exactly what this file is here to catch.
//
// HOW THE DEACTIVATION HALF IS PROVED
//
// Re-running `.eq("status", "active")` inside the test would be a copy of the
// implementation: delete that filter from run.ts and such a test stays green. So
// the exclusion assertion calls the app's own `loadRankingPeople` -- the query
// runRanking actually feeds to the prompt. runRanking itself cannot be the oracle
// here because it needs a live OpenAI client.
//
// NOT ASSERTED HERE: that a second user gets 404 from these routes. That is risk
// #1 and belongs to cross-owner.test.ts, which already covers both handlers --
// including the ordering property that the owner filter runs BEFORE the
// deactivate-first rule, so a 409 can never confirm a foreign row exists.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRlsFixture, destroyRlsFixture, type RlsFixture, type TestClient } from "../rls/fixture";
import { createContext, jsonBody } from "./context";
import { clearRouteClient, setRouteClient } from "./route-client";

vi.mock("@/lib/supabase", async () => {
  const state = await import("./route-client");
  return { createClient: () => state.getRouteClient() };
});

const { PATCH: peoplePatch, DELETE: peopleDelete } = await import("@/pages/api/people/[id]");
const { loadRankingPeople } = await import("@/lib/ranking/run");

let fx: RlsFixture;

beforeAll(async () => {
  fx = await createRlsFixture();
}, 60_000);

afterAll(async () => {
  clearRouteClient();
  await destroyRlsFixture();
});

/** Every call here is the owner acting on their own person -- ownership is risk #1's file. */
function asOwner(handler: (context: never) => Promise<Response> | Response, init: Parameters<typeof createContext>[0]) {
  setRouteClient(fx.clientA);
  return handler(createContext({ ...init, user: { id: fx.userAId } }) as never);
}

const personIdA = () => fx.seededA.people.id as string;

describe("the deactivate-before-delete sequence", () => {
  // Ordered on purpose: each step is a precondition of the next, and step 4 is the
  // one that destroys the row every earlier step observes.

  it("1. refuses to delete a person who is still active, and leaves them intact", async () => {
    const response = await asOwner(peopleDelete, { method: "DELETE", params: { id: personIdA() } });

    expect(response.status).toBe(409);
    expect(await jsonBody(response)).toEqual({ error: "Najpierw dezaktywuj tę osobę." });

    // 409 is only half of it: the row, and everything hanging off it, must still be
    // there. A route that answered 409 *after* deleting would pass on status alone.
    expect(await peopleCount(personIdA())).toBe(1);
    expect(await rowCount("contact_events", personIdA())).toBe(1);
    expect(await rowCount("ranking_entries", personIdA())).toBe(1);
  });

  it("2. deactivates them, and keeps their contact history", async () => {
    const response = await asOwner(peoplePatch, {
      method: "PATCH",
      params: { id: personIdA() },
      json: { status: "deactivated" },
    });

    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect((body.person as Record<string, unknown>).status).toBe("deactivated");

    // The half of FR-005 that is easy to forget: deactivation is not a soft delete.
    // "AI stops considering them while their data, including contact history, is
    // retained" is two claims, and this is the retention one.
    expect(await rowCount("contact_events", personIdA())).toBe(1);
  });

  it("3. drops them from the ranking's input while every active person stays", async () => {
    // The app's own query, not a re-statement of its filter (see the header note).
    const input = await loadRankingPeople(fx.clientA, fx.userAId);

    expect(input).not.toBeNull();
    expect(input?.map((person) => person.id)).not.toContain(personIdA());

    // Control: the filter excludes the deactivated person, not simply everyone.
    // Without this, a `.eq("status", "nonsense")` typo would pass the line above.
    const stillActive = await insertActivePerson(fx.clientA, fx.userAId);
    const inputAfter = await loadRankingPeople(fx.clientA, fx.userAId);
    expect(inputAfter?.map((person) => person.id)).toContain(stillActive);
    expect(inputAfter?.map((person) => person.id)).not.toContain(personIdA());
  });

  it("4. deletes them once deactivated, leaving no row in any table that named them", async () => {
    // Seeded going in, so every "gone" below is a real observation rather than a
    // vacuous one over tables that were empty all along.
    expect(await peopleCount(personIdA())).toBe(1);
    expect(await rowCount("contact_events", personIdA())).toBe(1);
    expect(await rowCount("ranking_entries", personIdA())).toBe(1);
    expect(await rowCount("reminder_sends", personIdA())).toBe(1);

    const response = await asOwner(peopleDelete, { method: "DELETE", params: { id: personIdA() } });

    expect(response.status).toBe(200);

    // The three that cascade. Read through the owner's own session -- the only one
    // that could see these rows at all, so an empty result is erasure and not RLS.
    expect(await peopleCount(personIdA())).toBe(0);
    expect(await rowCount("contact_events", personIdA())).toBe(0);
    expect(await rowCount("ranking_entries", personIdA())).toBe(0);

    // The one that does not (see the header note). The row survives; the name does
    // not. Both halves are asserted: a row that vanished would break the once-a-day
    // cooldown, and a row still carrying person_id would be residual data about a
    // person the user asked to erase.
    expect(await rowCount("reminder_sends", personIdA())).toBe(0);
    const { data: sends } = await fx.clientA.from("reminder_sends").select("id, person_id, owner_id, status");
    expect(sends).toHaveLength(1);
    expect(sends?.[0].person_id).toBeNull();
    expect(sends?.[0].owner_id).toBe(fx.userAId);
    expect(sends?.[0].status).toBe("sent");

    // Nothing about this delete reached the other owner: user B's identical row set
    // is untouched, which is what makes "gone" above mean erasure rather than a wipe.
    expect(await peopleCount(fx.seededB.people.id as string, fx.clientB)).toBe(1);
    expect(await rowCount("contact_events", fx.seededB.people.id as string, fx.clientB)).toBe(1);
    expect(await rowCount("ranking_entries", fx.seededB.people.id as string, fx.clientB)).toBe(1);
    expect(await rowCount("reminder_sends", fx.seededB.people.id as string, fx.clientB)).toBe(1);
  });

  it("5. answers 404 for the person it just deleted, exactly as for one that never existed", async () => {
    // Irreversibility from the caller's side: the id is not merely inert, it is
    // indistinguishable from an id this account never had.
    const deleted = await asOwner(peopleDelete, { method: "DELETE", params: { id: personIdA() } });
    const absent = await asOwner(peopleDelete, {
      method: "DELETE",
      params: { id: "00000000-0000-4000-8000-000000000000" },
    });

    expect(deleted.status).toBe(404);
    expect(deleted.status).toBe(absent.status);
    expect(await jsonBody(deleted)).toEqual(await jsonBody(absent));
  });
});

/** The three tables that carry a `person_id` FK. `people` is keyed by `id`, so it stands apart. */
type ReferencingTable = "contact_events" | "ranking_entries" | "reminder_sends";

/**
 * How many rows of `table` still reference this person, as seen by the owner.
 *
 * Split from the `people` count below rather than unified behind a computed column
 * name: supabase-js narrows `.eq()` to the columns common to every table in a union,
 * and `person_id` is common to these three but not to `people`.
 */
async function rowCount(table: ReferencingTable, personId: string, client: TestClient = fx.clientA): Promise<number> {
  const { data, error } = await client.from(table).select("id").eq("person_id", personId);
  if (error) throw new Error(`counting ${table} failed: ${error.message}`);
  return data.length;
}

/** Whether the person row itself is still there, as seen by the owner. */
async function peopleCount(personId: string, client: TestClient = fx.clientA): Promise<number> {
  const { data, error } = await client.from("people").select("id").eq("id", personId);
  if (error) throw new Error(`counting people failed: ${error.message}`);
  return data.length;
}

/** A second, still-active person, so the exclusion assertion has a control. */
async function insertActivePerson(client: TestClient, ownerId: string): Promise<string> {
  const { data, error } = await client
    .from("people")
    .insert({ owner_id: ownerId, name: "Still active", relationship_type: "friend", description: "control", weight: 5 })
    .select("id")
    .single();
  if (error) throw new Error(`seeding the control person failed: ${error.message}`);
  return data.id;
}
