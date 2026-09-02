// Proves the ranking call path against a DEPLOYED Worker -- not astro dev, which does
// not enforce Cloudflare's production limits (lessons.md). Follows
// scripts/verify-openai-call.ts's shape exactly: assert() + failures[], non-zero exit,
// refuses localhost, signs in through /api/auth/signin and reuses the cookie jar.
//
// Usage: npm run verify:ranking -- <preview-or-prod-url>
//   env: VERIFY_EMAIL / VERIFY_PASSWORD -- a confirmed account in the HOSTED Supabase
//        project the deployed Worker points at, with a filled profile and at least one
//        person. Never hardcoded, never committed.

// Forces module scope so this script's top-level names (failures, assert, the poll
// constants) don't collide with scripts/verify-openai-call.ts's identically-named
// globals -- neither file has a real import, so without this both are "scripts"
// merged into one global scope by TypeScript.
export {};

const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

// KV is eventually consistent -- an edge read can keep serving a cached "pending"
// for up to cacheTtl (default 60s) after the job actually finished. The budget covers
// that plus the model's own generation time, not just the OpenAI round-trip.
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2000;
// A real ranking call is seconds; a POST that beat this did not wait on it.
const NON_BLOCKING_BUDGET_MS = 3000;

const TIME_WINDOW_VALUES = ["this_week", "two_weeks", "this_month", "no_rush"];

interface RankingEntry {
  id: string;
  rankPosition: number;
  timeWindow: string;
  reason: string;
  person: { id: string; name: string };
}

interface RankingViewModel {
  id: string;
  peopleConsidered: number;
  peopleTotal: number;
  entries: RankingEntry[];
}

interface JobStatus {
  status?: "pending" | "done" | "failed";
  error?: string;
  ranking?: RankingViewModel | null;
}

interface PostResponse {
  jobId?: string | null;
  reason?: string;
}

async function main() {
  const baseUrl = process.argv[2]?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("Usage: npm run verify:ranking -- <preview-or-prod-url>");
    process.exit(1);
  }
  if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    console.error(
      `Refusing to run against a local URL: ${baseUrl}\n` +
        "This check exists to exercise Cloudflare's production limits, which astro dev does not enforce.",
    );
    process.exit(1);
  }

  const email = process.env.VERIFY_EMAIL;
  const password = process.env.VERIFY_PASSWORD;
  if (!email || !password) {
    console.error(
      "Set VERIFY_EMAIL and VERIFY_PASSWORD to a confirmed account in the hosted Supabase project, " +
        "with a filled profile and at least one person.",
    );
    process.exit(1);
  }

  console.log(`Target: ${baseUrl}\n`);

  console.log("Rejecting unauthenticated callers...");
  const anonPost = await fetch(`${baseUrl}/api/rankings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert(anonPost.status === 401, `unauthenticated POST is rejected with 401 (got ${anonPost.status})`);

  const anonGet = await fetch(`${baseUrl}/api/rankings?jobId=none`);
  assert(anonGet.status === 401, `unauthenticated GET is rejected with 401 (got ${anonGet.status})`);

  console.log("\nSigning in through /api/auth/signin...");
  const signin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: "POST",
    redirect: "manual",
    // Form-encoded is form-like to Astro's origin check, so Origin must match.
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: baseUrl },
    body: new URLSearchParams({ email, password }),
  });
  const location = signin.headers.get("location") ?? "";
  if (location.includes("error=")) {
    console.error(`  ✗ sign-in was rejected: ${decodeURIComponent(location.split("error=")[1] ?? "")}`);
    failures.push("sign-in rejected");
  }
  const setCookies = signin.headers.getSetCookie();
  assert(signin.status === 302, `sign-in returns 302 (got ${signin.status})`);
  assert(setCookies.length > 0, `sign-in returns session cookies (got ${setCookies.length})`);
  if (setCookies.length === 0) {
    throw new Error("no session cookies, aborting -- every later assertion would fail for the wrong reason");
  }
  const jar = setCookies.map((c) => c.split(";")[0]).join("; ");

  console.log("\nForcing a ranking run...");
  const startedAt = Date.now();
  const post = await fetch(`${baseUrl}/api/rankings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar },
    body: JSON.stringify({ force: true }),
  });
  const postMs = Date.now() - startedAt;
  const postBody: PostResponse = await post.json();

  assert(post.status === 202, `POST returns 202 (got ${post.status})`);
  assert(typeof postBody.jobId === "string", "POST returns a jobId");
  assert(
    postMs < NON_BLOCKING_BUDGET_MS,
    `POST returned in ${String(postMs)}ms, under the ${String(NON_BLOCKING_BUDGET_MS)}ms non-blocking budget`,
  );
  if (!postBody.jobId) {
    throw new Error("no jobId, aborting");
  }
  const jobId = postBody.jobId;

  console.log("\nPolling for the result...");
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let terminal: JobStatus | null = null;

  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/rankings?jobId=${jobId}`, { headers: { Cookie: jar } });
    const body: JobStatus = await res.json();
    const elapsed = Math.round((Date.now() - startedAt) / 100) / 10;
    console.log(`  [+${String(elapsed)}s] ${String(res.status)} status=${body.status ?? "?"}`);
    if (body.status === "done" || body.status === "failed") {
      terminal = body;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const totalMs = Date.now() - startedAt;
  assert(terminal !== null, `job reached a terminal status within ${String(POLL_TIMEOUT_MS / 1000)}s`);
  assert(terminal?.status === "done", `terminal status is "done" (got "${terminal?.status ?? "none"}")`);
  if (terminal?.status === "failed") {
    console.error(`  background error was: ${terminal.error ?? "(none)"}`);
  }

  const ranking = terminal?.ranking ?? null;
  assert(ranking !== null, "done status carries a ranking");

  if (ranking) {
    assert(
      // Only people actually sent to the model (capped at PEOPLE_CAP = 50)
      // are guaranteed an entry -- peopleConsidered, not peopleTotal.
      ranking.entries.length === ranking.peopleConsidered,
      `ranking has one entry per person considered (${String(ranking.entries.length)} entries, ` +
        `${String(ranking.peopleConsidered)} considered)`,
    );
    const allHaveValidTimeWindow = ranking.entries.every((entry) => TIME_WINDOW_VALUES.includes(entry.timeWindow));
    assert(allHaveValidTimeWindow, "every entry has a time window from the enum");
    const allHaveReason = ranking.entries.every((entry) => entry.reason.trim().length > 0);
    assert(allHaveReason, "every entry has a non-empty reason");

    console.log(
      `\n  ${String(ranking.entries.length)} entries, ${String(ranking.peopleConsidered)}/${String(ranking.peopleTotal)} people considered.`,
    );
  }

  console.log("\nConfirming a non-forced POST reports fresh...");
  const freshPost = await fetch(`${baseUrl}/api/rankings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar },
    body: JSON.stringify({}),
  });
  const freshBody: PostResponse = await freshPost.json();
  assert(freshPost.status === 200, `non-forced POST returns 200 (got ${freshPost.status})`);
  assert(freshBody.reason === "fresh", `non-forced POST reports "fresh" (got "${freshBody.reason ?? "none"}")`);

  console.log(
    `\n  POST returned in ${String(postMs)}ms; the job settled after ${String(totalMs)}ms ` +
      `(${String(Math.round((totalMs / postMs) * 10) / 10)}x longer).`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    failures.push(err instanceof Error ? err.message : String(err));
  })
  .finally(() => {
    if (failures.length > 0) {
      console.error(`\n${String(failures.length)} assertion(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll ranking call-path assertions passed.");
  });
