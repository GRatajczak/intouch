// test-plan Phase 4: loadRankingPeople must never load more rows than the
// ranking will ever use, and the rows it loads must be the same top-N-by-weight
// set buildRankingPrompt would itself select from the full list -- an
// unordered .limit() would silently rank an arbitrary subset instead (see
// plan.md's "Critical Implementation Details"). A purpose-built fake records
// the query-builder call sequence so the query SHAPE is the thing proven,
// without a live database.
import { describe, expect, it } from "vitest";
import { loadRankingPeople } from "@/lib/ranking/run";
import { PEOPLE_CAP } from "@/lib/ranking/prompt";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

type Call = [method: string, ...args: unknown[]];

function recordingClient(): { client: SupabaseClient<Database>; calls: Call[] } {
  const calls: Call[] = [];

  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null });

  const client = { from: () => builder } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe("loadRankingPeople query shape", () => {
  it("filters by owner and active status, orders by weight descending, and caps at PEOPLE_CAP", async () => {
    const { client, calls } = recordingClient();

    await loadRankingPeople(client, "owner-1");

    expect(calls).toEqual([
      ["select", "*"],
      ["eq", "owner_id", "owner-1"],
      ["eq", "status", "active"],
      ["order", "weight", { ascending: false }],
      ["limit", PEOPLE_CAP],
    ]);
  });
});
