import { APP_BASE_URL, REMINDER_FROM } from "astro:env/server";
import { runRanking } from "@/lib/ranking/run";
import { createResendClient } from "@/lib/resend";
import { createAdminClient } from "@/lib/supabase-admin";
import { runSweep, type SweepOptions, type SweepSummary } from "@/lib/reminders/sweep";

/**
 * Wires the real clients into the sweep.
 *
 * Split from sweep.ts so the decision logic there stays injectable: this file
 * is the only place the service-role client, Resend and OpenAI actually get
 * built, and it is deliberately thin enough to need no test of its own.
 *
 * Returns null when configuration is missing rather than throwing. A missing
 * secret must fail one scheduled sweep, not the whole Worker -- the same
 * posture src/lib/{openai,resend,supabase}.ts already take.
 */
export async function runReminderSweep(options: SweepOptions = {}): Promise<SweepSummary | null> {
  const supabase = createAdminClient();
  const resend = createResendClient();

  const missing = [
    supabase ? null : "SUPABASE_SERVICE_ROLE_KEY",
    resend ? null : "RESEND_API_KEY",
    REMINDER_FROM ? null : "REMINDER_FROM",
    APP_BASE_URL ? null : "APP_BASE_URL",
  ].filter((name): name is string => name !== null);

  if (!supabase || !resend || !REMINDER_FROM || !APP_BASE_URL) {
    console.warn(`[reminders] skipped — not configured: ${missing.join(", ")}`);
    return null;
  }

  // Hoisted so the narrowing above survives into the closure below, where TS
  // would otherwise widen the module-level bindings back to `string | undefined`.
  const from = REMINDER_FROM;

  return await runSweep(
    {
      supabase,
      baseUrl: APP_BASE_URL,
      // A cron-scoped job id, so a sweep-triggered run is distinguishable from
      // a user-triggered one in the KV job statuses and in the logs.
      refreshRanking: (ownerId) => runRanking(ownerId, supabase, `cron:${crypto.randomUUID()}`),
      sendEmail: async ({ to, subject, html }) => {
        const result = await resend.emails.send({ from, to: [to], subject, html });
        if (result.error) {
          throw new Error(result.error.message);
        }
        return result.data.id;
      },
    },
    options,
  );
}
