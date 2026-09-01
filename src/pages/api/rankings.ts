import type { APIRoute } from "astro";
import { readJob, writeJob, readLatestRankingJobId, writeLatestRankingJobId } from "@/lib/ai-jobs";
import { createClient } from "@/lib/supabase";
import { loadLatestRanking, isStale } from "@/lib/ranking/store";
import { runRanking } from "@/lib/ranking/run";

// Mirrors src/pages/api/internal/ai-ping.ts's json() helper -- this is a JSON
// contract for both the browser island and machine callers, never a redirect.
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface PostBody {
  force?: boolean;
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }
  const ownerId = context.locals.user.id;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 503);
  }

  let force = false;
  try {
    const body: PostBody = await context.request.json();
    force = body.force === true;
  } catch {
    // No body, or a non-JSON body -- force stays false.
  }

  if (!force) {
    const existing = await loadLatestRanking(supabase, ownerId);
    if (existing && !isStale(existing)) {
      return json({ jobId: null, reason: "fresh" }, 200);
    }
  }

  // In-flight guard: a double page load (or the auto-trigger racing a manual
  // "Przelicz teraz") must not fire two concurrent OpenAI calls for the same
  // owner. Reuse the running job's id instead of starting another.
  const latestJobId = await readLatestRankingJobId(ownerId);
  if (latestJobId) {
    const latestJob = await readJob(latestJobId);
    if (latestJob?.status === "pending") {
      return json({ jobId: latestJobId }, 202);
    }
  }

  const jobId = crypto.randomUUID();
  await writeJob(jobId, { status: "pending" });
  await writeLatestRankingJobId(ownerId, jobId);

  const work = runRanking(ownerId, supabase, jobId);
  const cfContext = context.locals.cfContext;
  if (cfContext) {
    cfContext.waitUntil(work);
  } else {
    // Not running under the Cloudflare handler, so there is no ExecutionContext
    // to keep the Worker alive. Leave the promise unawaited -- the response
    // still returns immediately, but nothing guarantees the call finishes.
    console.warn(`[ranking] job ${jobId}: no cfContext, background completion is not guaranteed`);
    void work;
  }

  return json({ jobId }, 202);
};

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const jobId = context.url.searchParams.get("jobId");
  if (!jobId) {
    return json({ error: "Missing jobId query parameter" }, 400);
  }

  const job = await readJob(jobId);
  if (!job) {
    return json({ error: "Unknown jobId" }, 404);
  }

  if (job.status !== "done") {
    return json(job, 200);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 503);
  }

  // Scoped to the caller's own owner id regardless of whose jobId was
  // polled -- RLS is what actually protects this, same posture as ai-ping.ts
  // not verifying jobId ownership.
  const ranking = await loadLatestRanking(supabase, context.locals.user.id);
  return json({ ...job, ranking }, 200);
};
