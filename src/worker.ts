import { handle } from "@astrojs/cloudflare/handler";
import { runReminderSweep } from "./lib/reminders/run-sweep";

export default {
  fetch: handle,
  /**
   * The daily reminder sweep (FR-008), fired by the `0 6 * * *` trigger in
   * wrangler.jsonc -- 08:00 CEST, the morning of the user base's timezone.
   *
   * Replaces F-04's proof send, whose only job was to establish that this
   * handler can reach Resend at all.
   *
   * Rethrows only what stopped the sweep from running. A single owner's failed
   * send is caught inside, counted, and written to reminder_sends, so the
   * dashboard's Trigger Events tab shows red for an infrastructure problem and
   * green for a run that did its job -- including one where somebody's email
   * bounced.
   */
  async scheduled(controller, _env, _ctx) {
    const startedAt = Date.now();
    const summary = await runReminderSweep();

    if (!summary) {
      return;
    }

    console.log(
      `[reminders] ${controller.cron} considered=${String(summary.considered)} ` +
        `refreshed=${String(summary.refreshed)} sent=${String(summary.sent)} ` +
        `failed=${String(summary.failed)} skipped=${JSON.stringify(summary.skipped)} ` +
        // Elapsed time is the only evidence in production that the OpenAI
        // refresh fits inside a cron invocation's budget -- lessons.md is
        // explicit that a fast local run proves nothing about that.
        `in ${String(Date.now() - startedAt)}ms`,
    );
  },
} satisfies ExportedHandler<Env>;
