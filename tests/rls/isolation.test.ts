// Risk #1: cross-user read or mutation of people, rankings, contact events or
// reminder sends.
//
// Proven against real Postgres with two real users, because the thing under test
// is a Postgres policy -- a mock would happily lie about it. Every table gets the
// same nine properties, so they are written once and parameterised across the six
// rather than copied six times; each property catches a different regression.
//
// Two semantics make these assertions meaningful, and getting either backwards
// would produce a test that passes against broken code:
//
//   1. RLS *filters*, it does not reject. A cross-owner SELECT returns an empty
//      set and a cross-owner UPDATE/DELETE reports zero rows affected -- both with
//      `error === null`. Asserting "an error was thrown" would fail against
//      correct behaviour. Only a missing GRANT produces an error (42501).
//   2. Zero rows affected is not the same as the row surviving. Every mutation
//      attempt is therefore followed by an independent read *as the victim*,
//      which is the only party who can see the row at all.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRlsFixture,
  destroyRlsFixture,
  type RlsFixture,
  type Row,
  type SeededRows,
  type TableName,
  type TestClient,
} from "./fixture";

interface TableSpec {
  table: TableName;
  /** Column addressing a single row: `id` everywhere except profiles, keyed by its owner. */
  key: "id" | "owner_id";
  /** Column a cross-owner UPDATE tries to tamper with, re-read afterwards to prove it did not land. */
  probe: string;
  /** Builds a row stamped with someone else's owner_id, for the forged-INSERT assertion. */
  forge: (ownerId: string, seeded: SeededRows) => Row;
}

const TAMPERED = "tampered-by-the-other-user";

const SPECS: TableSpec[] = [
  {
    table: "people",
    key: "id",
    probe: "name",
    forge: (ownerId) => ({
      owner_id: ownerId,
      name: "Forged person",
      relationship_type: "friend",
      description: "Forged",
      weight: 5,
    }),
  },
  {
    table: "profiles",
    key: "owner_id",
    probe: "name",
    forge: (ownerId) => ({
      owner_id: ownerId,
      name: "Forged profile",
      birth_date: "1990-01-01",
      life_context: "Forged",
    }),
  },
  {
    table: "rankings",
    key: "id",
    probe: "model",
    forge: (ownerId) => ({
      owner_id: ownerId,
      model: "forged-model",
      people_considered: 1,
      people_total: 1,
    }),
  },
  {
    table: "ranking_entries",
    key: "id",
    probe: "reason",
    forge: (ownerId, seeded) => ({
      // The victim's own parent rows: an attacker who knew these ids still must
      // not be able to attach an entry to them.
      ranking_id: seeded.rankings.id,
      owner_id: ownerId,
      person_id: seeded.people.id,
      rank_position: 2,
      time_window: "this_week",
      reason: "Forged reason",
    }),
  },
  {
    table: "contact_events",
    key: "id",
    probe: "note",
    forge: (ownerId, seeded) => ({
      owner_id: ownerId,
      person_id: seeded.people.id,
      outcome: "happened",
      note: "Forged note",
    }),
  },
  {
    table: "reminder_sends",
    key: "id",
    probe: "provider_message_id",
    forge: (ownerId, seeded) => ({
      owner_id: ownerId,
      person_id: seeded.people.id,
      ranking_id: seeded.rankings.id,
      status: "sent",
      provider_message_id: "forged-message-id",
    }),
  },
];

let fx: RlsFixture;

beforeAll(async () => {
  fx = await createRlsFixture();
}, 60_000);

afterAll(async () => {
  await destroyRlsFixture();
});

