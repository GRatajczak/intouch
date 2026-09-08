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

  const { error } = await supabase
    .from("profiles")
    .update({ reminders_enabled: parsed.data.enabled })
    .eq("owner_id", user.id);

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ enabled: parsed.data.enabled }, 200);
};
