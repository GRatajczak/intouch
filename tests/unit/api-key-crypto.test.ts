// Pins the envelope contract of src/lib/crypto/api-key.ts and every
// non-throwing failure path. OPENAI_KEY_ENCRYPTION_KEY comes from .env.test --
// a throwaway value generated for this suite, never a hosted-project secret.
import { describe, it, expect } from "vitest";
import { encryptApiKey, decryptApiKey } from "@/lib/crypto/api-key";

const PLAINTEXT = "sk-test-abcdefghijklmnopqrstuvwxyz1234";

async function mustEncrypt(plaintext: string): Promise<string> {
  const envelope = await encryptApiKey(plaintext);
  if (envelope === null) {
    throw new Error("encryptApiKey unexpectedly returned null -- check OPENAI_KEY_ENCRYPTION_KEY in .env.test");
  }
  return envelope;
}

describe("encryptApiKey / decryptApiKey", () => {
  it("round-trips the original plaintext", async () => {
    const envelope = await mustEncrypt(PLAINTEXT);

    await expect(decryptApiKey(envelope)).resolves.toBe(PLAINTEXT);
  });

  it("uses a fresh IV per call, so two encryptions of the same input differ", async () => {
    const first = await encryptApiKey(PLAINTEXT);
    const second = await encryptApiKey(PLAINTEXT);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
  });

  it("returns null for a mangled envelope", async () => {
    await expect(decryptApiKey("not-a-real-envelope")).resolves.toBeNull();
    await expect(decryptApiKey("v1:only-two-parts")).resolves.toBeNull();
    await expect(decryptApiKey("v1:not-base64url!!:also-not-base64url!!")).resolves.toBeNull();
  });

  it("returns null for an unknown version prefix", async () => {
    const envelope = await mustEncrypt(PLAINTEXT);
    const reversioned = `v2:${envelope.split(":").slice(1).join(":")}`;

    await expect(decryptApiKey(reversioned)).resolves.toBeNull();
  });

  it("returns null for a ciphertext encrypted under a different key", async () => {
    const otherKey = await crypto.subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(32)),
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      otherKey,
      new TextEncoder().encode(PLAINTEXT),
    );
    const toBase64Url = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const envelope = `v1:${toBase64Url(iv)}:${toBase64Url(new Uint8Array(ciphertext))}`;

    await expect(decryptApiKey(envelope)).resolves.toBeNull();
  });
});
