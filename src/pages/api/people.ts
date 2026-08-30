import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseForm, toRows } from "@/lib/validation/person";

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const parsed = parseForm(await context.request.formData());
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza";
    return context.redirect(`/people/new?error=${encodeURIComponent(message)}`);
  }

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return context.redirect(`/people/new?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }

  const { error } = await supabase.from("people").insert(toRows(parsed.data, user.id));

  if (error) {
    return context.redirect(`/people/new?error=${encodeURIComponent(error.message)}`);
  }

  const response = context.redirect("/people");
  authCookieHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
};
