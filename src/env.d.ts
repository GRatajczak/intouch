declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    // @astrojs/cloudflare sets this on locals but does not merge it into App.Locals
    // for us, so declaring it here is what makes `locals.cfContext.waitUntil(...)`
    // type-check. Optional on purpose: only the Worker handler sets it, and the
    // adapter guards for its absence in its own endpoints too.
    cfContext?: import("@astrojs/cloudflare").Runtime["cfContext"];
  }
}
