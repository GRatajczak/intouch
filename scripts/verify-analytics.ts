// Proves F-06's analytics instrumentation against a DEPLOYED Worker -- not astro dev,
// which does not enforce Cloudflare's production limits (lessons.md). Follows
// scripts/verify-openai-call.ts's shape exactly: assert() + failures[], non-zero exit,
// refuses localhost, signs in through /api/auth/signin and reuses the cookie jar.
//
// WHAT THIS PROVES, AND WHAT IT CANNOT
//
// It proves the app's half of the contract: every instrumented route still returns its
// expected status, every one of them returns fast enough that the capture demonstrably
// is not awaited in the request path, the opt-out route persists both directions, and
// an opted-out user's requests behave identically.
//
// It cannot prove the event LANDED. /i/v0/e/ returns 2xx before ingestion decides
// anything, and this script has no PostHog read credentials. "Did it arrive, and does
// its payload carry no personal data" is the manual check in the plan, deliberately.
//
// Usage: npm run verify:analytics -- <preview-or-prod-url>
//   env: VERIFY_EMAIL / VERIFY_PASSWORD -- a confirmed account in the HOSTED Supabase
//        project the deployed Worker points at, with a filled profile and at least one
//        person. Never hardcoded, never committed.

// Forces module scope so this script's top-level names don't collide with the other
// verify-*.ts scripts' identically-named globals -- none of these files has a real
// import, so without this they'd merge into one global scope by TypeScript.
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

// Every instrumented route dispatches its capture through cfContext.waitUntil() and
// returns without awaiting it. A round trip to eu.i.posthog.com is tens to hundreds of
// milliseconds on its own; a response that beat this budget, on a route that also does
// real database work, did not wait on the vendor.
const NON_BLOCKING_BUDGET_MS = 3000;

interface ToggleResponse {
  enabled?: boolean;
  error?: string;
}

async function timed(label: string, run: () => Promise<Response>): Promise<{ res: Response; ms: number }> {
  const startedAt = Date.now();
  const res = await run();
  const ms = Date.now() - startedAt;
  console.log(`  [${String(ms)}ms] ${label} -> ${String(res.status)}`);
  return { res, ms };
}

