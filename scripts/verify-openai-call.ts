// Proves the non-blocking OpenAI call path against a DEPLOYED Worker -- not astro dev,
// which does not enforce Cloudflare's production limits and keeps a floating promise
// alive whether or not ctx.waitUntil was used. Only production can tell those apart.
//
// Usage: npm run verify:ai-call -- <preview-or-prod-url>
//   env: VERIFY_EMAIL / VERIFY_PASSWORD -- a confirmed account in the HOSTED Supabase
//        project the deployed Worker points at. Never hardcoded, never committed.

const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

// The background write and this poller usually share a colo, so the status is normally
// visible within seconds. But KV is eventually consistent: an edge read is cached for
// cacheTtl (default 60s), so a poll that catches "pending" can keep serving it for up
// to a minute after the job finished. The budget covers that, not the OpenAI call.
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2000;
// A real chat.completions round-trip is seconds; a POST that beat this did not wait on it.
const NON_BLOCKING_BUDGET_MS = 3000;

interface JobStatus {
  status?: "pending" | "done" | "failed";
  result?: string;
  error?: string;
}

async function main() {
  const baseUrl = process.argv[2]?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("Usage: npm run verify:ai-call -- <preview-or-prod-url>");
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
    console.error("Set VERIFY_EMAIL and VERIFY_PASSWORD to a confirmed account in the hosted Supabase project.");
    process.exit(1);
  }

  console.log(`Target: ${baseUrl}\n`);

  console.log("Rejecting unauthenticated callers...");
  // Astro's origin check runs before routing and rejects a POST that carries neither a
  // form-like content-type nor a matching Origin, with a 403 that never reaches the
  // route. Sending JSON is what lets this request get far enough to be judged on auth.
  const anonPost = await fetch(`${baseUrl}/api/internal/ai-ping`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  assert(anonPost.status === 401, `unauthenticated POST is rejected with 401 (got ${anonPost.status})`);

  const anonGet = await fetch(`${baseUrl}/api/internal/ai-ping?jobId=none`);
  assert(anonGet.status === 401, `unauthenticated GET is rejected with 401 (got ${anonGet.status})`);

  console.log("\nSigning in through /api/auth/signin...");
  // Let the app mint the @supabase/ssr cookies rather than hand-crafting their chunked
  // sb-<ref>-auth-token.0/.1 format, which is an internal detail that shifts between
  // versions. redirect: "manual" keeps the 302's headers from being consumed by a follow.
  const signin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: "POST",
    redirect: "manual",
    // Form-encoded is form-like to the origin check, so Origin must match.
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

  console.log("\nStarting a background OpenAI call...");
  const startedAt = Date.now();
  const post = await fetch(`${baseUrl}/api/internal/ai-ping`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar },
  });
  const postMs = Date.now() - startedAt;
  const postBody = await post.json<{ jobId?: string }>();

  assert(post.status === 202, `POST returns 202 (got ${post.status})`);
  assert(typeof postBody.jobId === "string", "POST returns a jobId");
  assert(
    postMs < NON_BLOCKING_BUDGET_MS,
    `POST returned in ${String(postMs)}ms, under the ${String(NON_BLOCKING_BUDGET_MS)}ms non-blocking budget`,
  );
  if (!postBody.jobId) {
    throw new Error("no jobId, aborting");
  }

  console.log("\nPolling for the result...");
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let firstPoll: JobStatus | null = null;
  let terminal: JobStatus | null = null;

  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/internal/ai-ping?jobId=${postBody.jobId}`, {
      headers: { Cookie: jar },
    });
    const body = await res.json<JobStatus>();
    firstPoll ??= body;
    const elapsed = Math.round((Date.now() - startedAt) / 100) / 10;
    console.log(`  [+${String(elapsed)}s] ${String(res.status)} ${JSON.stringify(body)}`);
    if (body.status === "done" || body.status === "failed") {
      terminal = body;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const totalMs = Date.now() - startedAt;
  assert(terminal !== null, `job reached a terminal status within ${String(POLL_TIMEOUT_MS / 1000)}s`);
  assert(terminal?.status === "done", `terminal status is "done" (got "${terminal?.status ?? "none"}")`);
  assert(!!terminal?.result, "done status carries a non-empty result string");
  if (terminal?.status === "failed") {
    console.error(`  background error was: ${terminal.error ?? "(none)"}`);
  }

  // The point of the whole foundation: the response was decoupled from the work.
  // Whether the first poll still saw "pending" is reported, not asserted -- a fast
  // model plus a slow poller could legitimately miss the pending window.
  console.log(
    `\n  POST returned in ${String(postMs)}ms; the job settled after ${String(totalMs)}ms ` +
      `(${String(Math.round((totalMs / postMs) * 10) / 10)}x longer).`,
  );
  console.log(`  First poll saw: ${firstPoll?.status ?? "nothing"}`);
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
    console.log("\nAll OpenAI call-path assertions passed.");
  });
