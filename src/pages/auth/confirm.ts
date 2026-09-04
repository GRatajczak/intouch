import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

const ALLOWED_TYPES = ["recovery", "email_change"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

const DEFAULT_NEXT: Record<AllowedType, string> = {
  recovery: "/auth/reset-password",
  email_change: "/settings",
};

const ERROR_REDIRECT: Record<AllowedType, string> = {
  recovery: "/auth/reset-password",
  email_change: "/settings",
};

export const GET: APIRoute = async (context) => {
  const params = context.url.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  if (!tokenHash || !ALLOWED_TYPES.includes(type as AllowedType)) {
    return context.redirect("/auth/signin");
  }
  const confirmedType = type as AllowedType;
  const next = params.get("next") ?? DEFAULT_NEXT[confirmedType];

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return context.redirect(
      `${ERROR_REDIRECT[confirmedType]}?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`,
    );
  }

  const { error } = await supabase.auth.verifyOtp({ type: confirmedType, token_hash: tokenHash });

  if (error) {
    return context.redirect(`${ERROR_REDIRECT[confirmedType]}?error=${encodeURIComponent(error.message)}`);
  }

  const response = context.redirect(next);
  authCookieHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
};
