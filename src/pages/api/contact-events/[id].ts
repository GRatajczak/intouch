import type { APIRoute } from "astro";
import type { TablesUpdate } from "@/db/database.types";
import { createClient } from "@/lib/supabase";
import { loadPersonContactFacts } from "@/lib/contact-history/facts";
import { updateContactEventSchema } from "@/lib/validation/contact-event";

// Mirrors src/pages/api/rankings.ts's json() helper -- a JSON contract for
// the browser island, never a redirect.
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const PATCH: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }
  const ownerId = context.locals.user.id;
  const eventId = context.params.id;
  if (!eventId) {
    return json({ error: "Brak identyfikatora zdarzenia" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 503);
  }

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane" }, 400);
  }

  const parsed = updateContactEventSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane" }, 400);
  }

  const updates: TablesUpdate<"contact_events"> = {};
  if ("note" in parsed.data) {
    updates.note = parsed.data.note ?? null;
  }
  if ("outcome" in parsed.data && parsed.data.outcome) {
    updates.outcome = parsed.data.outcome;
  }

  // Scoped by owner_id in addition to RLS so a row the caller does not own
  // updates zero rows -- 404, never 403, leaks nothing about existence.
  const { data: updated, error: updateError } = await supabase
    .from("contact_events")
    .update(updates)
    .eq("id", eventId)
    .eq("owner_id", ownerId)
    .select()
    .maybeSingle();

  if (updateError) {
    return json({ error: updateError.message }, 500);
  }
  if (!updated) {
    return json({ error: "Nie znaleziono zdarzenia" }, 404);
  }

  const facts = await loadPersonContactFacts(supabase, ownerId, updated.person_id);

  return json({ event: updated, facts }, 200);
};
