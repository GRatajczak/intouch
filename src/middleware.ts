import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/profile", "/people", "/settings"];
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

  // Both the /people profile gate and the browser channel's consent verdict
  // read the same row of `profiles`, so they share ONE query. They used to be
  // two sequential round trips, which put a second serial hop on the request
  // path of every /people/* and /settings render to serve a feature only
  // analytics needed.
  //
  // Scoped to document requests with a user: /api/* never renders a layout, so
  // the value would be paid for and discarded, and an anonymous request has no
  // row to read. Anonymous therefore leaves `analyticsConsent` undefined, which
  // the layout turns into "unknown" -- and "unknown" means "ask first" (banner).
  const needsProfileGate =
    supabase !== null &&
    context.locals.user !== null &&
    PROFILE_GATED_ROUTES.some((route) => context.url.pathname.startsWith(route));
  const needsConsent = supabase !== null && context.locals.user !== null && !context.url.pathname.startsWith("/api/");

  if (supabase && context.locals.user && (needsProfileGate || needsConsent)) {
    const { data, error } = await supabase
      .from("profiles")
      .select("owner_id, analytics_consent")
      .eq("owner_id", context.locals.user.id)
      .maybeSingle();

    if (needsProfileGate && !data) {
      return context.redirect("/profile");
    }

    if (needsConsent) {
      // A read failure resolves to "denied", NOT to "unknown": "unknown" shows
      // the banner and lets a stored browser choice start the SDK, so a broken
      // query must not be able to do either against a user's recorded refusal.
      //
      // Signed in with a `null` column is "unknown" (never asked -> banner);
      // an absent row is "unknown" too (profile not completed yet, the browser
      // choice is still pending). Only an explicit `true` is "granted".
      if (error) {
        console.error(
          `[middleware] analytics consent read failed for owner ${context.locals.user.id}: ${error.message}`,
        );
        context.locals.analyticsConsent = "denied";
      } else if (data?.analytics_consent === true) {
        context.locals.analyticsConsent = "granted";
      } else if (data?.analytics_consent === false) {
        context.locals.analyticsConsent = "denied";
      } else {
        context.locals.analyticsConsent = "unknown";
      }
    }
  }

  const response = await next();
  authCookieHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
});
