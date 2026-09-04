import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return context.redirect(
      `/auth/reset-password?error=${encodeURIComponent("Link do resetowania hasła wygasł lub został już użyty")}`,
    );
  }

  const form = await context.request.formData();
  const password = form.get("password") as string;

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return context.redirect(`/auth/reset-password?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    return context.redirect(`/auth/reset-password?error=${encodeURIComponent(updateError.message)}`);
  }

  await supabase.auth.signOut({ scope: "others" });

  const response = context.redirect("/");
  authCookieHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
};
