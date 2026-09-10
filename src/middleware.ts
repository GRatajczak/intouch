import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { consentFromOptOut } from "@/lib/analytics/consent";

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

  // Analytics consent for the browser channel, resolved here because this is
  // where the Supabase client and the user already exist -- a second client
  // just to read one boolean would be a second round trip for nothing.
  //
  // Scoped to document requests with a user: /api/* never renders a layout, so
  // the value would be paid for and discarded, and an anonymous request has no
  // row to read. Anonymous therefore stays undefined, which the layout turns
  // into "unknown" -- and "unknown" means collect (see browser.ts).
  if (supabase && context.locals.user && !context.url.pathname.startsWith("/api/")) {
    const { data, error } = await supabase
      .from("profiles")
      .select("analytics_opt_out")
      .eq("owner_id", context.locals.user.id)
      .maybeSingle();

    // A read failure resolves to "denied", NOT to "unknown". `consent.ts` calls
    // this failing open to silence, and since this change made "unknown" mean
    // collect, silence has to be spelled explicitly or a broken query would
    // quietly start sending a user's pageviews against their own switch.
    // An absent row means consented, matching consent.ts:16 and settings.astro.
    if (error) {
      console.error(`[analytics] consent read failed for owner ${context.locals.user.id}: ${error.message}`);
      context.locals.analyticsConsent = "denied";
    } else {
      context.locals.analyticsConsent = consentFromOptOut(data?.analytics_opt_out) ? "granted" : "denied";
    }
  }

  const response = await next();
  authCookieHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
});
