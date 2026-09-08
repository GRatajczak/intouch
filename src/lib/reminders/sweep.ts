import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { loadContactFacts } from "@/lib/contact-history/facts";
import { isStale, loadLatestRanking, type RankingViewModel } from "@/lib/ranking/store";
import { renderReminderEmail } from "@/lib/reminders/email";
import { buildReasonFactors, selectHero, MAX_REFRESHES_PER_RUN, REMINDER_COOLDOWN_DAYS } from "@/lib/reminders/select";

/** One candidate as public.reminder_candidates() returns them. */
export interface ReminderCandidate {
  owner_id: string;
  email: string;
  last_sent_at: string | null;
}

/**
 * Everything the sweep reaches outside itself.
 *
 * An explicit seam rather than vi.mock, matching tests/routes/route-client.ts:
 * the branches worth testing here are partial failures -- the refresh works but
 * the send fails, the send works but one owner blows up mid-loop -- and real
 * infra cannot be made to produce those on demand. CLAUDE.md's two-layer rule
 * names exactly this case as hermetic-stub territory.
 */
export interface SweepDeps {
  /** Service-role client. Its only cross-owner use is the candidates RPC. */
  supabase: SupabaseClient<Database>;
  /** Refreshes one owner's ranking; returns the run's terminal status. */
  refreshRanking: (ownerId: string) => Promise<"done" | "failed">;
  /** Sends one email, resolving to the provider's message id. */
  sendEmail: (params: { to: string; subject: string; html: string }) => Promise<string>;
  /** Canonical origin for every link in the email. */
  baseUrl: string;
}

export type SkipReason = "refresh_failed" | "no_ranking" | "nothing_urgent";

export interface SweepSummary {
  considered: number;
  refreshed: number;
  sent: number;
  failed: number;
  skipped: Record<SkipReason, number>;
}

export interface SweepOptions {
  dryRun?: boolean;
}

function emptySummary(): SweepSummary {
  return {
    considered: 0,
    refreshed: 0,
    sent: 0,
    failed: 0,
    skipped: { refresh_failed: 0, no_ranking: 0, nothing_urgent: 0 },
  };
}

/**
 * Ensures the owner has a ranking worth reading from, refreshing a stale one.
 *
 * Returns null when there is nothing usable -- which is a skip, never a send.
 * The target persona is someone who does not open the app, so a stale ranking
 * is the normal case here rather than the exception; refreshing is what makes
 * the feature work for the people it exists for.
 */
async function ensureFreshRanking(
  deps: SweepDeps,
  ownerId: string,
  summary: SweepSummary,
): Promise<RankingViewModel | null> {
  const existing = await loadLatestRanking(deps.supabase, ownerId);
  if (existing && !isStale(existing)) {
    return existing;
  }

  const status = await deps.refreshRanking(ownerId);
  summary.refreshed += 1;
  if (status === "failed") {
    // Sending from a ranking whose refresh just failed means presenting a stale
    // conclusion as a current one, in a channel the user cannot argue with.
    summary.skipped.refresh_failed += 1;
    return null;
  }

  const refreshed = await loadLatestRanking(deps.supabase, ownerId);
  if (!refreshed) {
    summary.skipped.no_ranking += 1;
    return null;
  }
  return refreshed;
}

async function loadProfileName(deps: SweepDeps, ownerId: string): Promise<string | null> {
  const { data } = await deps.supabase.from("profiles").select("name").eq("owner_id", ownerId).maybeSingle();
  return data?.name ?? null;
}

/**
 * Processes one candidate end to end. Throws nothing that the caller has not
 * already accounted for: a send failure is recorded and counted here, so the
 * loop above only has to catch the genuinely unexpected.
 */
async function sweepOne(
  deps: SweepDeps,
  candidate: ReminderCandidate,
  summary: SweepSummary,
  dryRun: boolean,
): Promise<void> {
  const ranking = await ensureFreshRanking(deps, candidate.owner_id, summary);
  if (!ranking) {
    return;
  }

  const facts = await loadContactFacts(deps.supabase, candidate.owner_id);
  const selection = selectHero(ranking, facts);
  if (!selection) {
    // Silence is not a send: writing a row here would start a cooldown for an
    // email that never existed, delaying the next genuinely urgent nudge.
    summary.skipped.nothing_urgent += 1;
    return;
  }

  const profileName = await loadProfileName(deps, candidate.owner_id);
  const { subject, html } = renderReminderEmail({
    hero: selection.hero,
    queue: selection.queue,
    factors: buildReasonFactors(selection.hero, facts.get(selection.hero.person.id)),
    profileName,
    baseUrl: deps.baseUrl,
  });

  if (dryRun) {
    // Counted but not performed, so the dry run reports what a real run would
    // do. A dry run that reported nothing would tell you nothing.
    summary.sent += 1;
    console.log(`[reminders] would send to owner ${candidate.owner_id}: ${subject}`);
    return;
  }

  try {
    const messageId = await deps.sendEmail({ to: candidate.email, subject, html });
    summary.sent += 1;
    await recordSend(deps, candidate, selection.hero.person.id, ranking.id, "sent", messageId, null);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    summary.failed += 1;
    console.error(`[reminders] send failed for owner ${candidate.owner_id}: ${message}`);
    // Written on the failure path too: a send that leaves no trace is the
    // fire-and-forget the NFR forbids, and is indistinguishable from a user who
    // was never a candidate.
    await recordSend(deps, candidate, selection.hero.person.id, ranking.id, "failed", null, message);
  }
}

async function recordSend(
  deps: SweepDeps,
  candidate: ReminderCandidate,
  personId: string,
  rankingId: string,
  status: "sent" | "failed",
  messageId: string | null,
  error: string | null,
): Promise<void> {
  // The generated RPC types declare every argument non-null because Postgres
  // function parameters carry no nullability in the schema. The columns behind
  // them are nullable and the function truncates `p_error` itself, so the cast
  // is a types-generator gap, not a lie about the contract.
  await deps.supabase.rpc("record_reminder_send", {
    p_owner_id: candidate.owner_id,
    p_person_id: personId,
    p_ranking_id: rankingId,
    p_status: status,
    p_provider_message_id: messageId,
    p_error: error,
  } as never);
}

/**
 * The daily sweep: who is due, is their ranking current, is anyone urgent, send.
 *
 * Ordered cheapest-first on purpose. The candidates RPC is one round trip and
 * already applies the cooldown and the opt-out, so the expensive step -- an
 * OpenAI refresh -- only ever runs for owners who could actually receive mail
 * today. Refreshing before gating would put an AI call on every user every day.
 *
 * Failure is isolated per owner. A sweep is a loop over strangers, and one
 * owner's bad data must not cost everyone queued behind them their reminder.
 */
export async function runSweep(deps: SweepDeps, options: SweepOptions = {}): Promise<SweepSummary> {
  const summary = emptySummary();

  const { data: candidates, error } = await deps.supabase.rpc("reminder_candidates", {
    cooldown_days: REMINDER_COOLDOWN_DAYS,
    max_rows: MAX_REFRESHES_PER_RUN,
  });

  if (error) {
    throw new Error(`reminder_candidates failed: ${error.message}`);
  }

  const rows = candidates as ReminderCandidate[];
  summary.considered = rows.length;

  for (const candidate of rows) {
    try {
      await sweepOne(deps, candidate, summary, options.dryRun ?? false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      summary.failed += 1;
      console.error(`[reminders] owner ${candidate.owner_id} failed: ${message}`);
    }
  }

  return summary;
}
