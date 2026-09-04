import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parsePasswordChangeForm } from "@/lib/validation/settings";

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
  if (!user?.email) {
    return jsonResponse({ error: "Musisz być zalogowany" }, 401);
  }

  const parsed = parsePasswordChangeForm(await context.request.formData());
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza";
    return jsonResponse({ error: message }, 400);
  }

  const authCookieHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, authCookieHeaders);
  if (!supabase) {
    return jsonResponse({ error: "Supabase nie jest skonfigurowany" }, 500);
  }

  const { currentPassword, newPassword } = parsed.data;

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError) {
    return jsonResponse({ error: "Nieprawidłowe obecne hasło" }, 400, authCookieHeaders);
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500, authCookieHeaders);
  }

  await supabase.auth.signOut({ scope: "others" });

  return jsonResponse({ success: true }, 200, authCookieHeaders);
};
