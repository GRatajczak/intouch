import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { analyticsToggleSchema } from "@/lib/validation/settings";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Flips F-06's analytics opt-out for the signed-in user.
 *
 * Shaped exactly like src/pages/api/settings/reminders.ts, for the same
 * reasons:
 *
 * - the ordinary cookie-bound client, never src/lib/supabase-admin.ts -- this
 *   route has the caller's session, so RLS is the right guard and the
 *   service-role client has no business anywhere a request can reach;
 * - `.eq("owner_id", …)` is not redundant with RLS but states the intent, and
 *   is the only guard left if this ever runs under a connection that is not the
 *   caller's;
 * - `.select().maybeSingle()` rather than a bare update, because PostgREST
 *   reports an UPDATE that matched zero rows as `error: null`. A signed-in user
 *   can reach /settings without a profile row (middleware.ts gates /people on
 *   one, not /settings), and answering 200 while writing nothing is exactly the
 *   wrong response on a route whose job is to stop data collection.
 *
 * The wire contract is positive (`enabled: true` = send events) while the
 * column is negative (`analytics_opt_out`). This function is the single place
 * that inverts, in both directions.
 */
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse({ error: "Musisz być zalogowany" }, 401);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Nieprawidłowe dane" }, 400);
  }

  const parsed = analyticsToggleSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Nieprawidłowe dane";
    return jsonResponse({ error: message }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase nie jest skonfigurowany" }, 500);
  }

  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ analytics_opt_out: !parsed.data.enabled })
    .eq("owner_id", user.id)
    .select("analytics_opt_out")
    .maybeSingle();

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }
  if (!updated) {
    return jsonResponse({ error: "Nie znaleziono profilu do zaktualizowania" }, 404);
  }

  return jsonResponse({ enabled: !updated.analytics_opt_out }, 200);
};
