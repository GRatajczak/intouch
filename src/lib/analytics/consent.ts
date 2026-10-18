import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

/**
 * Turn a `profiles.analytics_consent` value into "may we send events?".
 *
 * Opt-IN: only an explicit `true` is consent. `null` (never asked), `false`
 * (refused), `undefined` (no profile row) and a failed read all mean "do not
 * send". ePrivacy / PKE art. 399 needs a prior affirmative choice, so absence
 * of a choice is never read as a yes.
 *
 * Exported separately from `hasAnalyticsConsent` so callers that already hold
 * the profile row -- src/lib/ranking/run.ts loads it before ranking -- can pass
 * the flag straight through instead of paying a second round trip.
 */
export function consentFromProfile(consent: boolean | null | undefined): boolean {
  return consent === true;
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
    .select("analytics_consent")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    console.error(`[analytics] consent read failed for owner ${ownerId}: ${error.message}`);
    return false;
  }

  return consentFromProfile(data?.analytics_consent);
}
