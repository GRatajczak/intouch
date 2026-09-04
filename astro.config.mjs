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
      // The only address Resend's onboarding@resend.dev test sender can deliver
      // to (the account owner's own verified email) — see F-04's plan.
      RESEND_TEST_RECIPIENT: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
