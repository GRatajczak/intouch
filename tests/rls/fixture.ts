// The two-real-user harness every RLS assertion shares.
//
// Promoted from scripts/verify-rls.ts, which this file replaces. The rule that
// made that script meaningful is preserved exactly: the service-role key creates
// and deletes the throwaway users and does nothing else. Every assertion runs
// through an anon-key client carrying a real JWT, because proving a policy with
// the key that bypasses it proves nothing.
import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

export type TestClient = SupabaseClient<Database>;

/** The six owner-scoped tables. Every one of them is asserted on. */
export type TableName = "people" | "profiles" | "rankings" | "ranking_entries" | "contact_events" | "reminder_sends";

/** A row as this suite handles it: column-name keyed, shape enforced by the DB. */
export type Row = Record<string, unknown>;

/** One seeded row per table, for a single owner. */
export type SeededRows = Record<TableName, Row>;

export interface Credentials {
  email: string;
  password: string;
}

export interface RlsFixture {
  userAId: string;
  userBId: string;
  /** Sign-in details for the two throwaway users, so tests/http can mint real cookie jars. */
  credentialsA: Credentials;
  credentialsB: Credentials;
  /** Anon-key client carrying user A's real session. */
  clientA: TestClient;
  /** Anon-key client carrying user B's real session. */
  clientB: TestClient;
  /** Anon-key client with no session at all. */
  anonClient: TestClient;
  seededA: SeededRows;
  seededB: SeededRows;
  /** Where the local stack lives, so `mintExtraSession` can open another session. */
  apiUrl: string;
  anonKey: string;
}

