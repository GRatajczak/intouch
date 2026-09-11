export interface ApiKeySectionProps {
  /** Last four characters of the stored key, e.g. "4f2a", or null if none is stored. Never the full key. */
  hint: string | null;
  /** True when a key is stored but could not be decrypted -- e.g. after an encryption-secret rotation. */
  unreadable: boolean;
  /**
   * Why the stored key last failed during a ranking run -- "auth" (OpenAI
   * rejected it) or "quota" (it ran out) -- or null when there is no known
   * failure. Written only by src/lib/ranking/run.ts, inside a background job
   * nobody is watching; this is what surfaces it. Saving a new key clears it.
   */
  failure: "auth" | "quota" | null;
}
