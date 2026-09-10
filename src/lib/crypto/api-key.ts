import { OPENAI_KEY_ENCRYPTION_KEY } from "astro:env/server";

// S-17's bring-your-own-key envelope. Prefixed "v1:" so a future rotation of
// OPENAI_KEY_ENCRYPTION_KEY can introduce a "v2:" scheme without a format
// migration -- callers just start writing the new prefix.
const ENVELOPE_VERSION = "v1";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Imports OPENAI_KEY_ENCRYPTION_KEY as an AES-GCM key, or null when the
 * secret is absent or malformed (not valid base64, or not 32 raw bytes). A
 * malformed secret is treated as an absent one, mirroring every other
 * null-returning factory in src/lib/.
 */
async function importEncryptionKey(): Promise<CryptoKey | null> {
  if (!OPENAI_KEY_ENCRYPTION_KEY) {
    return null;
  }
  let raw: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(OPENAI_KEY_ENCRYPTION_KEY);
    raw = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      raw[i] = binary.charCodeAt(i);
    }
  } catch {
    return null;
  }
  if (raw.length !== 32) {
    return null;
  }
  try {
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

/**
 * Encrypts a user-supplied credential into the stored envelope
 * "v1:<base64url iv>:<base64url ciphertext>", with a fresh random 12-byte IV
 * per call. Returns null when OPENAI_KEY_ENCRYPTION_KEY is absent or
 * malformed -- never throws.
 */
export async function encryptApiKey(plaintext: string): Promise<string | null> {
  const key = await importEncryptionKey();
  if (!key) {
    return null;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const encoded = new TextEncoder().encode(plaintext).buffer;
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
    return `${ENVELOPE_VERSION}:${bytesToBase64Url(iv)}:${bytesToBase64Url(new Uint8Array(ciphertext))}`;
  } catch {
    return null;
  }
}

/**
 * Decrypts an envelope produced by encryptApiKey. Returns null -- never
 * throws -- when OPENAI_KEY_ENCRYPTION_KEY is absent, when the envelope is
 * malformed or carries an unknown version prefix, or when decryption fails
 * for any reason (wrong key, tampered ciphertext).
 */
export async function decryptApiKey(envelope: string): Promise<string | null> {
  const parts = envelope.split(":");
  if (parts.length !== 3 || parts[0] !== ENVELOPE_VERSION) {
    return null;
  }
  const [, ivPart, ciphertextPart] = parts;
  const iv = base64UrlToBytes(ivPart);
  const ciphertext = base64UrlToBytes(ciphertextPart);
  if (!iv || !ciphertext) {
    return null;
  }
  const key = await importEncryptionKey();
  if (!key) {
    return null;
  }
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
