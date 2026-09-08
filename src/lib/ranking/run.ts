import { zodTextFormat } from "openai/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { createOpenAIClient } from "@/lib/openai";
import { writeJob } from "@/lib/ai-jobs";
import { loadContactFacts, type ContactFacts } from "@/lib/contact-history/facts";
import { buildRankingPrompt } from "@/lib/ranking/prompt";
import { applyRecencyFloor, sortByUrgency } from "@/lib/ranking/recency-floor";
import { persistRanking, type PersistRankingEntry } from "@/lib/ranking/store";
import { rankingOutputSchema, type RankingOutputEntry, type TimeWindow } from "@/lib/validation/ranking";

// F-02's gpt-4o-mini was a throwaway ping choice it explicitly deferred to
// this slice. Named constant so the model is visible at a glance and never
// duplicated as a string literal elsewhere.
export const RANKING_MODEL = "gpt-5.4-mini";

const REASON_MAX_LENGTH = 400;
const CONTEXT_NOTE_MAX_LENGTH = 60;
const RHYTHM_NOTE_MAX_LENGTH = 60;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function truncateNullable(value: string | null, maxLength: number): string | null {
  return value === null ? null : truncate(value, maxLength);
}

export interface ReconcileResult {
  entries: PersistRankingEntry[];
  /** How many entries the recency floor overrode -- reported in the completion log. */
  flooredCount: number;
}

/**
 * Reconciles the model's entries against the people actually sent: drops any
 * id the model hallucinated -- never sent to it -- and appends any sent
 * person the model omitted, at the tail, in the weight order `peopleSent`
 * already carries. responses.parse() only validates shape, never referential
 * integrity: without this a hallucinated id becomes a foreign-key violation
 * at insert time, and a silently dropped person disappears from the user's
 * screen with no trace.
 *
 * It also enforces the recency floor (see recency-floor.ts) and returns the
 * entries ordered by urgency, so `rank_position` -- assigned by persistRanking
 * as the array index + 1 -- cannot contradict the window driving the card's
 * colour. Entries appended for people the model skipped are already `no_rush`,
 * the calmest window, so the floor never touches them and the stable sort
 * leaves them at the tail.
 */
function reconcileEntries(
  modelEntries: RankingOutputEntry[],
  peopleSent: { id: string }[],
  facts: Map<string, ContactFacts>,
): ReconcileResult {
  const sentIds = new Set(peopleSent.map((person) => person.id));
  const seen = new Set<string>();
  const reconciled: PersistRankingEntry[] = [];
  let flooredCount = 0;

  for (const entry of modelEntries) {
    if (!sentIds.has(entry.personId) || seen.has(entry.personId)) {
      continue;
    }
    seen.add(entry.personId);
    const floored = applyRecencyFloor(entry.timeWindow, facts.get(entry.personId));
    if (floored.applied) {
      flooredCount += 1;
    }
    reconciled.push({
      personId: entry.personId,
      timeWindow: floored.timeWindow,
      reason: truncate(floored.reason ?? entry.reason, REASON_MAX_LENGTH),
      contextNote: truncateNullable(entry.contextNote, CONTEXT_NOTE_MAX_LENGTH),
      rhythmNote: truncateNullable(entry.rhythmNote, RHYTHM_NOTE_MAX_LENGTH),
    });
  }

  const fallbackTimeWindow: TimeWindow = "no_rush";
  for (const person of peopleSent) {
    if (!seen.has(person.id)) {
      reconciled.push({
        personId: person.id,
        timeWindow: fallbackTimeWindow,
        reason: "Nie udało się wygenerować uzasadnienia dla tej osoby w tym przebiegu.",
        contextNote: null,
        rhythmNote: null,
      });
    }
  }

  return { entries: sortByUrgency(reconciled), flooredCount };
}

/**
 * The background task: fetch inputs, call the model, reconcile, persist, and
 * report terminal status. Kept out of the route so the route stays a thin
 * auth-and-dispatch shell like ai-ping.ts. Every failure path is caught,
 * logged with a [ranking] prefix mirroring ai-ping.ts, and written as a
 * failed job -- nothing is written to `rankings` on failure, so the previous
 * ranking survives untouched.
 */
/**
 * Returns its terminal status -- the same value it writes to the KV job.
 *
 * S-04's sweep needs this: it must not send an email built from a ranking
 * whose refresh just failed, and the failure is otherwise invisible here
 * because every path is caught and reported as a job status rather than
 * thrown. Purely additive -- POST /api/rankings ignores the return value.
 */
export async function runRanking(
  ownerId: string,
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<"done" | "failed"> {
  const startedAt = Date.now();
  try {
    const openai = createOpenAIClient();
    if (!openai) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const [{ data: profile }, { data: people }, facts] = await Promise.all([
      supabase.from("profiles").select("*").eq("owner_id", ownerId).maybeSingle(),
      supabase.from("people").select("*").eq("owner_id", ownerId).eq("status", "active"),
      // Never throws on its own -- a query failure folds to an empty map via
      // the same `data ?? []` fallback loadContactFacts already applies, so
      // a facts-load problem degrades to today's history-blind prompt rather
      // than failing the whole ranking.
      loadContactFacts(supabase, ownerId),
    ]);

    if (!profile) {
      throw new Error("No profile found for this account");
    }
    if (!people || people.length === 0) {
      throw new Error("No people found for this account");
    }

    const { messages, peopleIncluded } = buildRankingPrompt(profile, people, facts);

    const response = await openai.responses.parse({
      model: RANKING_MODEL,
      input: messages,
      text: { format: zodTextFormat(rankingOutputSchema, "ranking") },
    });

    const parsed = response.output_parsed;
    if (!parsed) {
      throw new Error("OpenAI response had no parsed output");
    }

    const { entries, flooredCount } = reconcileEntries(parsed.entries, peopleIncluded, facts);

    const rankingId = await persistRanking(supabase, {
      ownerId,
      model: RANKING_MODEL,
      peopleConsidered: peopleIncluded.length,
      peopleTotal: people.length,
      entries,
    });

    await writeJob(jobId, { status: "done", rankingId });
    // Without this the happy path is invisible in `wrangler tail` -- mirrors
    // ai-ping.ts's own completion log.
    console.log(
      `[ranking] job ${jobId} done in ${String(Date.now() - startedAt)}ms, recency floor applied to ${String(flooredCount)} entries`,
    );
    return "done";
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ranking] job ${jobId} failed: ${message}`);
    await writeJob(jobId, { status: "failed", error: message });
    return "failed";
  }
}
