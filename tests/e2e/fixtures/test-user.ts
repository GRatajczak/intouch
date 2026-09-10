// The one throwaway user an E2E run drives the app as.
//
// Created once by the `setup` project, deleted once by the `cleanup` project,
// and described on disk in between -- Playwright runs projects in separate
// worker processes, so a module-level variable would not survive the trip from
// setup to spec.
//
// Why it is seeded at all: a brand-new account never reaches the screens under
// test. `dashboard.astro` renders HierarchyEmptyState when there is no profile
// row or zero active people, and `src/middleware.ts` bounces /people to /profile
// for a user without one. An unseeded user would make every assertion below
// pass against an empty state, for the wrong reason.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createAdminClient, createSignedInClient } from "./local-stack";

export const AUTH_STATE_PATH = "playwright/.auth/user.json";
export const TEST_USER_PATH = "playwright/.auth/test-user.json";

export interface TestUser {
  userId: string;
  email: string;
  password: string;
  /** Names of the seeded people, so a spec can assert on this user's real data. */
  peopleNames: [string, string];
}

/**
 * Creates a confirmed user and seeds the minimum the app needs to render the
 * signed-in screens: a profile row and two active people. Deliberately seeds
 * NO ranking -- `loadLatestRanking` then returns null, `isStale(null)` is true,
 * and HierarchyView mounts straight into the polling path that Risk #4 is about.
 */
export async function createTestUser(): Promise<TestUser> {
  const suffix = `${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}`;
  const credentials = {
    email: `e2e-${suffix}@example.com`,
    password: `e2e-fixture-password-${suffix}-1!`,
  };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
  if (error) throw new Error(`failed to create the E2E user: ${error.message}`);
  const userId = data.user.id;

  // Everything from here writes through the user's own session, never the
  // admin client -- see the header of local-stack.ts.
  const client = await createSignedInClient(credentials);

  const peopleNames: [string, string] = [`Anna Testowa ${suffix}`, `Marek Testowy ${suffix}`];

  const { error: profileError } = await client.from("profiles").insert({
    owner_id: userId,
    name: `Profil E2E ${suffix}`,
    birth_date: "1990-01-01",
    life_context: "Seeded by the E2E fixture.",
  });
  if (profileError) throw new Error(`failed to seed the E2E profile: ${profileError.message}`);

  const { error: peopleError } = await client.from("people").insert(
    peopleNames.map((name, index) => ({
      owner_id: userId,
      name,
      relationship_type: index === 0 ? "friend" : "family",
      description: "Seeded by the E2E fixture.",
      weight: index === 0 ? 8 : 5,
    })),
  );
  if (peopleError) throw new Error(`failed to seed the E2E people: ${peopleError.message}`);

  const user: TestUser = { userId, ...credentials, peopleNames };
  mkdirSync(dirname(TEST_USER_PATH), { recursive: true });
  writeFileSync(TEST_USER_PATH, JSON.stringify(user, null, 2));
  return user;
}

/** Reads the record written by `createTestUser`. Specs use this, never the creation path. */
export function readTestUser(): TestUser {
  try {
    return JSON.parse(readFileSync(TEST_USER_PATH, "utf-8")) as TestUser;
  } catch {
    throw new Error(
      `No E2E test user on disk at ${TEST_USER_PATH}. The \`setup\` project writes it; ` +
        "run the suite through `npm run test:e2e` rather than a bare `npx playwright test <file>`.",
    );
  }
}

/**
 * Deletes the throwaway user. Every seeded row hangs off `auth.users` through an
 * `ON DELETE CASCADE` owner_id FK, so this removes the data too -- no per-table
 * cleanup, and nothing for the next run to collide with.
 */
export async function destroyTestUser(): Promise<void> {
  const { userId } = readTestUser();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`teardown left the throwaway user ${userId} in the local auth.users: ${error.message}`);
  }
}
