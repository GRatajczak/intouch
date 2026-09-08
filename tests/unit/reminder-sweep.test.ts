// test-plan.md Risk #7: "the scheduled sweep sends more than once a day, sends
// to the wrong recipient, fails silently."
//
// Hermetic on purpose. CLAUDE.md's two-layer rule says partial failures that
// real infrastructure cannot trigger on demand belong in stubs, not in an
// integration test that contorts itself to force them -- and every branch below
// is exactly that: the refresh fails but the send would have worked, the send
// fails after the refresh succeeded, one owner blows up in the middle of a run.
//
// What is deliberately NOT tested here: the cooldown and the opt-out. Those
// live in SQL (public.reminder_candidates) and a stub would happily lie about
// them, so they are proven against real Postgres in
// tests/rls/reminder-rpc.test.ts instead.
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { Tables } from "@/db/database.types";
import { runSweep, type ReminderCandidate, type SweepDeps } from "@/lib/reminders/sweep";

const OWNER = "owner-1";
const FRESH = new Date().toISOString();
const STALE = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

function personRow(): Tables<"people"> {
  return {
    id: "basia",
    owner_id: OWNER,
    name: "Basia",
    description: "Ciocia",
    relationship_type: "family",
    relationship_context: null,
    context_tags: [],
    last_contact_bucket: null,
    is_collective: false,
    status: "active",
    weight: 9,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

interface FakeState {
  candidates: ReminderCandidate[];
  /** created_at of the owner's ranking, or null for "no ranking at all". */
  rankingCreatedAt: string | null;
  timeWindow: string;
  /** Every record_reminder_send call, in order. */
  logged: Record<string, unknown>[];
  profileName: string;
}

/**
 * A stand-in for the service-role client, answering only what the sweep asks:
 * the candidates RPC, the ranking + entries reads, the contact-events read, the
 * profile read, and the send-log RPC. Anything else throws, so a sweep that
 * starts querying something new fails loudly here rather than silently passing.
 */
function fakeSupabase(state: FakeState): SupabaseClient<Database> {
  const table = (name: string) => {
    const rows: Record<string, unknown>[] =
      name === "rankings"
        ? state.rankingCreatedAt === null
          ? []
          : [
              {
                id: "ranking-1",
                owner_id: OWNER,
                created_at: state.rankingCreatedAt,
                model: "gpt-5.4-mini",
                people_considered: 1,
                people_total: 1,
              },
            ]
        : name === "ranking_entries"
          ? [
              {
                id: "entry-1",
                ranking_id: "ranking-1",
                owner_id: OWNER,
                person_id: "basia",
                rank_position: 1,
                time_window: state.timeWindow,
                reason: "Minął rok.",
                context_note: null,
                rhythm_note: null,
                person: personRow(),
              },
            ]
          : name === "contact_events"
            ? []
            : name === "profiles"
              ? [{ owner_id: OWNER, name: state.profileName }]
              : (() => {
                  throw new Error(`unexpected table read: ${name}`);
                })();

    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit", "gt"]) {
      builder[method] = () => builder;
    }
    builder.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    builder.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    builder.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
      resolve({ data: rows, error: null });
    return builder;
  };

  return {
    from: (name: string) => table(name),
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "reminder_candidates") {
        return Promise.resolve({ data: state.candidates, error: null });
      }
      if (fn === "record_reminder_send") {
        state.logged.push(args);
        return Promise.resolve({ data: "send-id", error: null });
      }
      throw new Error(`unexpected rpc: ${fn}`);
    },
  } as unknown as SupabaseClient<Database>;
}

