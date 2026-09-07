// TEMPORARY probe -- Phase 1 only, deleted before Phase 2.
// Settles the load-bearing assumption that `astro:env/server` resolves under
// Vitest AND that `.env.test` actually supplies the values at config-resolution
// time. Missing secrets fail silently in this repo (astro skips validation for
// them), surfacing only as `createClient` returning null -- which routes then
// translate into a 500 or a redirect. A misconfigured harness would look exactly
// like a product bug, so this probe converts that silence into an explicit fail.
import { describe, expect, it } from "vitest";
import { createClient } from "@/lib/supabase";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

describe("probe A: astro:env/server under Vitest", () => {
  it("resolves the astro:env/server module with both required values", () => {
    expect(SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(SUPABASE_KEY).toBeTruthy();
  });

  it("builds a non-null Supabase client, proving env reached src/lib/supabase.ts", () => {
    const client = createClient(new Headers(), stubCookies());
    expect(client).not.toBeNull();
  });
});

// The narrowest shape src/lib/supabase.ts touches: it only ever calls cookies.set.
function stubCookies() {
  return { set: () => undefined } as unknown as Parameters<typeof createClient>[1];
}
