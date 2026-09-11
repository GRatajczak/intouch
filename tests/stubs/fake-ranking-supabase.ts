// A minimal, in-memory Supabase double for testing `runRanking` without the
// local Supabase stack. Extracted from tests/unit/ranking-key-source.test.ts
// (S-17), which established this as the cheap alternative to a real RLS
// fixture: answer only what runRanking asks -- the profile read, the people
// read, the (empty) contact-events read, and the two writes persistRanking
// issues on a successful run. Anything else throws, so a run that starts
// querying something new fails loudly here rather than silently passing.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/db/database.types";

export function profileRow(over: Partial<Tables<"profiles">> = {}): Tables<"profiles"> {
  return {
    owner_id: "owner-1",
    name: "Ola",
    birth_date: "1990-01-01",
    life_context: "Pracuje zdalnie.",
    updated_at: new Date().toISOString(),
    availability_windows: [],
    preferred_channels: [],
    reminders_enabled: true,
    weekly_time_budget: null,
    analytics_opt_out: true,
    free_recompute_claimed_on: null,
    openai_api_key_ciphertext: null,
    openai_api_key_hint: null,
    openai_api_key_failed_at: null,
    openai_api_key_failure_reason: null,
    ...over,
  };
}

export function personRow(over: Partial<Tables<"people">> = {}): Tables<"people"> {
  return {
    id: "basia",
    owner_id: "owner-1",
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
    ...over,
  };
}

/**
 * Answers only what runRanking asks: the profile read, the people read, the
 * (empty) contact-events read, and the two writes persistRanking issues on a
 * successful run. Anything else throws, so a run that starts querying
 * something new fails loudly here rather than silently passing.
 */
export function fakeSupabase(profile: Tables<"profiles">, people: Tables<"people">[]): SupabaseClient<Database> {
  const table = (name: string) => {
    const rows: Record<string, unknown>[] =
      name === "profiles"
        ? [profile]
        : name === "people"
          ? people
          : name === "contact_events"
            ? []
            : name === "rankings"
              ? [
                  {
                    id: "ranking-1",
                    owner_id: profile.owner_id,
                    model: "gpt-5.4-mini",
                    people_considered: people.length,
                    people_total: people.length,
                    created_at: new Date().toISOString(),
                  },
                ]
              : name === "ranking_entries"
                ? []
                : (() => {
                    throw new Error(`unexpected table read: ${name}`);
                  })();

    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "insert"]) {
      builder[method] = () => builder;
    }
    // Mutates rows[0] in place -- for "profiles" that is the exact `profile`
    // object the caller passed into fakeSupabase, so a test can read the
    // patch straight off its own reference afterwards (src/lib/ranking/run.ts
    // Phase 5's writeKeyHealth is the caller this exists for).
    builder.update = (patch: Record<string, unknown>) => {
      if (rows[0]) {
        Object.assign(rows[0], patch);
      }
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    builder.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    builder.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
      resolve({ data: rows, error: null });
    return builder;
  };

  return { from: (name: string) => table(name) } as unknown as SupabaseClient<Database>;
}