function setup(over: Partial<FakeState> = {}, depsOver: Partial<SweepDeps> = {}) {
  const state: FakeState = {
    candidates: [{ owner_id: OWNER, email: "anna@example.com", last_sent_at: null }],
    rankingCreatedAt: FRESH,
    timeWindow: "this_week",
    logged: [],
    profileName: "Anna",
    ...over,
  };

  const deps: SweepDeps = {
    supabase: fakeSupabase(state),
    refreshRanking: vi.fn(() => Promise.resolve<"done" | "failed">("done")),
    sendEmail: vi.fn(() => Promise.resolve("resend-msg-1")),
    baseUrl: "https://base.test",
    ...depsOver,
  };

  return { state, deps };
}

describe("runSweep", () => {
  it("sends to the address the candidates query returned, and logs the send", async () => {
    const { state, deps } = setup();

    const summary = await runSweep(deps);

    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.sendEmail).mock.calls[0][0].to).toBe("anna@example.com");
    expect(summary.sent).toBe(1);
    expect(state.logged).toHaveLength(1);
    expect(state.logged[0].p_status).toBe("sent");
    expect(state.logged[0].p_provider_message_id).toBe("resend-msg-1");
  });

  it("records a failed send instead of losing it", async () => {
    // The NFR is explicit that delivery outcomes must be observable rather than
    // fire-and-forget. A send that throws and leaves no row is indistinguishable
    // from a user who was never a candidate.
    const { state, deps } = setup({}, { sendEmail: vi.fn(() => Promise.reject(new Error("Resend 429"))) });

    const summary = await runSweep(deps);

    expect(summary.sent).toBe(0);
    expect(summary.failed).toBe(1);
    expect(state.logged).toHaveLength(1);
    expect(state.logged[0].p_status).toBe("failed");
    expect(String(state.logged[0].p_error)).toContain("Resend 429");
  });

  it("does not send when the ranking refresh failed", async () => {
    // Sending from a ranking whose refresh just failed means emailing yesterday's
    // conclusion as though it were today's.
    const { state, deps } = setup(
      { rankingCreatedAt: STALE },
      { refreshRanking: vi.fn(() => Promise.resolve<"done" | "failed">("failed")) },
    );

    const summary = await runSweep(deps);

    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(summary.skipped.refresh_failed).toBe(1);
    expect(state.logged).toHaveLength(0);
  });

  it("refreshes a stale ranking before deciding", async () => {
    const { deps } = setup({ rankingCreatedAt: STALE });

    const summary = await runSweep(deps);

    expect(deps.refreshRanking).toHaveBeenCalledWith(OWNER);
    expect(summary.refreshed).toBe(1);
  });

  it("leaves a fresh ranking alone", async () => {
    const { deps } = setup({ rankingCreatedAt: FRESH });

    await runSweep(deps);

    expect(deps.refreshRanking).not.toHaveBeenCalled();
  });

  it("writes no row when there is nothing urgent to say", async () => {
    // Silence is not a send. Logging it would start a cooldown for an email
    // that never existed, and the next genuinely urgent nudge would be delayed
    // by a day the user never got anything for.
    const { state, deps } = setup({ timeWindow: "no_rush" });

    const summary = await runSweep(deps);

    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(state.logged).toHaveLength(0);
    expect(summary.skipped.nothing_urgent).toBe(1);
  });

  it("keeps going after one owner fails", async () => {
    // A sweep is a loop over strangers. One owner's bad data or provider error
    // must not cost everyone queued behind them their reminder.
    const { deps } = setup({
      candidates: [
        { owner_id: "owner-a", email: "a@example.com", last_sent_at: null },
        { owner_id: "owner-b", email: "b@example.com", last_sent_at: null },
      ],
    });
    let call = 0;
    deps.sendEmail = vi.fn(() => {
      call += 1;
      return call === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("resend-msg-2");
    });

    const summary = await runSweep(deps);

    expect(summary.considered).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.sent).toBe(1);
  });

  it("sends nothing and writes nothing on a dry run", async () => {
    const { state, deps } = setup();

    const summary = await runSweep(deps, { dryRun: true });

    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(state.logged).toHaveLength(0);
    // Still reports what it would have done, or the dry run tells you nothing.
    expect(summary.sent).toBe(1);
  });
});
