import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/db/database.types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const RECENT_NOTES_PER_PERSON = 2;

export interface ContactFacts {
  lastHappenedAt: string | null;
  daysSinceLastHappened: number | null;
  lastAttemptFailed: boolean;
  failedAttemptsSinceLastHappened: number;
  recentNotes: string[];
}

/**
 * Folds one person's events -- newest first -- into the facts both the
 * prompt and the UI read. Called only with a non-empty array; an absent
 * person never reaches this function (see loadContactFacts).
 */
function foldEvents(events: Tables<"contact_events">[]): ContactFacts {
  const lastHappened = events.find((event) => event.outcome === "happened") ?? null;
  const lastHappenedAt = lastHappened?.occurred_at ?? null;
  const daysSinceLastHappened =
    lastHappenedAt === null ? null : Math.floor((Date.now() - new Date(lastHappenedAt).getTime()) / MS_PER_DAY);

  const lastAttemptFailed = events[0]?.outcome === "not_yet";

  const failedAttemptsSinceLastHappened = events.filter(
    (event) => event.outcome === "not_yet" && (lastHappenedAt === null || event.occurred_at > lastHappenedAt),
  ).length;

  const recentNotes = events
    .filter((event): event is Tables<"contact_events"> & { note: string } => !!event.note)
    .slice(0, RECENT_NOTES_PER_PERSON)
    .map((event) => event.note);

  return {
    lastHappenedAt,
    daysSinceLastHappened,
    lastAttemptFailed,
    failedAttemptsSinceLastHappened,
    recentNotes,
  };
}

/**
 * Loads every recorded event for the owner and folds it into per-person
 * facts, one query, folded in memory (see plan.md's Performance
 * Considerations). A person with no events is absent from the map, never
 * present with zeroed fields -- callers must distinguish "never contacted"
 * from "contacted zero days ago", mirroring S-02's rhythm-omission rule.
 */
export async function loadContactFacts(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<Map<string, ContactFacts>> {
  const { data: events } = await supabase
    .from("contact_events")
    .select("*")
    .eq("owner_id", ownerId)
    .order("occurred_at", { ascending: false });

  const byPerson = new Map<string, Tables<"contact_events">[]>();
  for (const event of events ?? []) {
    const existing = byPerson.get(event.person_id);
    if (existing) {
      existing.push(event);
    } else {
      byPerson.set(event.person_id, [event]);
    }
  }

  const facts = new Map<string, ContactFacts>();
  for (const [personId, personEvents] of byPerson) {
    facts.set(personId, foldEvents(personEvents));
  }

  return facts;
}

/**
 * Same fold as loadContactFacts, scoped to one person -- the shape every
 * contact-events mutation endpoint returns so its caller can refresh that
 * person's chips without a second round-trip. `null` when the person has no
 * recorded events (e.g. their only event was just deleted).
 */
export async function loadPersonContactFacts(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  personId: string,
): Promise<ContactFacts | null> {
  const { data: events } = await supabase
    .from("contact_events")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("person_id", personId)
    .order("occurred_at", { ascending: false });

  if (!events || events.length === 0) {
    return null;
  }

  return foldEvents(events);
}
