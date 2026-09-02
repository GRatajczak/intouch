import { handle } from "@astrojs/cloudflare/handler";
import { RESEND_TEST_RECIPIENT } from "astro:env/server";
import { createResendClient } from "./lib/resend";
import { renderEmailShell } from "./lib/email/shell";

const PROOF_SUBJECT = "InTouch — sprawdzenie ścieżki dostarczania";

export default {
  fetch: handle,
  async scheduled(controller, _env, _ctx) {
    const resend = createResendClient();
    if (!resend || !RESEND_TEST_RECIPIENT) {
      console.error("resend: skipped — RESEND_API_KEY or RESEND_TEST_RECIPIENT not configured");
      return;
    }

    const html = renderEmailShell({
      subject: PROOF_SUBJECT,
      bodyHtml: `<p>To jest testowa wiadomość potwierdzająca, że Worker InTouch potrafi wysłać e-mail z zaplanowanego triggera.</p><p style="color: #A39A90; font-size: 13px;">Uruchomienie: ${controller.cron} · ${new Date(controller.scheduledTime).toISOString()}</p>`,
    });

    try {
      const { data, error } = await resend.emails.send({
        from: "InTouch <onboarding@resend.dev>",
        to: [RESEND_TEST_RECIPIENT],
        subject: PROOF_SUBJECT,
        html,
      });
      if (error) {
        console.error("resend: failed", error);
        return;
      }
      console.log("resend: sent", data.id);
    } catch (err) {
      console.error("resend: failed", err);
    }
  },
} satisfies ExportedHandler<Env>;
