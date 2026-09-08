// @ts-check
import { defineConfig, envField, sessionDrivers } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  site: "https://get-in-touch.pl",
  output: "server",
  integrations: [
    react(),
    // Every route in this app is either auth-gated (/dashboard, /people, /profile,
    // /settings) or transactional (/auth/*), so the sitemap would otherwise ship
    // a dozen URLs that resolve to a redirect for anyone Google sends there. The
    // landing page is the only indexable surface.
    sitemap({
      filter: (page) => new URL(page).pathname === "/",
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare({ imageService: "compile" }),
  // Auth uses Supabase cookies, not Astro sessions. Explicit in-memory driver
  // stops the Cloudflare adapter from auto-provisioning an unused KV namespace.
  session: {
    driver: sessionDrivers.lruCache(),
  },
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: false }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: false }),
      // Stays optional by design even though S-02's ranking feature now depends on
      // it: the client factory in src/lib/openai.ts returns null when the key is
      // absent, so a missing secret fails one screen's job rather than the whole
      // Worker (mirrors src/lib/supabase.ts).
      OPENAI_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // Same optional-secret shape as OPENAI_API_KEY: src/lib/resend.ts returns
      // null when absent, so a missing key fails one scheduled send, not the
      // whole Worker.
      RESEND_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // S-04's reminder sweep runs from a Cron Trigger with no signed-in user, so
      // every `auth.uid() = owner_id` policy returns zero rows for it. This key is
      // the deliberate, single exception -- read by src/lib/supabase-admin.ts and
      // nothing else, and usable only to call the two SECURITY DEFINER functions
      // the sweep needs. Optional for the same reason as the two keys above: a
      // missing key must fail one scheduled sweep, never the whole Worker.
      SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // The reminder emails' From address, on the verified get-in-touch.pl
      // domain. The plan chose a mail.* subdomain to keep sending reputation off
      // the apex; the apex is what was actually verified in Resend, and redoing
      // DNS was not worth the delay. Revisit if deliverability ever suffers.
      // Not a secret in the cryptographic sense, but it lives here
      // rather than as a source literal so the sender can be changed without a
      // code deploy -- and because F-04 shipped it hardcoded, which lessons.md
      // records as a gap to close before this slice sends to real users.
      REMINDER_FROM: envField.string({ context: "server", access: "secret", optional: true }),
      // The origin S-04's reminder links are built from.
      //
      // This DUPLICATES `site` above, and that is a deliberate, narrow
      // exception to the "one place only" rule in CLAUDE.md. `site` reaches
      // app code through Astro's own pipeline, but src/worker.ts is bundled by
      // wrangler (wrangler.jsonc `main`), not by Astro -- so `astro:config/*`
      // cannot be relied on there, while `astro:env/server` is the channel
      // F-04 already proved works in the deployed Worker. Keep the two in sync:
      // change `site` and this secret together.
      APP_BASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
