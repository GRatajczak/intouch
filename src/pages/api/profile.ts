import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseForm, toRow } from "@/lib/validation/profile";

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const parsed = parseForm(await context.request.formData());
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza";
    return context.redirect(`/profile?error=${encodeURIComponent(message)}`);
  }

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return context.redirect(`/profile?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }

  const { error } = await supabase
    .from("profiles")
    .upsert({ ...toRow(parsed.data, user.id), updated_at: new Date().toISOString() });

  if (error) {
    return context.redirect(`/profile?error=${encodeURIComponent(error.message)}`);
  }

  const response = context.redirect("/people");
  authCookieHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
};
