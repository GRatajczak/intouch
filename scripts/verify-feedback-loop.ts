// Proves the did-it-happen feedback loop end to end against a DEPLOYED Worker --
// not astro dev, which does not enforce Cloudflare's production limits (lessons.md).
// Follows scripts/verify-ranking.ts's shape exactly: assert() + failures[], non-zero
// exit, refuses localhost, signs in through /api/auth/signin and reuses the cookie jar.
//
// Usage: npm run verify:feedback-loop -- <preview-or-prod-url>
//   env: VERIFY_EMAIL / VERIFY_PASSWORD -- a confirmed account in the HOSTED Supabase
//        project the deployed Worker points at, with a filled profile and at least one
//        person (account A).
//        VERIFY_EMAIL_2 / VERIFY_PASSWORD_2 -- a second confirmed account (account B),
//        used only to prove cross-account isolation. Never hardcoded, never committed.

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

const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2000;

interface ContactFactsShape {
  lastHappenedAt: string | null;
  daysSinceLastHappened: number | null;
  lastAttemptFailed: boolean;
  failedAttemptsSinceLastHappened: number;
  recentNotes: string[];
}

interface ContactEventShape {
  id: string;
  person_id: string;
  outcome: string;
  note: string | null;
}

interface RankingEntry {
  id: string;
  reason: string;
  person: { id: string; name: string };
}

interface RankingViewModel {
  entries: RankingEntry[];
}

interface JobStatus {
  status?: "pending" | "done" | "failed";
  ranking?: RankingViewModel | null;
}