describe.each(SPECS)("$table", (spec) => {
  /** The value addressing user A's seeded row in this table. */
  const keyOfA = (): string => fx.seededA[spec.table][spec.key] as string;
  /** What user A's row says in the probe column before anyone attacks it. */
  const probeOfA = (): unknown => fx.seededA[spec.table][spec.probe];

  it("lets the owner read their own row", async () => {
    const { data, error } = await selectRow(fx.clientA, spec, keyOfA());
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("hides the row from a second signed-in user", async () => {
    const { data, error } = await selectRow(fx.clientB, spec, keyOfA());
    // Filtered, not rejected -- an empty set with no error is the correct shape.
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("refuses a cross-owner UPDATE and leaves the row untouched", async () => {
    const { data, error } = await updateRow(fx.clientB, spec, keyOfA(), { [spec.probe]: TAMPERED });

    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    // Zero rows affected is only half the claim. Only the victim can see the row,
    // so only the victim can prove the write did not land.
    const victim = await selectRow(fx.clientA, spec, keyOfA());
    expect(victim.data).toHaveLength(1);
    expect(victim.data?.[0]?.[spec.probe]).toBe(probeOfA());
  });

  it("refuses a cross-owner DELETE and leaves the row present", async () => {
    const { data, error } = await deleteRow(fx.clientB, spec, keyOfA());

    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const victim = await selectRow(fx.clientA, spec, keyOfA());
    expect(victim.data).toHaveLength(1);
    expect(victim.data?.[0]?.[spec.probe]).toBe(probeOfA());
  });

  it("refuses an INSERT that forges the other user's owner_id", async () => {
    const { error } = await insertRow(fx.clientB, spec, spec.forge(fx.userAId, fx.seededA));

    // This is the WITH CHECK direction, and unlike SELECT/UPDATE/DELETE it really
    // does reject: there is no existing row to filter, so the policy raises 42501
    // ("new row violates row-level security policy"). Asserting the *code* rather
    // than merely "some error" matters on profiles, where owner_id is the primary
    // key -- without RLS that insert would still fail, but on a 23505 unique
    // violation, and the test would pass while the boundary was gone.
    expect(error?.code).toBe("42501");

    // And nothing appeared under the victim's ownership: A still sees exactly the
    // one row seeded for them, with no forged sibling alongside it.
    const owned = await ownedRowCount(fx.clientA, spec);
    expect(owned).toBe(1);
  });

  it("returns nothing to an anonymous reader", async () => {
    const { data, error } = await selectRow(fx.anonClient, spec, keyOfA());
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("refuses an anonymous INSERT", async () => {
    expectReachedNothing(await insertRow(fx.anonClient, spec, spec.forge(fx.userAId, fx.seededA)));
  });

  it("refuses an anonymous UPDATE and leaves the row untouched", async () => {
    expectReachedNothing(await updateRow(fx.anonClient, spec, keyOfA(), { [spec.probe]: TAMPERED }));

    const victim = await selectRow(fx.clientA, spec, keyOfA());
    expect(victim.data?.[0]?.[spec.probe]).toBe(probeOfA());
  });

  it("refuses an anonymous DELETE and leaves the row present", async () => {
    expectReachedNothing(await deleteRow(fx.anonClient, spec, keyOfA()));

    const victim = await selectRow(fx.clientA, spec, keyOfA());
    expect(victim.data).toHaveLength(1);
  });
});

// --- query helpers -----------------------------------------------------------
//
// supabase-js types every builder against one concrete table. This suite iterates
// over five on purpose, which narrows the accepted column names to those all five
// share -- and that excludes `id`, because profiles is keyed by owner_id alone.
// Each table is addressed by its own key deliberately, so the four casts below are
// the price of parameterising instead of copy-pasting the same nine assertions five
// times. They are confined to these helpers; no assertion carries a cast.

interface QueryResult {
  data: Row[] | null;
  error: { code: string } | null;
}

async function selectRow(client: TestClient, spec: TableSpec, key: string): Promise<QueryResult> {
  return toQueryResult(
    await client
      .from(spec.table)
      .select(`${spec.key}, ${spec.probe}`)
      .eq(spec.key as never, key),
  );
}

async function updateRow(client: TestClient, spec: TableSpec, key: string, patch: Row): Promise<QueryResult> {
  return toQueryResult(
    await client
      .from(spec.table)
      .update(patch as never)
      .eq(spec.key as never, key as never)
      .select(),
  );
}

async function deleteRow(client: TestClient, spec: TableSpec, key: string): Promise<QueryResult> {
  return toQueryResult(
    await client
      .from(spec.table)
      .delete()
      .eq(spec.key as never, key as never)
      .select(),
  );
}

async function insertRow(client: TestClient, spec: TableSpec, row: Row): Promise<QueryResult> {
  return toQueryResult(
    await client
      .from(spec.table)
      .insert(row as never)
      .select(),
  );
}

/** How many rows in this table the given client can see at all -- under correct RLS, only their own. */
async function ownedRowCount(client: TestClient, spec: TableSpec): Promise<number> {
  const { data } = toQueryResult(await client.from(spec.table).select(spec.key));
  return data?.length ?? 0;
}

function toQueryResult(response: { data: unknown; error: { code: string } | null }): QueryResult {
  return { data: response.data as Row[] | null, error: response.error };
}

/**
 * An anonymous write must not land, but the two ways it can be stopped look
 * different and both are correct. `anon` holds only a SELECT grant on these tables
 * (`grant select on public.<table> to anon`), so Postgres rejects the statement at
 * the privilege level with 42501 before RLS is ever consulted. Were that grant
 * widened, RLS would take over and report zero rows affected instead. Either
 * outcome proves the property; a write that succeeds disproves it.
 */
function expectReachedNothing(result: QueryResult): void {
  if (result.error) {
    expect(result.error.code).toBe("42501");
    return;
  }
  expect(result.data ?? []).toHaveLength(0);
}
