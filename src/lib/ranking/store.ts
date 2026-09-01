import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/db/database.types";
import type { TimeWindow } from "@/lib/validation/ranking";

// A ranking is worth nothing to look at once it's this old -- dashboard.astro
// uses this to decide whether to trigger a background refresh on mount.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface RankingEntryViewModel {
  id: string;
  rankPosition: number;
  timeWindow: TimeWindow;
  reason: string;
  contextNote: string | null;
  rhythmNote: string | null;
  person: Tables<"people">;
}

export interface RankingViewModel {
  id: string;
  createdAt: string;
  model: string;
  peopleConsidered: number;
  peopleTotal: number;
  entries: RankingEntryViewModel[];
}

export interface PersistRankingEntry {
  personId: string;
  timeWindow: TimeWindow;
  reason: string;
  contextNote: string | null;
  rhythmNote: string | null;
}

export interface PersistRankingParams {
  ownerId: string;
  model: string;
  peopleConsidered: number;
  peopleTotal: number;
  entries: PersistRankingEntry[];
}

/**
 * Loads the owner's most recent ranking as a view model, entries joined to
 * their people and ordered by rank_position. `null` when the owner has no
 * ranking yet -- the single place `dashboard.astro` and the poll route
 * (`GET /api/rankings`) both read from, so they never assemble the view
 * model differently.
 */
export async function loadLatestRanking(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<RankingViewModel | null> {
  const { data: ranking } = await supabase
    .from("rankings")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!ranking) {
    return null;
  }

  const { data: entries } = await supabase
    .from("ranking_entries")
    .select("*, person:people(*)")
    .eq("ranking_id", ranking.id)
    .order("rank_position", { ascending: true });

  return {
    id: ranking.id,
    createdAt: ranking.created_at,
    model: ranking.model,
    peopleConsidered: ranking.people_considered,
    peopleTotal: ranking.people_total,
    entries: (entries ?? []).map((entry) => ({
      id: entry.id,
      rankPosition: entry.rank_position,
      timeWindow: entry.time_window as TimeWindow,
      reason: entry.reason,
      contextNote: entry.context_note,
      rhythmNote: entry.rhythm_note,
      person: entry.person,
    })),
  };
}

/** Whether a ranking is old enough to refresh on view, or absent entirely. */
export function isStale(ranking: RankingViewModel | null): boolean {
  if (!ranking) {
    return true;
  }
  return Date.now() - new Date(ranking.createdAt).getTime() > STALE_AFTER_MS;
}

/**
 * Inserts the rankings row, then its ranking_entries rows, in that order --
 * a failed entries insert leaves an orphaned rankings row rather than
 * entries with no parent, and the caller (run.ts) only calls this after the
 * model's output has already been reconciled against the people actually sent.
 */
export async function persistRanking(
  supabase: SupabaseClient<Database>,
  params: PersistRankingParams,
): Promise<string> {
  const { data: ranking, error: rankingError } = await supabase
    .from("rankings")
    .insert({
      owner_id: params.ownerId,
      model: params.model,
      people_considered: params.peopleConsidered,
      people_total: params.peopleTotal,
    })
    .select()
    .single();

  if (rankingError) {
    throw new Error(`Failed to insert ranking: ${rankingError.message}`);
  }

  const entryRows: TablesInsert<"ranking_entries">[] = params.entries.map((entry, index) => ({
    ranking_id: ranking.id,
    owner_id: params.ownerId,
    person_id: entry.personId,
    rank_position: index + 1,
    time_window: entry.timeWindow,
    reason: entry.reason,
    context_note: entry.contextNote,
    rhythm_note: entry.rhythmNote,
  }));

  const { error: entriesError } = await supabase.from("ranking_entries").insert(entryRows);
  if (entriesError) {
    throw new Error(`Failed to insert ranking entries: ${entriesError.message}`);
  }

  return ranking.id;
}
