// Runs the real reminder sweep against real data and prints what it WOULD
// send, without sending anything.
//
// This exists because there is no way to fire a Cron Trigger on demand, and a
// real run costs a real email to a real person. Unlike the other verify-*
// scripts it does not address a deployed URL: the sweep has no HTTP surface, so
// it is executed in-process here.
//
// Usage: npm run verify:reminders            (dry run — the default, and safe)
//        npm run verify:reminders -- --send  (SENDS REAL EMAIL — see below)
//
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY /
// REMINDER_FROM / APP_BASE_URL from the environment, so whichever Supabase
// project those point at is the one it reads.
import { runSweep, type ReminderCandidate, type SweepDeps } from "../src/lib/reminders/sweep";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/db/database.types";

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

const send = process.argv.includes("--send");

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "APP_BASE_URL"] as const;
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment: ${missing.join(", ")}`);
  process.exit(1);
}

// Guarded by the `missing` check above. worker-configuration.d.ts types these
// as plain strings, so no bang operator and no redundant fallback is needed.
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.APP_BASE_URL;

const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// A dry run must not be able to send by accident, so the send path is a stub
// that fails loudly rather than a real client that happens not to be called.
const deps: SweepDeps = {
  supabase,
  baseUrl,
  // Deliberately NOT the real runRanking. Two reasons, both load-bearing:
  // it reaches KV through `cloudflare:workers`, which tsx cannot resolve, and
  // a dry run that quietly spent OpenAI budget per candidate would be a poor
  // thing to reach for casually. The consequence is stated plainly in the
  // output: a stale ranking is read as-is, so what you see is what today's
  // stored hierarchy says, not what a fresh one would.
  refreshRanking: (ownerId) => {
    console.log(`  … would refresh the ranking for ${ownerId} (skipped in a dry run)`);
    return Promise.resolve("done");
  },
  sendEmail: () => {
    throw new Error("verify-reminders refuses to send; run the production cron for a real send");
  },
};

console.log(`\nReminder sweep — ${send ? "REAL SEND" : "dry run"}\n`);

if (send) {
  console.error("Real sending is not wired into this script on purpose.");
  console.error("Use the production Cron Trigger; that is what phase 7 verifies.");
  process.exit(1);
}

const { data: candidates } = await supabase.rpc("reminder_candidates", { cooldown_days: 3, max_rows: 25 });
const rows = (candidates ?? []) as ReminderCandidate[];

console.log(`Candidates (opted in, outside cooldown): ${String(rows.length)}`);
for (const row of rows) {
  console.log(`  · ${row.owner_id}  last sent: ${row.last_sent_at ?? "never"}`);
}
console.log("");

const summary = await runSweep(deps, { dryRun: true });

console.log("\nSummary:");
console.log(JSON.stringify(summary, null, 2));
console.log("");

// A dry run that silently did nothing looks identical to a healthy quiet day,
// so the run is asserted to have actually exercised the path it claims to test.
assert(summary.considered === rows.length, "every candidate was processed");
assert(summary.failed === 0, "no owner raised an unexpected error");
assert(
  summary.sent + summary.skipped.nothing_urgent + summary.skipped.refresh_failed + summary.skipped.no_ranking ===
    summary.considered,
  "every candidate ended in exactly one outcome",
);

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.\n");
