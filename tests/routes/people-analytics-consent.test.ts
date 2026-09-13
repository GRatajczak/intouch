// test-plan Phase 6, Risk #9: POST /api/people's first_person_added emission
// must actually respect analytics_opt_out at the real route, with the vendor
// call visible or absent at the network edge -- not merely inferred from
// reading the code. Reuses the RLS fixture tests/routes/people.test.ts (Phase
// 4) already established for the same route.
//
// The fixture seeds one `people` row per owner (tests/rls/fixture.ts), so
// `existingPeople === 0` -- the gate first_person_added fires on -- would
// never be true without first clearing it; both cases below delete that
// seeded row before submitting, to reach a genuine "first person" state.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRlsFixture, destroyRlsFixture, type RlsFixture } from "../rls/fixture";
import { createContext } from "./context";
import { clearRouteClient, setRouteClient } from "./route-client";

vi.mock("@/lib/supabase", async () => {
  const state = await import("./route-client");
  return { createClient: () => state.getRouteClient() };
});

const { POST: peoplePost } = await import("@/pages/api/people");

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

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

/** Intercepts only PostHog-host calls; everything else (the RLS fixture's own
 * real Supabase HTTP calls) passes through to the real fetch -- mirroring
 * tests/routes/free-tier-limit.test.ts's stubOpenAiFetch pattern. */
function stubPostHogFetch(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("posthog.com")) {
        const body = typeof init?.body === "string" ? init.body : "{}";
        captured.push({ url, body: JSON.parse(body) as Record<string, unknown> });
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return realFetch(input, init);
    }),
  );
  return captured;
}

async function resetToZeroPeople(which: "A" | "B"): Promise<void> {
  const client = which === "A" ? fx.clientA : fx.clientB;
  const ownerId = which === "A" ? fx.userAId : fx.userBId;
  await client.from("people").delete().eq("owner_id", ownerId);
}

function personForm(): Record<string, string> {
  return {
    "name-0": "Basia",
    "relationshipType-0": "friend",
    "description-0": "Znajoma",
    "isCollective-0": "false",
    "weight-0": "5",
  };
}

describe("POST /api/people: first_person_added respects analytics_opt_out", () => {
  it("emits nothing when the owner has opted out", async () => {
    await resetToZeroPeople("A");
    await fx.clientA.from("profiles").update({ analytics_opt_out: true }).eq("owner_id", fx.userAId);
    setRouteClient(fx.clientA);
    const captured = stubPostHogFetch();

    const response = await peoplePost(createContext({ user: { id: fx.userAId }, method: "POST", form: personForm() }));

    expect(response.status).toBe(302);
    expect(captured).toHaveLength(0);
  });

  it("emits exactly one allow-listed event when the owner is consented", async () => {
    await resetToZeroPeople("B");
    await fx.clientB.from("profiles").update({ analytics_opt_out: false }).eq("owner_id", fx.userBId);
    setRouteClient(fx.clientB);
    const captured = stubPostHogFetch();

    const response = await peoplePost(createContext({ user: { id: fx.userBId }, method: "POST", form: personForm() }));

    expect(response.status).toBe(302);
    expect(captured).toHaveLength(1);
    expect(captured[0].body.event).toBe("first_person_added");
    expect(captured[0].body.distinct_id).toBe(fx.userBId);
    expect(captured[0].body.properties).toEqual({ people_added: 1, $process_person_profile: false });
  });
});
