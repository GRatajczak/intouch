import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return context.redirect(`/auth/forgot-password?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email);

  if (error) {
    return context.redirect(`/auth/forgot-password?error=${encodeURIComponent(error.message)}`);
  }

  const response = context.redirect("/auth/forgot-password-sent");
  authCookieHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
};
