import type { APIRoute } from "astro";
import { AuthenticationError } from "openai";
import { createClient } from "@/lib/supabase";
import { createOpenAIClient } from "@/lib/openai";
import { encryptApiKey } from "@/lib/crypto/api-key";
import { openAiKeySchema } from "@/lib/validation/settings";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const HINT_LENGTH = 4;

/**
 * Stores the signed-in user's own OpenAI key (S-17's BYOK).
 *
 * Validates the key against OpenAI itself -- one cheap `models.list()` call --
 * before ever writing ciphertext, so a syntactically valid but dead key never
 * becomes a false "saved" toast. `maxRetries: 0` for the same reason
 * src/lib/ranking/run.ts uses it: a rejected key must fail on the first call,
 * not after the SDK's own retry-on-429 default.
 *
 * NEVER logs or echoes the key: every error message below is a static string,
 * and the success response returns only `hint`, never the key or its ciphertext.
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

  const parsed = openAiKeySchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Nieprawidłowe dane";
    return jsonResponse({ error: message }, 400);
  }

  const apiKey = parsed.data.apiKey;

  // Always non-null: an explicit apiKey always yields a client. Checked anyway
  // so this route stays honest about createOpenAIClient's real contract.
  const probe = createOpenAIClient(apiKey);
  if (!probe) {
    return jsonResponse({ error: "Nie udało się zweryfikować klucza" }, 502);
  }

  try {
    await probe.models.list({ maxRetries: 0 });
  } catch (err: unknown) {
    if (err instanceof AuthenticationError) {
      return jsonResponse({ error: "OpenAI odrzucił ten klucz. Sprawdź, czy skopiowałeś go poprawnie." }, 400);
    }
    return jsonResponse({ error: "Nie udało się teraz zweryfikować klucza. Spróbuj ponownie." }, 502);
  }

  const ciphertext = await encryptApiKey(apiKey);
  if (ciphertext === null) {
    return jsonResponse({ error: "Zapisywanie kluczy jest obecnie niedostępne." }, 503);
  }

  const hint = apiKey.slice(-HINT_LENGTH);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase nie jest skonfigurowany" }, 500);
  }

  // `.select().maybeSingle()` rather than a bare update, matching
  // reminders.ts: an UPDATE that matches zero rows reports `error: null`, so
  // checking only `error` would answer 200 to a caller with no profile row
  // and write nothing.
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({
      openai_api_key_ciphertext: ciphertext,
      openai_api_key_hint: hint,
      // A freshly saved key just passed the models.list() probe above, so any
      // earlier "rejected" / "exhausted" mark (src/lib/ranking/run.ts) is
      // stale -- Phase 5's contract that saving a new key clears the state.
      openai_api_key_failed_at: null,
      openai_api_key_failure_reason: null,
    })
    .eq("owner_id", user.id)
    .select("openai_api_key_hint")
    .maybeSingle();

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }
  if (!updated) {
    // Reachable state: /settings has no profile-row gate (middleware.ts gates
    // /people on one, not /settings), so a signed-in user can land here before
    // ever filling in "Twój profil" above.
    return jsonResponse(
      { error: "Uzupełnij najpierw swój profil (sekcja „Twój profil” u góry strony), żeby zapisać klucz OpenAI." },
      404,
    );
  }

  return jsonResponse({ hint: updated.openai_api_key_hint }, 200);
};

/** Clears a stored key, returning the owner to the free tier immediately. */
export const DELETE: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse({ error: "Musisz być zalogowany" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase nie jest skonfigurowany" }, 500);
  }

  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ openai_api_key_ciphertext: null, openai_api_key_hint: null })
    .eq("owner_id", user.id)
    .select("openai_api_key_hint")
    .maybeSingle();

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }
  if (!updated) {
    return jsonResponse({ error: "Uzupełnij najpierw swój profil (sekcja „Twój profil” u góry strony)." }, 404);
  }

  return jsonResponse({ hint: null }, 200);
};
