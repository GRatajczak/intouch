import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseForm, toRows } from "@/lib/validation/person";
import { dispatch, hasAnalyticsConsent } from "@/lib/analytics";

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

  // F-06 funnel step 3 pre-check, and it MUST run before the insert -- after a
  // batch insert the count is never zero, so nothing could tell a first add
  // from a fifth.
  //
  // Counts people of EVERY status, unlike the dashboard's head-count which
  // filters status = 'active'. This question is "has this user ever added
  // anyone?", not "do they have anyone right now": filtering by active would
  // re-fire the event for someone who added a person, deactivated them, and
  // added another.
  //
  // Consent needs its own read here -- this route touches only `people`.
  //
  // hasAnalyticsConsent fails open to silence (src/lib/analytics/consent.ts)
  // and never throws, but the raw count query can still reject on a genuine
  // network/driver exception -- guarded so that rejects the same way every
  // other failure on this route does, instead of an unhandled 500.
  let existingPeople: number | null;
  let consented: boolean;
  try {
    [{ count: existingPeople }, consented] = await Promise.all([
      supabase.from("people").select("*", { count: "exact", head: true }).eq("owner_id", user.id),
      hasAnalyticsConsent(supabase, user.id),
    ]);
  } catch (err: unknown) {
    console.error(`[people] pre-insert check failed: ${err instanceof Error ? err.message : String(err)}`);
    return context.redirect(`/people/new?error=${encodeURIComponent("Nie udało się dodać osób. Spróbuj ponownie.")}`);
  }

  const { error } = await supabase.from("people").insert(toRows(parsed.data, user.id));

  if (error) {
    return context.redirect(`/people/new?error=${encodeURIComponent(error.message)}`);
  }

  // Fires only on the submit that crosses zero. Best-effort, same accepted
  // posture as the ranking route's documented TOCTOU race.
  if (existingPeople === 0 && consented) {
    dispatch(context.locals.cfContext, user.id, {
      event: "first_person_added",
      // The route is a batch insert, so "first person" may be "first N in one
      // submit". The count records which -- and names nobody.
      properties: { people_added: parsed.data.length },
    });
  }

  // ?added=1 is the only signal PersonForm's draft-clear (people/index.astro)
  // trusts -- a confirmed insert, never a client-side validation pass. See
  // test-plan Phase 4, Risk #8.
  const response = context.redirect("/people?added=1");
  authCookieHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
};
