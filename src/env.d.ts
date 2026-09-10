declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    // @astrojs/cloudflare sets this on locals but does not merge it into App.Locals
    // for us, so declaring it here is what makes `locals.cfContext.waitUntil(...)`
    // type-check. Optional on purpose: only the Worker handler sets it, and the
    // adapter guards for its absence in its own endpoints too.
    cfContext?: import("@astrojs/cloudflare").Runtime["cfContext"];
    // The signed-in user's analytics consent, resolved once per document render
    // by src/middleware.ts and read by src/layouts/Layout.astro. Optional
    // because the middleware skips the query for /api/* and for anonymous
    // requests -- absent means "no signed-in verdict", which the layout passes
    // on as "unknown", and which src/lib/analytics/browser.ts collects under.
    analyticsConsent?: import("@/lib/analytics/browser").ConsentVerdict;
  }
}