async function signIn(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/signin`, {
    method: "POST",
    redirect: "manual",
    // Form-encoded is form-like to Astro's origin check, so Origin must match.
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: baseUrl },
    body: new URLSearchParams({ email, password }),
  });
  const setCookies = res.headers.getSetCookie();
  if (res.status !== 302 || setCookies.length === 0) {
    const location = res.headers.get("location") ?? "(no location header)";
    throw new Error(`sign-in failed for ${email} (status ${String(res.status)}, redirect: ${location})`);
  }
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

async function forceRanking(baseUrl: string, jar: string): Promise<RankingViewModel> {
  const post = await fetch(`${baseUrl}/api/rankings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar },
    body: JSON.stringify({ force: true }),
  });
  const postBody: { jobId?: string | null } = await post.json();
  if (!postBody.jobId) {
    throw new Error("force recompute returned no jobId");
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/rankings?jobId=${postBody.jobId}`, { headers: { Cookie: jar } });
    const body: JobStatus = await res.json();
    if (body.status === "done" && body.ranking) {
      return body.ranking;
    }
    if (body.status === "failed") {
      throw new Error("ranking job failed");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`ranking job did not complete within ${String(POLL_TIMEOUT_MS / 1000)}s`);
}

async function main() {
  const baseUrl = process.argv[2]?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("Usage: npm run verify:feedback-loop -- <preview-or-prod-url>");
    process.exit(1);
  }
  if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    console.error(
      `Refusing to run against a local URL: ${baseUrl}\n` +
        "This check exists to exercise Cloudflare's production limits, which astro dev does not enforce.",
    );
    process.exit(1);
  }

  const emailA = process.env.VERIFY_EMAIL;
  const passwordA = process.env.VERIFY_PASSWORD;
  const emailB = process.env.VERIFY_EMAIL_2;
  const passwordB = process.env.VERIFY_PASSWORD_2;
  if (!emailA || !passwordA || !emailB || !passwordB) {
    console.error(
      "Set VERIFY_EMAIL / VERIFY_PASSWORD (account A, with a filled profile and at least one person) " +
        "and VERIFY_EMAIL_2 / VERIFY_PASSWORD_2 (account B, any confirmed account) in the hosted Supabase project.",
    );
    process.exit(1);
  }

  console.log(`Target: ${baseUrl}\n`);

  console.log("Signing in as account A...");
  const jarA = await signIn(baseUrl, emailA, passwordA);
  assert(jarA.length > 0, "account A sign-in returns session cookies");

  console.log("\nFinding a person to mark (via a forced ranking)...");
  const initialRanking = await forceRanking(baseUrl, jarA);
  assert(initialRanking.entries.length > 0, "account A has at least one ranking entry to mark");
  if (initialRanking.entries.length === 0) {
    throw new Error("no ranking entry to mark, aborting");
  }
  const targetEntry = initialRanking.entries[0];
  const personId = targetEntry.person.id;
  console.log(`  target: ${targetEntry.person.name} (${personId})`);

  console.log("\nMarking a contact event as A...");
  const markNote = `verify-feedback-loop ${new Date().toISOString()}`;
  const markPost = await fetch(`${baseUrl}/api/contact-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jarA },
    body: JSON.stringify({ personId, outcome: "happened", note: markNote, rankingEntryId: targetEntry.id }),
  });
  const markBody: { event?: ContactEventShape; facts?: ContactFactsShape } = await markPost.json();
  assert(markPost.status === 201, `mark returns 201 (got ${String(markPost.status)})`);
  assert(!!markBody.event, "mark response carries the created event");
  const eventId = markBody.event?.id;
  if (!eventId) {
    throw new Error("no event id from mark, aborting");
  }
  assert(
    markBody.facts?.lastHappenedAt !== undefined && markBody.facts.lastHappenedAt !== null,
    "mark returns facts with lastHappenedAt set",
  );

  console.log("\nReading the mark back as A...");
  const readBack = await fetch(`${baseUrl}/api/contact-events?personId=${personId}`, { headers: { Cookie: jarA } });
  const readBackBody: { events?: ContactEventShape[] } = await readBack.json();
  assert(
    !!readBackBody.events?.some((e) => e.id === eventId),
    "the created event is readable via GET /api/contact-events",
  );

  console.log("\nSigning in as account B...");
  const jarB = await signIn(baseUrl, emailB, passwordB);
  assert(jarB.length > 0, "account B sign-in returns session cookies");

  console.log("\nConfirming account B cannot read or mutate account A's event...");
  const crossRead = await fetch(`${baseUrl}/api/contact-events?personId=${personId}`, { headers: { Cookie: jarB } });
  const crossReadBody: { events?: ContactEventShape[] } = await crossRead.json();
  assert((crossReadBody.events?.length ?? 0) === 0, "account B's GET for A's personId returns no events");

  const crossPatch = await fetch(`${baseUrl}/api/contact-events/${eventId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: jarB },
    body: JSON.stringify({ note: "should not apply" }),
  });
  assert(crossPatch.status === 404, `account B's PATCH on A's event returns 404 (got ${String(crossPatch.status)})`);

  const crossDelete = await fetch(`${baseUrl}/api/contact-events/${eventId}`, {
    method: "DELETE",
    // DELETE is an unsafe method -- Astro's origin-check middleware rejects
    // it with a 403 form-submission error before routing unless this header
    // (or a matching Origin) is present (lessons.md).
    headers: { "Content-Type": "application/json", Cookie: jarB },
  });
  assert(crossDelete.status === 404, `account B's DELETE on A's event returns 404 (got ${String(crossDelete.status)})`);

  console.log("\nForcing a recompute so the mark reaches the prompt...");
  const recomputed = await forceRanking(baseUrl, jarA);
  const recomputedEntry = recomputed.entries.find((e) => e.person.id === personId);
  assert(!!recomputedEntry, "the marked person still has an entry in the recomputed ranking");
  assert(
    !!recomputedEntry &&
      recomputedEntry.reason.trim().length > 0 &&
      !recomputedEntry.reason.startsWith("Nie udało się wygenerować"),
    "the marked person's reason is real model output, not the reconciliation fallback",
  );

  console.log("\nEditing the event as A...");
  const editedNote = `${markNote} (edited)`;
  const editPatch = await fetch(`${baseUrl}/api/contact-events/${eventId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: jarA },
    body: JSON.stringify({ outcome: "not_yet", note: editedNote }),
  });
  const editBody: { event?: ContactEventShape; facts?: ContactFactsShape } = await editPatch.json();
  assert(editPatch.status === 200, `edit PATCH returns 200 (got ${String(editPatch.status)})`);
  assert(editBody.event?.outcome === "not_yet", "edited event's outcome persisted");
  assert(editBody.facts?.lastAttemptFailed === true, "edited facts reflect the new outcome (lastAttemptFailed)");

  console.log("\nDeleting the event as A...");
  const deleteRes = await fetch(`${baseUrl}/api/contact-events/${eventId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Cookie: jarA },
  });
  const deleteBody: { facts?: ContactFactsShape | null } = await deleteRes.json();
  assert(deleteRes.status === 200, `delete returns 200 (got ${String(deleteRes.status)})`);

  const afterDelete = await fetch(`${baseUrl}/api/contact-events?personId=${personId}`, { headers: { Cookie: jarA } });
  const afterDeleteBody: { events?: ContactEventShape[] } = await afterDelete.json();
  assert(
    !afterDeleteBody.events?.some((e) => e.id === eventId),
    "the deleted event is gone from GET /api/contact-events",
  );
  void deleteBody;
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
    console.log("\nAll feedback-loop assertions passed.");
  });
