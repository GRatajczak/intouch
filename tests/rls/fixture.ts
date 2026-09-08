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

/** The five owner-scoped tables. Every one of them is asserted on. */
export type TableName = "people" | "profiles" | "rankings" | "ranking_entries" | "contact_events";

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
}

interface LocalStatus {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

const NO_PERSIST = { auth: { autoRefreshToken: false, persistSession: false } };

// supabase/config.toml:189 caps sign_in_sign_ups at 30 per 5 minutes per IP, and
// this fixture spends two of them. Vitest isolates test files, so a second file in
// tests/rls/ spends two more -- the budget allows roughly fifteen RLS files per
// five minutes. If the layer ever grows past a handful, promote this to a Vitest
// globalSetup that mints the sessions once and hands the tokens to each file.
export async function createRlsFixture(): Promise<RlsFixture> {
  const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = readLocalStatus();

  const admin = createClient<Database>(API_URL, SERVICE_ROLE_KEY, NO_PERSIST);

  const suffix = `${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}`;
  const credentialsA = { email: `rls-a-${suffix}@example.com`, password: "rls-fixture-password-A-1!" };
  const credentialsB = { email: `rls-b-${suffix}@example.com`, password: "rls-fixture-password-B-1!" };

  const userAId = await createConfirmedUser(admin, credentialsA, "A");
  const userBId = await createConfirmedUser(admin, credentialsB, "B");

  createdUserIds.push(userAId, userBId);
  adminForTeardown = admin;

  const clientA = await signedInClient(API_URL, ANON_KEY, credentialsA, "A");
  const clientB = await signedInClient(API_URL, ANON_KEY, credentialsB, "B");
  const anonClient = createClient<Database>(API_URL, ANON_KEY, NO_PERSIST);

  const seededA = await seedOwner(clientA, userAId, "A");
  const seededB = await seedOwner(clientB, userBId, "B");

  return { userAId, userBId, credentialsA, credentialsB, clientA, clientB, anonClient, seededA, seededB };
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
  for (const id of createdUserIds.splice(0)) {
    await admin.auth.admin.deleteUser(id);
  }
  adminForTeardown = null;
}

function readLocalStatus(): LocalStatus {
  let raw: string;
  try {
    raw = execSync("supabase status -o json", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    throw new Error(
      "The local Supabase stack is not running, so tests/rls cannot prove anything about the real policies. " +
        "Run `supabase start` and try again. (Only tests/rls needs the stack; tests/routes does not.)",
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

  return { people, profiles, rankings, ranking_entries, contact_events };
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
