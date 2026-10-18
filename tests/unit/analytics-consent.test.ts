// test-plan Phase 6, Risk #9: the consent predicate's truth table, and
// hasAnalyticsConsent's fail-CLOSED behavior on a query error -- a real,
// deliberate privacy decision (favors under-counting over leaking) with no
// regression test before this phase.
import { describe, expect, it } from "vitest";
import { consentFromProfile, hasAnalyticsConsent } from "@/lib/analytics/consent";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

/** A minimal `profiles`-only fake -- this test's own table set, not the
 * shared ranking fixture, which models a different set of tables. */
function fakeProfilesClient(result: {
  data: { analytics_consent: boolean | null } | null;
  error: { message: string } | null;
}): SupabaseClient<Database> {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(result),
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("consentFromProfile", () => {
  it("treats only an explicit true as consent", () => {
    expect(consentFromProfile(true)).toBe(true);
  });

  it("treats false, null (never asked) and undefined (no row) as not consented", () => {
    expect(consentFromProfile(false)).toBe(false);
    expect(consentFromProfile(null)).toBe(false);
    expect(consentFromProfile(undefined)).toBe(false);
  });
});

describe("hasAnalyticsConsent", () => {
  it("returns false when no profile row exists", async () => {
    const client = fakeProfilesClient({ data: null, error: null });

    expect(await hasAnalyticsConsent(client, "owner-1")).toBe(false);
  });

  it("returns false when analytics_consent is null (never asked)", async () => {
    const client = fakeProfilesClient({ data: { analytics_consent: null }, error: null });

    expect(await hasAnalyticsConsent(client, "owner-1")).toBe(false);
  });

  it("returns false when analytics_consent is false", async () => {
    const client = fakeProfilesClient({ data: { analytics_consent: false }, error: null });

    expect(await hasAnalyticsConsent(client, "owner-1")).toBe(false);
  });

  it("returns true when analytics_consent is true", async () => {
    const client = fakeProfilesClient({ data: { analytics_consent: true }, error: null });

    expect(await hasAnalyticsConsent(client, "owner-1")).toBe(true);
  });

  it("fails CLOSED (false, never throws) when the query itself errors", async () => {
    const client = fakeProfilesClient({ data: null, error: { message: "connection reset" } });

    await expect(hasAnalyticsConsent(client, "owner-1")).resolves.toBe(false);
  });
});
