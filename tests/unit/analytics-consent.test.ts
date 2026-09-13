// test-plan Phase 6, Risk #9: the consent predicate's truth table, and
// hasAnalyticsConsent's fail-CLOSED behavior on a query error -- a real,
// deliberate privacy decision (favors under-counting over leaking) with no
// regression test before this phase.
import { describe, expect, it } from "vitest";
import { consentFromOptOut, hasAnalyticsConsent } from "@/lib/analytics/consent";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

/** A minimal `profiles`-only fake -- this test's own table set, not the
 * shared ranking fixture, which models a different set of tables. */
function fakeProfilesClient(result: {
  data: { analytics_opt_out: boolean | null } | null;
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

describe("consentFromOptOut", () => {
  it("treats undefined, null and false as consented", () => {
    expect(consentFromOptOut(undefined)).toBe(true);
    expect(consentFromOptOut(null)).toBe(true);
    expect(consentFromOptOut(false)).toBe(true);
  });

  it("treats true as not consented", () => {
    expect(consentFromOptOut(true)).toBe(false);
  });
});

describe("hasAnalyticsConsent", () => {
  it("returns true when no profile row exists", async () => {
    const client = fakeProfilesClient({ data: null, error: null });

    expect(await hasAnalyticsConsent(client, "owner-1")).toBe(true);
  });

  it("returns true when analytics_opt_out is false", async () => {
    const client = fakeProfilesClient({ data: { analytics_opt_out: false }, error: null });

    expect(await hasAnalyticsConsent(client, "owner-1")).toBe(true);
  });

  it("returns false when analytics_opt_out is true", async () => {
    const client = fakeProfilesClient({ data: { analytics_opt_out: true }, error: null });

    expect(await hasAnalyticsConsent(client, "owner-1")).toBe(false);
  });

  it("fails CLOSED (false, never throws) when the query itself errors", async () => {
    const client = fakeProfilesClient({ data: null, error: { message: "connection reset" } });

    await expect(hasAnalyticsConsent(client, "owner-1")).resolves.toBe(false);
  });
});
