import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseEmailChangeForm } from "@/lib/validation/settings";

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

  const parsed = parseEmailChangeForm(await context.request.formData());
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza";
    return jsonResponse({ error: message }, 400);
  }

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return jsonResponse({ error: "Supabase nie jest skonfigurowany" }, 500);
  }

  const { error } = await supabase.auth.updateUser({ email: parsed.data.newEmail });
  if (error) {
    return jsonResponse({ error: error.message }, 500, authCookieHeaders);
  }

  return jsonResponse({ success: true }, 200, authCookieHeaders);
};
