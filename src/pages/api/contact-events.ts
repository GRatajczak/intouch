import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { loadPersonContactFacts } from "@/lib/contact-history/facts";
import { createContactEventSchema } from "@/lib/validation/contact-event";

// Mirrors src/pages/api/rankings.ts's json() helper -- a JSON contract for
// the browser island, never a redirect.
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }
  const ownerId = context.locals.user.id;

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

  const parsed = createContactEventSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane" }, 400);
  }
  const { personId, outcome, note, rankingEntryId } = parsed.data;

  // person_id is not covered by contact_events' own RLS -- its `with check`
  // tests owner_id only, and Postgres does not apply RLS when validating a
  // foreign key. Verify the person belongs to this caller through the
  // caller's own RLS-scoped client before inserting.
  const { data: person } = await supabase.from("people").select("id").eq("id", personId).maybeSingle();
  if (!person) {
    return json({ error: "Nie znaleziono osoby" }, 404);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("contact_events")
    .insert({
      owner_id: ownerId,
      person_id: personId,
      outcome,
      note: note ?? null,
      ranking_entry_id: rankingEntryId ?? null,
    })
    .select()
    .single();

  if (insertError) {
    return json({ error: insertError.message }, 500);
  }

  const facts = await loadPersonContactFacts(supabase, ownerId, personId);

  return json({ event: inserted, facts }, 201);
};
