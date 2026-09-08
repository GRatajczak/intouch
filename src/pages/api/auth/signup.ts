import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { dispatch } from "@/lib/analytics";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }

  // F-06 funnel step 1. Named `signup_started`, not `signed_up`: production
  // requires email confirmation, there is no session yet, and confirmation
  // never re-enters app code -- so this knowingly counts accounts that are
  // never confirmed, and the event name is where that caveat lives.
  //
  // No consent pre-check: no profiles row exists this early, so there is
  // nothing to read and the column's default is opted in.
  //
  // `data.user` is nullable -- Supabase can return a user-less success -- and
  // the distinct_id is the whole point, so a missing user means no event.
  if (data.user) {
    dispatch(context.locals.cfContext, data.user.id, { event: "signup_started" });
  }

  const response = context.redirect("/auth/confirm-email");
  authCookieHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
};
