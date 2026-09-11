export interface ApiKeySectionProps {
  /** Last four characters of the stored key, e.g. "4f2a", or null if none is stored. Never the full key. */
  hint: string | null;
  /** True when a key is stored but could not be decrypted -- e.g. after an encryption-secret rotation. */
  unreadable: boolean;
}
