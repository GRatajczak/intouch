import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseForm, toRow } from "@/lib/validation/profile";
import { dispatch } from "@/lib/analytics";

function jsonResponse(body: unknown, status: number, headers?: Headers): Response {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  headers?.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse({ error: "Musisz być zalogowany" }, 401);
  }

  const parsed = parseForm(await context.request.formData());
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza";
    return jsonResponse({ error: message }, 400);
  }

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return jsonResponse({ error: "Supabase nie jest skonfigurowany" }, 500);
  }

  // F-06 funnel step 2 pre-check, and it MUST run before the upsert: this
  // route upserts on the owner_id primary key with no .select(), so afterwards
  // the row always exists and nothing can tell a first fill from an edit. Same
  // existence-query shape as src/middleware.ts.
  //
  // No consent read here, and none is needed: analytics_opt_out lives ON the
  // profiles row, so "no row existed" already means "no opt-out was ever
  // recorded". The plan called for folding a consent read into this query;
  // TypeScript pointed out it would be dead code, since the only branch that
  // emits is the one where there is no row to read a flag from.
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("owner_id")
    .eq("owner_id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .upsert({ ...toRow(parsed.data, user.id), updated_at: new Date().toISOString() });

  if (error) {
    return jsonResponse({ error: error.message }, 500, authCookieHeaders);
  }

  // Fires only on the first fill. Best-effort: a concurrent double submit could
  // see "no row" twice and emit twice, the same accepted posture as the
  // ranking route's documented TOCTOU race.
  if (!existingProfile) {
    dispatch(context.locals.cfContext, user.id, {
      event: "profile_completed",
      properties: {
        // Counts only -- which channels and windows a user picked are personal
        // attributes and stay out of the payload entirely.
        rhythm_channels_count: parsed.data.preferredChannels?.length ?? 0,
        rhythm_slots_count: parsed.data.availabilityWindows?.length ?? 0,
      },
    });
  }

  return jsonResponse({ success: true }, 200, authCookieHeaders);
};
