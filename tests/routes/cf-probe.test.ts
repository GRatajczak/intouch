// TEMPORARY probe -- Phase 1 only, deleted before Phase 2.
// Decides where /api/rankings and /api/internal/ai-ping get covered. Both reach
// `cloudflare:workers` through src/lib/ai-jobs.ts, and @astrojs/cloudflare injects
// an `enforce: "pre"` plugin that marks every `cloudflare:*` specifier external.
// If the two route modules load under the stub alias, they belong to the route
// layer; if not, they move to the HTTP layer and Phase 3 records the exclusion.
import { describe, expect, it } from "vitest";

describe("probe B: cloudflare:workers under Vitest", () => {
  it("loads src/lib/ai-jobs.ts, which imports cloudflare:workers at module top level", async () => {
    const mod = await import("@/lib/ai-jobs");
    expect(typeof mod.readJob).toBe("function");
  });

  it("routes the binding through the in-memory stub rather than a real KV namespace", async () => {
    const { readJob, writeJob } = await import("@/lib/ai-jobs");
    await writeJob("probe-job", { status: "pending" });
    expect(await readJob("probe-job")).toEqual({ status: "pending" });
    expect(await readJob("no-such-job")).toBeNull();
  });

  it("loads the two route modules whose graph reaches the binding", async () => {
    const rankings = await import("@/pages/api/rankings");
    const aiPing = await import("@/pages/api/internal/ai-ping");
    expect(typeof rankings.POST).toBe("function");
    expect(typeof aiPing.POST).toBe("function");
  });
});
