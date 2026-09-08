// The only file in the APPLICATION that reads SUPABASE_SERVICE_ROLE_KEY.
//
// Every RLS policy in this schema is `to authenticated using (auth.uid() =
// owner_id)`. S-04's reminder sweep runs from a Cron Trigger with no signed-in
// user, so those policies return zero rows for it -- which is the whole reason
// this module exists. A service-role client bypasses RLS entirely, so the
// bypass is confined here rather than spread across the sweep.
//
// IMPORT RESTRICTION: only `src/lib/reminders/**` may import this module, and
// only to call the two SECURITY DEFINER functions the sweep needs
// (`reminder_candidates`, `record_reminder_send`) plus owner-filtered reads for
// one already-selected owner. Nothing reachable from a request handler may
// import it: a route already has the caller's session, and reaching for this
// client there would silently turn an owner-scoped read into a global one.
//
// That restriction is ENFORCED, not merely stated -- see the
// `no-restricted-imports` rule in eslint.config.js. Widen the allowlist there
// deliberately if a future feature needs admin access; do not delete the rule.
//
// One caveat, so this header stays true: `scripts/verify-reminders.ts` reads
// the same secret, but through `process.env` rather than by importing this
// module. It has no choice -- it runs under `tsx`, where the `astro:env/server`
// specifier below does not resolve at all (verified: ERR_UNSUPPORTED_ESM_URL_SCHEME).
// It is a local developer script, never bundled and never deployed, so the
// boundary that matters -- nothing an HTTP request can reach -- still holds.
//
// The narrowing that actually matters is in SQL, not here. `reminder_candidates`
// is the only cross-owner query in the system: a SECURITY DEFINER function with
// a fixed return shape, `revoke execute` from `anon` and `authenticated`. Once
// it has named an owner, every subsequent read goes through the existing
// helpers (`loadLatestRanking`, `loadContactFacts`), which carry an explicit
// `.eq("owner_id", ...)` -- the owner scope lives in the query, not only in the
// policy, which is what makes them safe to reuse under this client.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";

/**
 * Builds the service-role client, or `null` when either half of its config is
 * absent -- the same null-on-missing-config shape as `src/lib/supabase.ts`,
 * `src/lib/openai.ts` and `src/lib/resend.ts`, so a missing secret fails one
 * scheduled sweep rather than the whole Worker.
 *
 * Not the `@supabase/ssr` client: there is no request and no cookie jar here,
 * so session persistence and token refresh are both meaningless and are turned
 * off explicitly rather than left to default into a no-op storage adapter.
 */
export function createAdminClient(): SupabaseClient<Database> | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