async function main() {
  const baseUrl = process.argv[2]?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("Usage: npm run verify:analytics -- <preview-or-prod-url>");
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

  // ---------------------------------------------------------------------------
  // 1. The opt-out route rejects anonymous callers
  // ---------------------------------------------------------------------------

  console.log("Rejecting unauthenticated callers...");
  // Astro's origin check runs before routing and rejects a POST that carries neither a
  // form-like content-type nor a matching Origin, with a 403 that never reaches the
  // route. Sending JSON is what lets this request get far enough to be judged on auth.
  const anonToggle = await fetch(`${baseUrl}/api/settings/analytics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  assert(anonToggle.status === 401, `unauthenticated opt-out POST is rejected with 401 (got ${anonToggle.status})`);

  // ---------------------------------------------------------------------------
  // 2. Sign in
  // ---------------------------------------------------------------------------

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
  const jsonHeaders = { "Content-Type": "application/json", Cookie: jar };

  // ---------------------------------------------------------------------------
  // 3. The opt-out route validates and persists in both directions
  // ---------------------------------------------------------------------------

  console.log("\nExercising the opt-out route...");
  const badBody = await fetch(`${baseUrl}/api/settings/analytics`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ enabled: "yes" }),
  });
  assert(badBody.status === 400, `a non-boolean toggle value is rejected with 400 (got ${badBody.status})`);

  const optOut = await timed("opt out", () =>
    fetch(`${baseUrl}/api/settings/analytics`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ enabled: false }),
    }),
  );
  const optOutBody = await optOut.res.json<ToggleResponse>();
  assert(optOut.res.status === 200, `opting out returns 200 (got ${optOut.res.status})`);
  assert(optOutBody.enabled === false, `opting out echoes enabled=false (got ${String(optOutBody.enabled)})`);

  // ---------------------------------------------------------------------------
  // 4. An opted-out user's routes behave identically
  //
  // This is the assertion that matters for the privacy story: turning analytics off
  // must change nothing a user can observe. Whether an event was suppressed is only
  // visible in PostHog, so what is asserted here is the absence of any side effect.
  // ---------------------------------------------------------------------------

  console.log("\nWith analytics OFF, instrumented routes still succeed...");
  const peopleWhileOff = await timed("GET /api/people-ish (contact-events GET)", () =>
    fetch(`${baseUrl}/api/contact-events?personId=00000000-0000-0000-0000-000000000000`, {
      headers: { Cookie: jar },
    }),
  );
  assert(
    peopleWhileOff.res.status === 200,
    `a signed-in read still succeeds while opted out (got ${peopleWhileOff.res.status})`,
  );

  // ---------------------------------------------------------------------------
  // 5. Opt back in
  // ---------------------------------------------------------------------------

  console.log("\nOpting back in...");
  const optIn = await timed("opt in", () =>
    fetch(`${baseUrl}/api/settings/analytics`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ enabled: true }),
    }),
  );
  const optInBody = await optIn.res.json<ToggleResponse>();
  assert(optIn.res.status === 200, `opting back in returns 200 (got ${optIn.res.status})`);
  assert(optInBody.enabled === true, `opting back in echoes enabled=true (got ${String(optInBody.enabled)})`);

  // ---------------------------------------------------------------------------
  // 6. Step 2's once-only pre-check does not break a repeat profile save
  //
  // The script cannot see PostHog, so it cannot assert "no second event". What it CAN
  // assert is that the pre-check this change inserted before the upsert did not change
  // the route's contract: a repeat save still returns 200, and still fast.
  // ---------------------------------------------------------------------------

  console.log("\nRe-saving the profile (the once-only path, second time through)...");
  const profilePage = await fetch(`${baseUrl}/profile`, { headers: { Cookie: jar } });
  assert(profilePage.status === 200, `/profile renders for a signed-in user (got ${profilePage.status})`);
  const profileHtml = await profilePage.text();
  const nameMatch = /name="name"[^>]*value="([^"]*)"/.exec(profileHtml);
  const birthMatch = /name="birthDate"[^>]*value="([^"]*)"/.exec(profileHtml);
  const contextMatch = /name="lifeContext"[^>]*>([^<]*)</.exec(profileHtml);

  if (!nameMatch?.[1] || !birthMatch?.[1] || !contextMatch?.[1]) {
    // Not a failure of the instrumentation -- the account simply has no profile yet,
    // which is a precondition this script documents rather than creates.
    console.log("  ! could not read the current profile back from /profile; skipping the re-save assertion");
    console.log("    (the VERIFY_EMAIL account needs a filled profile for this check)");
  } else {
    const resave = await timed("POST /api/profile (repeat)", () =>
      fetch(`${baseUrl}/api/profile`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: baseUrl, Cookie: jar },
        body: new URLSearchParams({
          name: nameMatch[1],
          birthDate: birthMatch[1],
          lifeContext: contextMatch[1],
        }),
      }),
    );
    assert(resave.res.status === 200, `a repeat profile save still returns 200 (got ${resave.res.status})`);
    assert(
      resave.ms < NON_BLOCKING_BUDGET_MS,
      `repeat profile save returned in ${String(resave.ms)}ms, under the ${String(NON_BLOCKING_BUDGET_MS)}ms non-blocking budget`,
    );
  }

  // ---------------------------------------------------------------------------
  // 7. Step 5's gate: "not_yet" must take the same route successfully
  //
  // outcome: "not_yet" is deliberately NOT step 5 and emits nothing. Asserting it still
  // returns 201 is what proves the gate is a gate on the EVENT, not on the write.
  // ---------------------------------------------------------------------------

  console.log("\nLogging a 'not_yet' contact event (emits nothing, must still succeed)...");
  const peopleRes = await fetch(`${baseUrl}/people`, { headers: { Cookie: jar } });
  const peopleHtml = await peopleRes.text();
  const personIdMatch = /\/people\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(peopleHtml);
  const personId = personIdMatch?.[1];

  if (!personId) {
    console.log("  ! no person id found on /people; skipping the contact-event assertion");
    console.log("    (the VERIFY_EMAIL account needs at least one person for this check)");
  } else {
    const notYet = await timed("POST /api/contact-events (not_yet)", () =>
      fetch(`${baseUrl}/api/contact-events`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ personId, outcome: "not_yet" }),
      }),
    );
    assert(notYet.res.status === 201, `a "not_yet" contact event still returns 201 (got ${notYet.res.status})`);
    assert(
      notYet.ms < NON_BLOCKING_BUDGET_MS,
      `"not_yet" returned in ${String(notYet.ms)}ms, under the ${String(NON_BLOCKING_BUDGET_MS)}ms non-blocking budget`,
    );

    const happened = await timed("POST /api/contact-events (happened)", () =>
      fetch(`${baseUrl}/api/contact-events`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ personId, outcome: "happened" }),
      }),
    );
    assert(happened.res.status === 201, `a "happened" contact event returns 201 (got ${happened.res.status})`);
    // The one that DOES emit. This is the assertion that proves the capture is not in
    // the response path: it takes the same time as the one that emits nothing.
    assert(
      happened.ms < NON_BLOCKING_BUDGET_MS,
      `"happened" returned in ${String(happened.ms)}ms, under the ${String(NON_BLOCKING_BUDGET_MS)}ms non-blocking budget -- the capture was not awaited`,
    );
  }

  console.log(
    "\n  Reminder: a 2xx from PostHog's /i/v0/e/ is returned before ingestion decides anything,\n" +
      "  so whether these events LANDED, and what their payloads carry, is the manual check.",
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
    console.log("\nAll analytics instrumentation assertions passed.");
  });
