import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

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

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return jsonResponse({ error: "Supabase nie jest skonfigurowany" }, 500);
  }

  const { error: peopleError } = await supabase.from("people").delete().eq("owner_id", user.id);
  if (peopleError) {
    return jsonResponse({ error: peopleError.message }, 500, authCookieHeaders);
  }

  const { error: rankingsError } = await supabase.from("rankings").delete().eq("owner_id", user.id);
  if (rankingsError) {
    return jsonResponse({ error: rankingsError.message }, 500, authCookieHeaders);
  }

  const { error: profileError } = await supabase.from("profiles").delete().eq("owner_id", user.id);
  if (profileError) {
    return jsonResponse({ error: profileError.message }, 500, authCookieHeaders);
  }

  await supabase.auth.signOut();

  return jsonResponse({ success: true }, 200, authCookieHeaders);
};
