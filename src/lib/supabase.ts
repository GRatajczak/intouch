import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";

export function createClient(requestHeaders: Headers, cookies: AstroCookies, responseHeaders?: Headers) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get("Cookie") ?? "").map(({ name, value }) => ({
          name,
          value: value ?? "",
        }));
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, options);
        });
        if (responseHeaders) {
          Object.entries(headers).forEach(([key, value]) => {
            responseHeaders.set(key, value);
          });
        }
      },
    },
  });
}
