import type { Tables } from "@/db/database.types";
import { decryptApiKey } from "@/lib/crypto/api-key";

export type OwnerKey = { source: "user"; apiKey: string } | { source: "app" } | { source: "app"; unreadable: true };

/**
 * Turns a loaded profile row into a decision about whose key pays for the
 * next OpenAI call.
 *
 * No ciphertext means the owner never stored a key: `app`. Ciphertext that
 * decrypts means the owner has a usable key: `user`. Ciphertext that fails to
 * decrypt -- an unreadable secret after a rotation, a corrupted row -- falls
 * back to `app` with `unreadable: true`, which is OUR fault, not the owner's,
 * so /settings surfaces it rather than silently spending their free tier.
 *
 * Takes no Supabase client of its own: callers already hold the profile row
 * (runRanking via its own load, run-sweep.ts via the admin client it already
 * has), so this stays a pure function over the row instead of a second query.
 */
export async function resolveOwnerKey(
  profile: Pick<Tables<"profiles">, "openai_api_key_ciphertext">,
): Promise<OwnerKey> {
  if (!profile.openai_api_key_ciphertext) {
    return { source: "app" };
  }

  const apiKey = await decryptApiKey(profile.openai_api_key_ciphertext);
  if (apiKey === null) {
    return { source: "app", unreadable: true };
  }

  return { source: "user", apiKey };
}

/** Whether this owner has a usable key -- what Phase 4's daily gate checks before charging the free tier. */
export async function hasUsableOwnerKey(
  profile: Pick<Tables<"profiles">, "openai_api_key_ciphertext">,
): Promise<boolean> {
  const resolved = await resolveOwnerKey(profile);
  return resolved.source === "user";
}
