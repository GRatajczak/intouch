import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const GET: APIRoute = async (context) => {
  const params = context.url.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const next = params.get("next") ?? "/auth/reset-password";

  if (type !== "recovery" || !tokenHash) {
    return context.redirect("/auth/signin");
  }

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return context.redirect(`/auth/reset-password?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }

  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });

  if (error) {
    return context.redirect(`/auth/reset-password?error=${encodeURIComponent(error.message)}`);
  }

  const response = context.redirect(next);
  authCookieHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
};
