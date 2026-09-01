import { zodTextFormat } from "openai/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { createOpenAIClient } from "@/lib/openai";
import { writeJob } from "@/lib/ai-jobs";
import { buildRankingPrompt } from "@/lib/ranking/prompt";
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

/**
 * Reconciles the model's entries against the people actually sent: drops any
 * id the model hallucinated -- never sent to it -- and appends any sent
 * person the model omitted, at the tail, in the weight order `peopleSent`
 * already carries. responses.parse() only validates shape, never referential
 * integrity: without this a hallucinated id becomes a foreign-key violation
 * at insert time, and a silently dropped person disappears from the user's
 * screen with no trace.
 */
function reconcileEntries(modelEntries: RankingOutputEntry[], peopleSent: { id: string }[]): PersistRankingEntry[] {
  const sentIds = new Set(peopleSent.map((person) => person.id));
  const seen = new Set<string>();
  const reconciled: PersistRankingEntry[] = [];

  for (const entry of modelEntries) {
    if (!sentIds.has(entry.personId) || seen.has(entry.personId)) {
      continue;
    }
    seen.add(entry.personId);
    reconciled.push({
      personId: entry.personId,
      timeWindow: entry.timeWindow,
      reason: truncate(entry.reason, REASON_MAX_LENGTH),
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

  return reconciled;
}

/**
 * The background task: fetch inputs, call the model, reconcile, persist, and
 * report terminal status. Kept out of the route so the route stays a thin
 * auth-and-dispatch shell like ai-ping.ts. Every failure path is caught,
 * logged with a [ranking] prefix mirroring ai-ping.ts, and written as a
 * failed job -- nothing is written to `rankings` on failure, so the previous
 * ranking survives untouched.
 */
export async function runRanking(ownerId: string, supabase: SupabaseClient<Database>, jobId: string): Promise<void> {
  const startedAt = Date.now();
  try {
    const openai = createOpenAIClient();
    if (!openai) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const [{ data: profile }, { data: people }] = await Promise.all([
      supabase.from("profiles").select("*").eq("owner_id", ownerId).maybeSingle(),
      supabase.from("people").select("*").eq("owner_id", ownerId),
    ]);

    if (!profile) {
      throw new Error("No profile found for this account");
    }
    if (!people || people.length === 0) {
      throw new Error("No people found for this account");
    }

    const { messages, peopleIncluded } = buildRankingPrompt(profile, people);

    const response = await openai.responses.parse({
      model: RANKING_MODEL,
      input: messages,
      text: { format: zodTextFormat(rankingOutputSchema, "ranking") },
    });

    const parsed = response.output_parsed;
    if (!parsed) {
      throw new Error("OpenAI response had no parsed output");
    }

    const entries = reconcileEntries(parsed.entries, peopleIncluded);

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
    console.log(`[ranking] job ${jobId} done in ${String(Date.now() - startedAt)}ms`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ranking] job ${jobId} failed: ${message}`);
    await writeJob(jobId, { status: "failed", error: message });
  }
}
