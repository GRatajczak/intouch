import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { remindersToggleSchema } from "@/lib/validation/settings";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Flips FR-008's opt-out for the signed-in user.
 *
 * Uses the ordinary cookie-bound client, never src/lib/supabase-admin.ts: this
 * route has the caller's session, so RLS is the right guard here and the
 * service-role client has no business anywhere a request can reach.
 *
 * The `.eq("owner_id", …)` below is not redundant with RLS. A policy would
 * confine the write to the caller's rows anyway, but the filter is what makes
 * the *intent* explicit and is the only guard left if this ever runs under a
 * connection that is not the caller's -- which is exactly what the cross-owner
 * test in tests/routes/reminders-toggle.test.ts constructs.
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

  const parsed = remindersToggleSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Nieprawidłowe dane";
    return jsonResponse({ error: message }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase nie jest skonfigurowany" }, 500);
  }

  // `.select().maybeSingle()` rather than a bare update, matching
  // contact-events/[id].ts and people/[id].ts: PostgREST reports an UPDATE that
  // matched zero rows as `error: null`, so checking only `error` would answer
  // 200 to a caller whose row does not exist and write nothing. That is the
  // trap tests/rls/isolation.test.ts's header describes -- RLS filters, it does
  // not reject -- and it is worst on precisely this route, whose whole job is to
  // stop unwanted email. A signed-in user can reach /settings without a profile
  // row (middleware.ts gates /people on one, not /settings).
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ reminders_enabled: parsed.data.enabled })
    .eq("owner_id", user.id)
    .select("reminders_enabled")
    .maybeSingle();

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }
  if (!updated) {
    return jsonResponse({ error: "Nie znaleziono profilu do zaktualizowania" }, 404);
  }

  return jsonResponse({ enabled: updated.reminders_enabled }, 200);
};
