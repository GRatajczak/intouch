// POST/DELETE /api/settings/openai-key -- S-17's BYOK save/remove.
//
// The cookbook triad this layer has established (reminders-toggle.test.ts,
// delete-data.test.ts): an anonymous caller must not reach the route, a
// signed-in caller's write must stop at their own row, and the real
// happy-path write must actually land. The cross-owner instrument is
// delete-data.test.ts's, for the same reason it exists there: run the
// handler under the caller's own session and RLS absorbs a missing owner
// filter, so the test would pass against a route that had none. Handing the
// handler a connection carrying A's session while `locals.user` says B makes
// the route's own `.eq("owner_id", …)` the only guard left -- verified by
// deleting that filter and confirming this test goes red.
//
// OpenAI validation is stubbed at the network edge, the same technique
// tests/unit/ranking-key-source.test.ts established: a stubbed
// `globalThis.fetch` stands in for the wire, so the real OpenAI SDK request
// path runs unmodified against a canned response.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRlsFixture, destroyRlsFixture, mintExtraSession, type RlsFixture } from "../rls/fixture";
import { createContext, jsonBody } from "./context";
import { clearRouteClient, setRouteClient } from "./route-client";
import { decryptApiKey } from "@/lib/crypto/api-key";

vi.mock("@/lib/supabase", async () => {
  const state = await import("./route-client");
  return { createClient: () => state.getRouteClient() };
});

const { POST: saveKey, DELETE: deleteKey } = await import("@/pages/api/settings/openai-key");

let fx: RlsFixture;

beforeAll(async () => {
  fx = await createRlsFixture();
}, 60_000);

afterAll(async () => {
  clearRouteClient();
  await destroyRlsFixture();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Stubs only requests bound for OpenAI, passing every other request -- most
 * importantly the RLS fixture's own Supabase auth/REST calls -- through to the
 * real global fetch. Stubbing `globalThis.fetch` unconditionally would
 * intercept those too, since this file (unlike
 * tests/unit/ranking-key-source.test.ts, which fakes Supabase entirely) runs
 * against the real local stack.
 */
function stubOpenAiFetch(response: Response): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("api.openai.com")) {
        return Promise.resolve(response.clone());
      }
      return realFetch(input, init);
    }),
  );
}

function stubOpenAiValidationSuccess(): void {
  stubOpenAiFetch(
    new Response(JSON.stringify({ object: "list", data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

async function ciphertextFor(which: "A" | "B"): Promise<string | null> {
  const client = await mintExtraSession(fx, which);
  const ownerId = which === "A" ? fx.userAId : fx.userBId;
  const { data } = await client
    .from("profiles")
    .select("openai_api_key_ciphertext")
    .eq("owner_id", ownerId)
    .maybeSingle();
  return data?.openai_api_key_ciphertext ?? null;
}

describe("POST /api/settings/openai-key", () => {
  it("refuses an anonymous caller and never builds a client", async () => {
    clearRouteClient();

    const response = await saveKey(createContext({ method: "POST", json: { apiKey: "sk-anything" } }));

    expect(response.status).toBe(401);
    expect(await jsonBody(response)).toEqual({ error: "Musisz być zalogowany" });
  });

  it("rejects a malformed body and leaves the stored value untouched", async () => {
    setRouteClient(fx.clientA);

    const response = await saveKey(
      createContext({ user: { id: fx.userAId }, method: "POST", json: { apiKey: "too-short" } }),
    );

    expect(response.status).toBe(400);
    expect(await ciphertextFor("A")).toBeNull();
  });

  it("writes only the row the handler was told to, never the connection's owner", async () => {
    // A's session, B's identity -- the same mismatch instrument delete-data.test.ts
    // and reminders-toggle.test.ts use. RLS confines A's session to A's row, and the
    // route additionally filters on B's id, so no row can ever satisfy both --
    // the update matches nothing and the route answers 404, touching neither owner.
    setRouteClient(fx.clientA);
    stubOpenAiValidationSuccess();

    const response = await saveKey(
      createContext({ user: { id: fx.userBId }, method: "POST", json: { apiKey: "sk-cross-owner-attempt-000000" } }),
    );

    expect(response.status).toBe(404);
    expect(await ciphertextFor("A")).toBeNull();
    expect(await ciphertextFor("B")).toBeNull();
  });

  it("reports 404 rather than success when there is no profile row to update", async () => {
    setRouteClient(fx.clientA);
    stubOpenAiValidationSuccess();

    const response = await saveKey(
      createContext({
        user: { id: "00000000-0000-0000-0000-000000000000" },
        method: "POST",
        json: { apiKey: "sk-no-such-profile-row-000000" },
      }),
    );

    expect(response.status).toBe(404);
  });

  it("answers 400 and writes nothing when OpenAI rejects the key", async () => {
    setRouteClient(fx.clientA);
    stubOpenAiFetch(
      new Response(JSON.stringify({ error: { message: "Incorrect API key provided." } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await saveKey(
      createContext({ user: { id: fx.userAId }, method: "POST", json: { apiKey: "sk-rejected-by-openai-000000" } }),
    );

    expect(response.status).toBe(400);
    expect(await ciphertextFor("A")).toBeNull();
  });

  it("writes ciphertext that decrypts back to the submitted key, and a hint of its last four characters", async () => {
    setRouteClient(fx.clientA);
    stubOpenAiValidationSuccess();
    const submitted = "sk-a-real-looking-openai-key-0123456789";

    const response = await saveKey(
      createContext({ user: { id: fx.userAId }, method: "POST", json: { apiKey: submitted } }),
    );

    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body).toEqual({ hint: submitted.slice(-4) });

    const ciphertext = await ciphertextFor("A");
    if (ciphertext === null) {
      throw new Error("expected a ciphertext to have been written");
    }
    await expect(decryptApiKey(ciphertext)).resolves.toBe(submitted);
  });
});

describe("DELETE /api/settings/openai-key", () => {
  it("refuses an anonymous caller", async () => {
    clearRouteClient();

    const response = await deleteKey(createContext({ method: "DELETE" }));

    expect(response.status).toBe(401);
    expect(await jsonBody(response)).toEqual({ error: "Musisz być zalogowany" });
  });

  it("clears the caller's own stored key", async () => {
    // Depends on the previous describe block's final test having saved a key for A.
    setRouteClient(fx.clientA);
    expect(await ciphertextFor("A")).not.toBeNull();

    const response = await deleteKey(createContext({ user: { id: fx.userAId }, method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ hint: null });
    expect(await ciphertextFor("A")).toBeNull();
  });
});
