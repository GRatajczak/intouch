import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/db/database.types";

interface LocalStatus {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

function getLocalStatus(): LocalStatus {
  const raw = execSync("supabase status -o json", { encoding: "utf-8" });
  return JSON.parse(raw) as LocalStatus;
}

const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

async function main() {
  const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = getLocalStatus();

  if (!API_URL.includes("127.0.0.1") && !API_URL.includes("localhost")) {
    console.error(`Refusing to run against a non-local Supabase URL: ${API_URL}`);
    process.exit(1);
  }

  const noPersist = { auth: { autoRefreshToken: false, persistSession: false } };
  const admin = createClient<Database>(API_URL, SERVICE_ROLE_KEY, noPersist);

  const suffix = Date.now();
  const userA = { email: `verify-rls-a-${suffix}@example.com`, password: "verify-rls-password-A-1!" };
  const userB = { email: `verify-rls-b-${suffix}@example.com`, password: "verify-rls-password-B-1!" };

  let userAId: string | undefined;
  let userBId: string | undefined;

  try {
    console.log("Seeding two throwaway users...");
    const { data: createdA, error: createAErr } = await admin.auth.admin.createUser({ ...userA, email_confirm: true });
    if (createAErr) throw new Error(`failed to create user A: ${createAErr.message}`);
    userAId = createdA.user.id;

    const { data: createdB, error: createBErr } = await admin.auth.admin.createUser({ ...userB, email_confirm: true });
    if (createBErr) throw new Error(`failed to create user B: ${createBErr.message}`);
    userBId = createdB.user.id;

    const signInClient = createClient<Database>(API_URL, ANON_KEY, noPersist);

    const { data: sessionA, error: signInAErr } = await signInClient.auth.signInWithPassword(userA);
    if (signInAErr) throw new Error(`failed to sign in user A: ${signInAErr.message}`);

    const { data: sessionB, error: signInBErr } = await signInClient.auth.signInWithPassword(userB);
    if (signInBErr) throw new Error(`failed to sign in user B: ${signInBErr.message}`);

    const clientA = createClient<Database>(API_URL, ANON_KEY, noPersist);
    await clientA.auth.setSession({
      access_token: sessionA.session.access_token,
      refresh_token: sessionA.session.refresh_token,
    });

    const clientB = createClient<Database>(API_URL, ANON_KEY, noPersist);
    await clientB.auth.setSession({
      access_token: sessionB.session.access_token,
      refresh_token: sessionB.session.refresh_token,
    });

    const anonClient = createClient<Database>(API_URL, ANON_KEY, noPersist);

    console.log("Seeding one people row per user...");
    const personPayloadA = {
      owner_id: userAId,
      name: "Test Person A",
      relationship_type: "friend",
      description: "Seeded by verify-rls",
      weight: 5,
    };
    const personPayloadB = {
      owner_id: userBId,
      name: "Test Person B",
      relationship_type: "friend",
      description: "Seeded by verify-rls",
      weight: 5,
    };
    const { data: insertedA, error: insertAErr } = await clientA.from("people").insert(personPayloadA).select();
    const rowA = insertedA?.[0];
    assert(!insertAErr && !!rowA, "user A can insert own row");

    const { data: insertedB, error: insertBErr } = await clientB.from("people").insert(personPayloadB).select();
    const rowB = insertedB?.[0];
    assert(!insertBErr && !!rowB, "user B can insert own row");

    if (!rowA || !rowB) {
      throw new Error("setup failed: rows were not created, aborting isolation assertions");
    }

    console.log("Checking isolation...");

    const { data: ownSelectA, error: ownSelectAErr } = await clientA.from("people").select("id").eq("id", rowA.id);
    assert(!ownSelectAErr && ownSelectA.length === 1, "user A sees own row via select");

    const { data: crossSelectA, error: crossSelectAErr } = await clientA.from("people").select("id").eq("id", rowB.id);
    assert(!crossSelectAErr && crossSelectA.length === 0, "user A cannot select user B's row");

    const { data: crossUpdateA, error: crossUpdateAErr } = await clientA
      .from("people")
      .update({ created_at: new Date().toISOString() })
      .eq("id", rowB.id)
      .select();
    assert(!crossUpdateAErr && crossUpdateA.length === 0, "user A's update of user B's row affects zero rows");

    const { data: crossDeleteA, error: crossDeleteAErr } = await clientA
      .from("people")
      .delete()
      .eq("id", rowB.id)
      .select();
    assert(!crossDeleteAErr && crossDeleteA.length === 0, "user A's delete of user B's row affects zero rows");

    const { data: stillThereB, error: stillThereBErr } = await clientB.from("people").select("id").eq("id", rowB.id);
    assert(!stillThereBErr && stillThereB.length === 1, "user B's row survives user A's cross-delete attempt");

    const { data: anonSelect, error: anonSelectErr } = await anonClient.from("people").select("id");
    assert(!anonSelectErr && anonSelect.length === 0, "unauthenticated client sees no rows");

    console.log("Seeding one profile row per user...");
    const profilePayloadA = {
      owner_id: userAId,
      name: "Profile A",
      birth_date: "1995-01-01",
      life_context: "Seeded by verify-rls",
      weekly_time_budget: "hours_1_3",
      preferred_channels: ["phone", "in_person"],
      availability_windows: ["weekend"],
    };
    const profilePayloadB = {
      owner_id: userBId,
      name: "Profile B",
      birth_date: "1990-06-15",
      life_context: "Seeded by verify-rls",
      weekly_time_budget: "under_1h",
      preferred_channels: ["message", "video"],
      availability_windows: ["weekday_morning", "weekday_evening"],
    };
    const { data: insertedProfileA, error: insertProfileAErr } = await clientA
      .from("profiles")
      .insert(profilePayloadA)
      .select();
    const profileRowA = insertedProfileA?.[0];
    assert(!insertProfileAErr && !!profileRowA, "user A can insert own profile");

    const { data: insertedProfileB, error: insertProfileBErr } = await clientB
      .from("profiles")
      .insert(profilePayloadB)
      .select();
    const profileRowB = insertedProfileB?.[0];
    assert(!insertProfileBErr && !!profileRowB, "user B can insert own profile");

    console.log("Checking profiles isolation...");

    const { data: ownProfileSelectA, error: ownProfileSelectAErr } = await clientA
      .from("profiles")
      .select("owner_id")
      .eq("owner_id", userAId);
    assert(!ownProfileSelectAErr && ownProfileSelectA.length === 1, "user A sees own profile via select");

    const { data: crossProfileSelectA, error: crossProfileSelectAErr } = await clientA
      .from("profiles")
      .select("owner_id")
      .eq("owner_id", userBId);
    assert(!crossProfileSelectAErr && crossProfileSelectA.length === 0, "user A cannot select user B's profile");

    const { data: crossProfileUpdateA, error: crossProfileUpdateAErr } = await clientA
      .from("profiles")
      .update({ updated_at: new Date().toISOString() })
      .eq("owner_id", userBId)
      .select();
    assert(
      !crossProfileUpdateAErr && crossProfileUpdateA.length === 0,
      "user A's update of user B's profile affects zero rows",
    );

    // profiles has no delete policy AND no delete grant (plan: "no delete --
    // nothing in this slice deletes a profile"). With no DELETE privilege on
    // the table at all, PostgREST never reaches RLS -- it rejects the request
    // at the grant level with 42501 "permission denied for table profiles"
    // rather than a silent zero-row no-op. Both outcomes prove the same thing
    // (user A cannot touch user B's profile via delete), so either is accepted.
    const { data: crossProfileDeleteA, error: crossProfileDeleteAErr } = await clientA
      .from("profiles")
      .delete()
      .eq("owner_id", userBId)
      .select();
    assert(
      crossProfileDeleteAErr?.code === "42501" ||
        (!crossProfileDeleteAErr && crossProfileDeleteA?.length === 0),
      "user A's delete of user B's profile affects zero rows (or is rejected for lacking the delete grant)",
    );

    const { data: stillThereProfileB, error: stillThereProfileBErr } = await clientB
      .from("profiles")
      .select("owner_id")
      .eq("owner_id", userBId);
    assert(
      !stillThereProfileBErr && stillThereProfileB.length === 1,
      "user B's profile survives user A's cross-delete attempt",
    );

    const { data: anonProfileSelect, error: anonProfileSelectErr } = await anonClient
      .from("profiles")
      .select("owner_id");
    assert(!anonProfileSelectErr && anonProfileSelect.length === 0, "unauthenticated client sees no profile rows");
  } finally {
    console.log("Cleaning up throwaway users (cascade-deletes their people rows)...");
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} assertion(s) failed.`);
    process.exit(1);
  }

  console.log("\nAll RLS isolation assertions passed.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