interface LocalStatus {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

const NO_PERSIST = { auth: { autoRefreshToken: false, persistSession: false } };

// supabase/config.toml:189 caps sign_in_sign_ups at 30 per 5 minutes per IP, and
// this fixture spends two of them. Vitest isolates test files, so every file pays
// again -- and some pay more than two: each `mintExtraSession` call is one more,
// and a tests/http file spends four (this fixture's two, plus a real POST to
// /api/auth/signin per cookie jar). A full run of the current suite is around
// eighteen. That clears the cap once, but two full runs inside five minutes --
// an ordinary edit-and-rerun loop with TEST_BASE_URL set -- does not, and the
// failure reads like an auth bug rather than a rate limit. If the layer grows,
// promote this to a Vitest globalSetup that mints the sessions once and hands the
// tokens to each file.
export async function createRlsFixture(): Promise<RlsFixture> {
  const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = readLocalStatus();

  const admin = createClient<Database>(API_URL, SERVICE_ROLE_KEY, NO_PERSIST);

  const suffix = `${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}`;
  const credentialsA = { email: `rls-a-${suffix}@example.com`, password: "rls-fixture-password-A-1!" };
  const credentialsB = { email: `rls-b-${suffix}@example.com`, password: "rls-fixture-password-B-1!" };

  // Registered one at a time, and before the next call can throw: a failure between
  // the two creations used to leave user A in auth.users with nothing recording it,
  // and teardown then no-opped on a null admin. The leak was permanent and silent.
  adminForTeardown = admin;
  const userAId = await createConfirmedUser(admin, credentialsA, "A");
  createdUserIds.push(userAId);
  const userBId = await createConfirmedUser(admin, credentialsB, "B");
  createdUserIds.push(userBId);

  const clientA = await signedInClient(API_URL, ANON_KEY, credentialsA, "A");
  const clientB = await signedInClient(API_URL, ANON_KEY, credentialsB, "B");
  const anonClient = createClient<Database>(API_URL, ANON_KEY, NO_PERSIST);

  const seededA = await seedOwner(clientA, userAId, "A");
  const seededB = await seedOwner(clientB, userBId, "B");

  return {
    userAId,
    userBId,
    credentialsA,
    credentialsB,
    clientA,
    clientB,
    anonClient,
    seededA,
    seededB,
    apiUrl: API_URL,
    anonKey: ANON_KEY,
  };
}

let adminForTeardown: TestClient | null = null;
const createdUserIds: string[] = [];

/**
 * Deletes the throwaway users. Every seeded row hangs off `auth.users` through an
 * `ON DELETE CASCADE` owner_id FK, so removing the users removes the data too --
 * no per-table cleanup, and nothing left behind for the next run to trip over.
 */
export async function destroyRlsFixture(): Promise<void> {
  const admin = adminForTeardown;
  if (!admin) return;

  // One failure must not cost the rest. The loop used to splice the whole list up
  // front and abort on the first throw, so every id after it was lost with no way
  // to retry. Now a failed id goes back on the list and the failures are reported
  // loudly -- a leak the next run would trip over is worth failing the suite for.
  const failures: string[] = [];
  for (const id of createdUserIds.splice(0)) {
    try {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error(error.message);
    } catch (cause: unknown) {
      createdUserIds.push(id);
      failures.push(`${id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `teardown left ${failures.length.toString()} throwaway user(s) in the local auth.users: ${failures.join("; ")}`,
    );
  }

  adminForTeardown = null;
}

/**
 * A second, independent session for one of the fixture's two users.
 *
 * Needed by any test whose route calls `auth.signOut()`: the route clears the
 * session on whatever client it was handed, so that client can no longer read
 * anything back -- an assertion made through it would return zero rows because
 * the session is gone, not because the data is. Post-state has to be observed
 * through a session the route never touched. Costs one more sign-in against the
 * cap noted on `createRlsFixture`.
 */
export async function mintExtraSession(fx: RlsFixture, which: "A" | "B"): Promise<TestClient> {
  const credentials = which === "A" ? fx.credentialsA : fx.credentialsB;
  return await signedInClient(fx.apiUrl, fx.anonKey, credentials, `${which} (extra session)`);
}

/**
 * A service-role client against the local stack.
 *
 * Used only to prove the *positive* half of a grant -- that a function revoked
 * from anon and authenticated is still callable by the role the sweep actually
 * runs as. Asserting only the denials would pass just as happily against a
 * function nobody can call at all.
 */
export function createServiceClient(): TestClient {
  const { API_URL, SERVICE_ROLE_KEY } = readLocalStatus();
  return createClient<Database>(API_URL, SERVICE_ROLE_KEY, NO_PERSIST);
}

/**
 * Two paths, both closed by default.
 *
 * CI opt-in: all three `SUPABASE_STAGE_*` vars set -> use them directly. This
 * is the only way to point this suite at a hosted project, and it takes three
 * simultaneous, explicitly-named CI secrets to trigger -- nothing local or
 * accidental can set all three at once, and `.env.test` never carries them
 * (see its own header comment on why a hosted key must never land there).
 *
 * Local stack (default, unchanged): shell out to `supabase status -o json`
 * and refuse anything whose API_URL is not 127.0.0.1/localhost.
 */
function readLocalStatus(): LocalStatus {
  const stageUrl = process.env.SUPABASE_STAGE_URL;
  const stageAnonKey = process.env.SUPABASE_STAGE_ANON_KEY;
  const stageServiceRoleKey = process.env.SUPABASE_STAGE_SERVICE_ROLE_KEY;

  if (stageUrl && stageAnonKey && stageServiceRoleKey) {
    return { API_URL: stageUrl, ANON_KEY: stageAnonKey, SERVICE_ROLE_KEY: stageServiceRoleKey };
  }

  let raw: string;
  try {
    raw = execSync("supabase status -o json", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    throw new Error(
      "The local Supabase stack is not running, so tests/rls cannot prove anything about the real policies. " +
        "Run `supabase start` and try again, or set SUPABASE_STAGE_URL / SUPABASE_STAGE_ANON_KEY / " +
        "SUPABASE_STAGE_SERVICE_ROLE_KEY (all three) to point this suite at a hosted stage project instead. " +
        "(Only tests/rls needs the stack; tests/routes does not.)",
    );
  }

  const status = JSON.parse(raw) as LocalStatus;

  // Inherited verbatim from scripts/verify-rls.ts:29-33, and load-bearing: this
  // fixture creates and deletes real users. Pointed at a hosted project it would
  // do that to production.
  if (!status.API_URL.includes("127.0.0.1") && !status.API_URL.includes("localhost")) {
    throw new Error(`Refusing to run the RLS suite against a non-local Supabase URL: ${status.API_URL}`);
  }

  return status;
}

async function createConfirmedUser(admin: TestClient, credentials: Credentials, label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
  if (error) throw new Error(`failed to create user ${label}: ${error.message}`);
  return data.user.id;
}

async function signedInClient(
  apiUrl: string,
  anonKey: string,
  credentials: Credentials,
  label: string,
): Promise<TestClient> {
  const client = createClient<Database>(apiUrl, anonKey, NO_PERSIST);
  const { error } = await client.auth.signInWithPassword(credentials);
  if (error) throw new Error(`failed to sign in user ${label}: ${error.message}`);
  return client;
}

/**
 * Seeds one row in each of the five tables, owned by `ownerId` and written through
 * that owner's own client. Doubles as the "an owner can insert their own row"
 * assertion: if any policy's WITH CHECK were wrong in the *other* direction, the
 * whole suite would fail here rather than passing vacuously on empty tables.
 *
 * Order matters -- ranking_entries needs a parent ranking and a person, and
 * contact_events needs a person (FKs at 20260901120000_create_rankings_tables.sql:52-54
 * and 20260902184909_create_contact_events_table.sql:20-22).
 */
async function seedOwner(client: TestClient, ownerId: string, label: string): Promise<SeededRows> {
  const people = await insertOne(client, "people", {
    owner_id: ownerId,
    name: `Person ${label}`,
    relationship_type: "friend",
    description: `Seeded for ${label}`,
    weight: 5,
  });

  const profiles = await insertOne(client, "profiles", {
    owner_id: ownerId,
    name: `Profile ${label}`,
    birth_date: "1990-01-01",
    life_context: `Seeded for ${label}`,
  });

  const rankings = await insertOne(client, "rankings", {
    owner_id: ownerId,
    model: `model-${label}`,
    people_considered: 1,
    people_total: 1,
  });

  const ranking_entries = await insertOne(client, "ranking_entries", {
    ranking_id: rankings.id,
    owner_id: ownerId,
    person_id: people.id,
    rank_position: 1,
    time_window: "this_week",
    reason: `Reason ${label}`,
  });

  const contact_events = await insertOne(client, "contact_events", {
    owner_id: ownerId,
    person_id: people.id,
    outcome: "happened",
    note: `Note ${label}`,
  });

  // Last, because it references both people and rankings
  // (20260908090338_create_reminder_sends.sql:54-56). Seeded through the owner's
  // own client like every other row here: the sweep writes these through the
  // service role, but an owner reading their own send history goes through the
  // same policies as everything else, and that is what this suite asserts.
  const reminder_sends = await insertOne(client, "reminder_sends", {
    owner_id: ownerId,
    person_id: people.id,
    ranking_id: rankings.id,
    status: "sent",
    provider_message_id: `msg-${label}`,
  });

  return { people, profiles, rankings, ranking_entries, contact_events, reminder_sends };
}

async function insertOne(client: TestClient, table: TableName, row: Row): Promise<Row> {
  const { data, error } = await client
    .from(table)
    // supabase-js types .insert() against one concrete table; this suite iterates
    // over five on purpose. The payload shapes come from the migrations, and a
    // wrong column fails loudly right here rather than silently.
    .insert(row as never)
    .select()
    .single();
  if (error) throw new Error(`seeding ${table} failed: ${error.message}`);
  return data;
}
