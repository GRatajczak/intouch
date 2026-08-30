import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/profile", "/people"];
const PROFILE_GATED_ROUTES = ["/people"];

export const onRequest = defineMiddleware(async (context, next) => {
  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  if (supabase && context.locals.user && PROFILE_GATED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("owner_id")
      .eq("owner_id", context.locals.user.id)
      .maybeSingle();
    if (!profile) {
      return context.redirect("/profile");
    }
  }

  const response = await next();
  authCookieHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
});
