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
}

export async function readJob(jobId: string): Promise<AiJob | null> {
  return await env.AI_JOBS.get<AiJob>(jobId, "json");
}

export async function writeJob(jobId: string, job: AiJob): Promise<void> {
  await env.AI_JOBS.put(jobId, JSON.stringify(job), { expirationTtl: JOB_TTL_SECONDS });
}
