// The only file in this repo that reads a Cloudflare binding. Config values come
// from astro:env/server; bindings come from cloudflare:workers -- envField cannot
// model a KV namespace, and Astro.locals.runtime.env throws in @astrojs/cloudflare v13.
import { env } from "cloudflare:workers";

// A job status is worthless an hour later, so every write carries a TTL rather
// than leaving keys to accumulate once S-02 copies this module under real traffic.
const JOB_TTL_SECONDS = 3600;

export interface AiJob {
  status: "pending" | "done" | "failed";
  result?: string;
  error?: string;
  /** Set on a "done" ranking job so the poll route can load the fresh ranking without guessing. */
  rankingId?: string;
}

export async function readJob(jobId: string): Promise<AiJob | null> {
  return await env.AI_JOBS.get<AiJob>(jobId, "json");
}

export async function writeJob(jobId: string, job: AiJob): Promise<void> {
  await env.AI_JOBS.put(jobId, JSON.stringify(job), { expirationTtl: JOB_TTL_SECONDS });
}

// S-02's per-owner in-flight guard: a pointer from an owner to their most
// recently dispatched ranking job. `POST /api/rankings` reads this, checks
// that job's own status via readJob, and only starts a new run when it is
// not still "pending" -- stopping a double page load from firing two
// concurrent OpenAI calls for the same owner. Namespaced with a prefix so
// these keys never collide with the random-UUID job-status keys above.
function rankingPointerKey(ownerId: string): string {
  return `ranking-latest:${ownerId}`;
}

export async function readLatestRankingJobId(ownerId: string): Promise<string | null> {
  return await env.AI_JOBS.get(rankingPointerKey(ownerId));
}

export async function writeLatestRankingJobId(ownerId: string, jobId: string): Promise<void> {
  await env.AI_JOBS.put(rankingPointerKey(ownerId), jobId, { expirationTtl: JOB_TTL_SECONDS });
}
