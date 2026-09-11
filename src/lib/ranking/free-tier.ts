import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { appCalendarDate } from "@/lib/dates";

export type FreeRecomputeClaim = "claimed" | "spent" | "no-profile";

/**
 * Spends the owner's one free manual "Przelicz teraz" for today, or reports
 * it is already spent.
 *
 * One guarded `UPDATE ... WHERE (free_recompute_claimed_on IS NULL OR <
 * today) ... RETURNING` is the compare-and-swap KV cannot provide -- see the
 * limitation recorded at src/pages/api/rankings.ts:50-56. The row lock makes
 * "read the date, decide, write" atomic against a second concurrent request,
 * which a read-then-write from the app layer could not guarantee.
 *
 * Callers must check `hasUsableOwnerKey` first: this function has no opinion
 * about BYOK, it only spends the claim.
 */
export async function claimFreeRecompute(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<FreeRecomputeClaim> {
  const today = appCalendarDate();

  const { data: claimed, error } = await supabase
    .from("profiles")
    .update({ free_recompute_claimed_on: today })
    .eq("owner_id", ownerId)
    .or(`free_recompute_claimed_on.is.null,free_recompute_claimed_on.lt.${today}`)
    .select("owner_id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim free recompute: ${error.message}`);
  }
  if (claimed) {
    return "claimed";
  }

  // Zero rows matched above for one of two reasons -- already claimed today,
  // or no profile row exists at all. The guarded UPDATE alone cannot tell
  // them apart, so a follow-up read, scoped to the same RLS-confined client,
  // resolves which one it was.
  const { data: profile } = await supabase.from("profiles").select("owner_id").eq("owner_id", ownerId).maybeSingle();

  return profile ? "spent" : "no-profile";
}
