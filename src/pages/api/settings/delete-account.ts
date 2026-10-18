import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { eraseAnalyticsSubject } from "@/lib/analytics/erase";

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

/**
 * Deletes the signed-in user's whole account: every owner row, the auth.users
 * row, and the person in PostHog (best effort).
 *
 * Order matters and is retry-safe:
 *  1. PostHog first. It is fail-soft, so an outage cannot block erasure, and a
 *     retry after a later failure repeats a harmless no-op.
 *  2. `delete_my_account()` over the cookie-bound client. The function deletes
 *     `auth.uid()` -- the connection's identity -- so this route has no owner
 *     filter to get wrong and no service-role client to misuse.
 *  3. signOut last, ignoring its error: the user no longer exists, so the
 *     server-side logout can fail while the local session cookie still needs
 *     clearing.
 *
 * An RPC error returns 500 and leaves everything in place.
 */
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse({ error: "Musisz być zalogowany" }, 401);
  }

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return jsonResponse({ error: "Supabase nie jest skonfigurowany" }, 500);
  }

  await eraseAnalyticsSubject(user.id);

  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    return jsonResponse({ error: error.message }, 500, authCookieHeaders);
  }

  await supabase.auth.signOut();

  return jsonResponse({ success: true }, 200, authCookieHeaders);
};
