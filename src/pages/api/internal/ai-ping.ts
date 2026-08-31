import type { APIRoute } from "astro";
import { readJob, writeJob } from "@/lib/ai-jobs";
import { createOpenAIClient } from "@/lib/openai";

// F-02 exists to prove the call path, not to rank anything -- the prompt is
// deliberately trivial and the model deliberately cheap. S-02 owns both choices.
const MODEL = "gpt-4o-mini";
const PROMPT = "Reply with the single word: pong.";

// Unlike the form-post routes, which redirect to /auth/signin because a browser
// form submission has somewhere to be redirected to, /api/internal/* is a JSON
// contract for machine callers: 202/200/401/404, never a redirect.
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function runPing(jobId: string) {
  try {
    const openai = createOpenAIClient();
    if (!openai) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: PROMPT }],
    });
    const result = completion.choices[0]?.message.content ?? "";
    await writeJob(jobId, { status: "done", result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ai-ping] job ${jobId} failed: ${message}`);
    await writeJob(jobId, { status: "failed", error: message });
  }
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const jobId = crypto.randomUUID();
  await writeJob(jobId, { status: "pending" });

  const work = runPing(jobId);
  const cfContext = context.locals.cfContext;
  if (cfContext) {
    cfContext.waitUntil(work);
  } else {
    // Not running under the Cloudflare handler, so there is no ExecutionContext to
    // keep the Worker alive. Leave the promise unawaited -- the response still
    // returns immediately, but nothing guarantees the call finishes.
    console.warn(`[ai-ping] job ${jobId}: no cfContext, background completion is not guaranteed`);
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

  return json(job, 200);
};
