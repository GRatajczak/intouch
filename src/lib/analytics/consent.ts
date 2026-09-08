import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

/**
 * Turn a `profiles.analytics_opt_out` value into "may we send events?".
 *
 * A missing row (`null`/`undefined`) counts as CONSENTED. Two reasons: the
 * column defaults to false, and at `signup_started` no profile row exists yet
 * -- so treating absence as a refusal would silently drop the funnel's first
 * step for every user.
 *
 * Exported separately from `hasAnalyticsConsent` so callers that already hold
 * the profile row -- src/lib/ranking/run.ts loads it before ranking -- can pass
 * the flag straight through instead of paying a second round trip.
 */
export function consentFromOptOut(optOut: boolean | null | undefined): boolean {
  return optOut !== true;
}

/**
 * Read the caller's own consent flag from `profiles`.
 *
 * Takes an RLS-scoped client, so the row is the caller's by construction --
 * `ownerId` narrows, it does not authorize.
 *
 * Fails OPEN TO SILENCE: a query error suppresses the event and logs, never
 * throws into the caller's request path. Analytics must not be able to turn a
 * successful profile save into a 500.
 */
export async function hasAnalyticsConsent(supabase: SupabaseClient<Database>, ownerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("analytics_opt_out")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    console.error(`[analytics] consent read failed for owner ${ownerId}: ${error.message}`);
    return false;
  }

  return consentFromOptOut(data?.analytics_opt_out);
}
