// Risk #7: the scheduled sweep reaches for a service-role key and defeats
// per-user isolation.
//
// This file guards the half of that risk that isolation.test.ts cannot see.
// That suite proves the *table* policies on reminder_sends; these two functions
// are SECURITY DEFINER, which means they run as their owner and ignore RLS
// entirely. Nothing about a correct policy stops a browser from calling them --
// only the GRANT does, and a GRANT is invisible in the table's policy list.
//
// The stakes are concrete and asymmetric between the two: an exposed
// `record_reminder_send` lets a stranger write junk rows, while an exposed
// `reminder_candidates` hands out every registered user's email address in a
// single unauthenticated request. It is the one query in this system that sees
// across owners by design (20260908090338_create_reminder_sends.sql:129).
//
// Why 42501 specifically, rather than "some error": Postgres grants EXECUTE on
// every new function to PUBLIC by default, so the only thing standing between
// these functions and an anon client is the explicit REVOKE at the bottom of
// that migration. If someone drops those revokes, the call starts succeeding --
// but if instead the function were renamed or never created, PostgREST would
// answer PGRST202 ("could not find the function"). Both are failures; only one
// is *this* failure, and a test that accepted either would report a missing
// function as a passing security boundary.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRlsFixture, createServiceClient, destroyRlsFixture, type RlsFixture, type TestClient } from "./fixture";

/** Postgres: insufficient_privilege. Surfaced verbatim by PostgREST. */
const PERMISSION_DENIED = "42501";

const CANDIDATE_ARGS = { cooldown_days: 3, max_rows: 25 };

let fx: RlsFixture;
let service: TestClient;

beforeAll(async () => {
  fx = await createRlsFixture();
  service = createServiceClient();
}, 60_000);

afterAll(async () => {
  await destroyRlsFixture();
});

describe("reminder_candidates", () => {
  it.each([
    ["an anonymous caller", (): TestClient => fx.anonClient],
    ["a signed-in user", (): TestClient => fx.clientA],
  ])("is not executable by %s", async (_label, client) => {
    const { data, error } = await client().rpc("reminder_candidates", CANDIDATE_ARGS);

    expect(error?.code).toBe(PERMISSION_DENIED);
    // Belt and braces: a future PostgREST that reported the denial differently
    // must still not have handed over rows.
    expect(data).toBeNull();
  });

  it("is executable by the service role the sweep runs as", async () => {
    const { data, error } = await service.rpc("reminder_candidates", CANDIDATE_ARGS);

    // Without this the three tests above would pass just as happily against a
    // function that nobody at all can call -- a broken sweep reported as a
    // secure one.
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("never returns an owner who has opted out", async () => {
    // The fixture's users are opted in by the column default, so user A should
    // be visible to the sweep before anything changes.
    const before = await service.rpc("reminder_candidates", { cooldown_days: 0, max_rows: 1000 });
    expect(ownerIds(before.data)).toContain(fx.userAId);

    const { error: updateError } = await fx.clientA
      .from("profiles")
      .update({ reminders_enabled: false })
      .eq("owner_id", fx.userAId);
    expect(updateError).toBeNull();

    const after = await service.rpc("reminder_candidates", { cooldown_days: 0, max_rows: 1000 });
    expect(ownerIds(after.data)).not.toContain(fx.userAId);

    // Restored so this file's tests stay order-independent.
    await fx.clientA.from("profiles").update({ reminders_enabled: true }).eq("owner_id", fx.userAId);
  });

  it("holds a recently reminded owner inside the cooldown and releases them after it", async () => {
    // The fixture seeds one 'sent' row per owner, dated now -- so at a cooldown
    // of one calendar day user A is silent, which is exactly the PRD's "at most
    // once per day" ceiling.
    const sameDay = await service.rpc("reminder_candidates", { cooldown_days: 1, max_rows: 1000 });
    expect(ownerIds(sameDay.data)).not.toContain(fx.userAId);

    // Backdated four calendar days: a three-day cooldown has elapsed.
    const { error: backdateError } = await fx.clientA
      .from("reminder_sends")
      .update({ sent_at: daysAgo(4) })
      .eq("owner_id", fx.userAId);
    expect(backdateError).toBeNull();

    const released = await service.rpc("reminder_candidates", { cooldown_days: 3, max_rows: 1000 });
    expect(ownerIds(released.data)).toContain(fx.userAId);
  });

  it("does not let a failed send start a cooldown", async () => {
    // A Resend hiccup must not buy the user days of silence: the failure is
    // recorded for observability, but only a successful send gates the next one.
    const { error: markFailed } = await fx.clientA
      .from("reminder_sends")
      .update({ status: "failed", provider_message_id: null, error: "simulated provider failure" })
      .eq("owner_id", fx.userAId);
    expect(markFailed).toBeNull();

    const { data } = await service.rpc("reminder_candidates", { cooldown_days: 3650, max_rows: 1000 });
    expect(ownerIds(data)).toContain(fx.userAId);
  });
});

describe("record_reminder_send", () => {
  it.each([
    ["an anonymous caller", (): TestClient => fx.anonClient],
    ["a signed-in user", (): TestClient => fx.clientA],
  ])("is not executable by %s", async (_label, client) => {
    const { error } = await client().rpc("record_reminder_send", {
      p_owner_id: fx.userAId,
      p_person_id: fx.seededA.people.id as string,
      p_ranking_id: fx.seededA.rankings.id as string,
      p_status: "sent",
      p_provider_message_id: "msg-from-an-unauthorised-caller",
      p_error: "",
    });

    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

function ownerIds(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return (data as { owner_id: string }[]).map((row) => row.owner_id);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
