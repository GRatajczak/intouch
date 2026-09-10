// Where the throwaway E2E user is created, and the guardrail that keeps that
// safe.
//
// The rule is inherited verbatim from tests/rls/fixture.ts and is the reason
// this file exists separately from the specs: the service-role key creates and
// deletes the throwaway user and does nothing else. Every row this layer seeds
// is written through an anon-key client carrying that user's real session,
// because a row written by a key that bypasses RLS proves nothing about what
// the app can actually see.
//
// (`service_role` could not write these tables anyway -- every migration grants
// table privileges to `anon` and `authenticated` only. See test-plan.md §6.3.)
import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

export type StackClient = SupabaseClient<Database>;

interface LocalStatus {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

const NO_PERSIST = { auth: { autoRefreshToken: false, persistSession: false } };

/**
 * Reads the stack's coordinates.
 *
 * Mirrors `readLocalStatus()` in tests/rls/fixture.ts, including its refusal to
 * run against anything but a local URL, or an explicit `SUPABASE_STAGE_*`
 * opt-in -- this module creates and deletes real users, and pointed at the
 * wrong project it would do that to production.
 *
 * It is duplicated rather than imported for one reason only: the original is not
 * exported. Nothing about it is Vitest-specific, and this file imports the `@/`
 * alias fine under Playwright's transform, so the barrier is visibility, not
 * tooling. That makes the duplication a liability rather than a necessity: this
 * copy is a safety guard, so **harden the two together or not at all** -- a check
 * tightened in one file and missed in the other leaves the weaker path open.
 *
 * CI opt-in: all three `SUPABASE_STAGE_*` vars set -> use them directly, no
 * `supabase status` call at all. Nothing local or accidental sets all three at
 * once. Local stack (default, unchanged): shell out to `supabase status -o
 * json` and refuse anything whose API_URL is not 127.0.0.1/localhost.
 */
export function readLocalStatus(): LocalStatus {
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
      "The local Supabase stack is not running, so the E2E layer has no database to drive. " +
        "Run `supabase start`, start the app (`npm run dev`), and try again, or set SUPABASE_STAGE_URL / " +
        "SUPABASE_STAGE_ANON_KEY / SUPABASE_STAGE_SERVICE_ROLE_KEY (all three) to point this layer at a " +
        "hosted stage project instead.",
    );
  }

  const status = JSON.parse(raw) as LocalStatus;

  if (!status.API_URL.includes("127.0.0.1") && !status.API_URL.includes("localhost")) {
    throw new Error(`Refusing to run the E2E layer against a non-local Supabase URL: ${status.API_URL}`);
  }

  return status;
}

/** A service-role client. Creates and deletes throwaway users; nothing else. */
export function createAdminClient(): StackClient {
  const { API_URL, SERVICE_ROLE_KEY } = readLocalStatus();
  return createClient<Database>(API_URL, SERVICE_ROLE_KEY, NO_PERSIST);
}

/** An anon-key client carrying a real session for `credentials`. */
export async function createSignedInClient(credentials: { email: string; password: string }): Promise<StackClient> {
  const { API_URL, ANON_KEY } = readLocalStatus();
  const client = createClient<Database>(API_URL, ANON_KEY, NO_PERSIST);
  const { error } = await client.auth.signInWithPassword(credentials);
  if (error) throw new Error(`failed to sign in the E2E user: ${error.message}`);
  return client;
}
