import { getViteConfig } from "astro/config";
import { defineConfig } from "vitest/config";
import type { PluginOption } from "vite";
import path from "node:path";

const srcDir = path.resolve(import.meta.dirname, "./src");
const stubsDir = path.resolve(import.meta.dirname, "./tests/stubs");

// Vitest runs through Astro's own Vite pipeline (getViteConfig) so that
// `astro:env/server` and the `@/` alias resolve exactly as they do in the app.
//
// Under Vitest the Vite command is "serve", which getViteConfig maps to Astro's
// "dev" -- and that matters, because Astro's env plugin inlines the loaded values
// at transform time under any non-build command. The values therefore have to
// exist at config-resolution time, which is what `.env.test` is for. Assigning
// process.env inside a test file or a setupFile is too late, and `setGetEnv` from
// astro/env/setup is inert here because the generated module never calls it.
export default defineConfig(async (env) => {
  const config = await getViteConfig({
    resolve: {
      // Vitest does not read tsconfig `paths`, so tsconfig.json's `@/*` -> ./src/*
      // is mirrored here; without it every `@/lib/...` import in a test fails.
      alias: {
        // Routes that touch AI jobs reach `cloudflare:workers` through
        // src/lib/ai-jobs.ts. There is no workerd runtime here, so point the
        // specifier at an in-memory KV stub (see tests/stubs/cloudflare-workers.ts).
        "cloudflare:workers": path.join(stubsDir, "cloudflare-workers.ts"),
        "@": srcDir,
      },
    },
    test: {
      // Astro 6 requires an explicit environment, and this whole test surface is
      // server-side: RLS policies, API route handlers, HTTP requests.
      environment: "node",
      // One directory per layer, each with exactly one prerequisite:
      //   tests/rls    -- the local Supabase stack must be up (`supabase start`)
      //   tests/routes -- none; `.env.test` supplies everything
      //   tests/http   -- a server the developer starts, addressed by TEST_BASE_URL
      // Listing them separately keeps `npm test tests/<layer>` meaningful.
      // tests/stubs/ is deliberately absent: it holds helpers, not tests.
      include: ["tests/rls/**/*.test.ts", "tests/routes/**/*.test.ts", "tests/http/**/*.test.ts"],
    },
  })(env);

  config.plugins = stripCloudflarePlugins(config.plugins);
  return config;
});

// @astrojs/cloudflare injects @cloudflare/vite-plugin bound to the "ssr" Vite
// environment (dist/index.js:136-140). That plugin refuses to start when a Worker
// environment carries `resolve.external` -- which Vitest always sets on "ssr" to
// externalise node builtins -- so Vitest dies during config resolution with
// "The following environment options are incompatible with the Cloudflare Vite
// plugin". The adapter also marks every `cloudflare:*` specifier external, which
// would defeat the stub alias above.
//
// None of it is wanted here: tests run in node, not workerd, and nothing in the
// suite exercises the Workers runtime -- Cloudflare-specific behaviour is proven
// by deploying, not by a unit test. So drop the adapter's Vite-level plugins and
// keep Astro's own, notably `astro:vite-plugin-env`, which is the whole reason
// getViteConfig is used at all.
function stripCloudflarePlugins(plugins: PluginOption[] | undefined): PluginOption[] {
  const kept: PluginOption[] = [];

  const visit = (option: PluginOption): void => {
    if (Array.isArray(option)) {
      option.forEach(visit);
      return;
    }
    if (option && "name" in option && isCloudflarePlugin(option.name)) {
      return;
    }
    kept.push(option);
  };

  (plugins ?? []).forEach(visit);
  return kept;
}

function isCloudflarePlugin(name: string): boolean {
  return (
    name.startsWith("vite-plugin-cloudflare") ||
    name.startsWith("@astrojs/cloudflare:") ||
    name.startsWith("virtual:astro-cloudflare:")
  );
}
