import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { loadPersonContactFacts } from "@/lib/contact-history/facts";
import { createContactEventSchema } from "@/lib/validation/contact-event";
import { dispatch, hasAnalyticsConsent } from "@/lib/analytics";

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

  // Same reasoning as person_id above -- rankingEntryId is a second FK the
  // table's own RLS does not cover, so an unverified id would silently link
  // this event to another owner's ranking_entries row.
  if (rankingEntryId) {
    const { data: rankingEntry } = await supabase
      .from("ranking_entries")
      .select("id")
      .eq("id", rankingEntryId)
      .maybeSingle();
    if (!rankingEntry) {
      return json({ error: "Nie znaleziono wpisu rankingu" }, 404);
    }
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

  // F-06 funnel step 5, the terminal one -- and ONLY that. This route succeeds
  // for both outcomes, but "not_yet" is a different answer, not a weaker
  // version of this one, so it emits nothing.
  //
  // Consent needs its own read: this route touches people, ranking_entries and
  // contact_events, never profiles. One extra subrequest on a route that makes
  // four, against the ~43 spare measured for a full ranking run.
  //
  // Deliberately NOT in the payload: person_id (a stable identifier that joins
  // straight back to `name` and `description` in people), the note text, and
  // `outcome` itself -- the event only exists for "happened", so carrying it
  // would be a constant.
  //
  // The read rides along with the facts load this route already awaits, so it
  // costs a subrequest but no extra latency -- nothing new is serialized into
  // the response path.
  const [facts, consented] = await Promise.all([
    loadPersonContactFacts(supabase, ownerId, personId),
    outcome === "happened" ? hasAnalyticsConsent(supabase, ownerId) : Promise.resolve(false),
  ]);

  if (outcome === "happened" && consented) {
    dispatch(context.locals.cfContext, ownerId, {
      event: "contact_confirmed",
      properties: {
        has_note: Boolean(note),
        from_suggestion: Boolean(rankingEntryId),
      },
    });
  }

  return json({ event: inserted, facts }, 201);
};

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }
  const ownerId = context.locals.user.id;

  const personId = context.url.searchParams.get("personId");
  if (!personId) {
    return json({ error: "Brak parametru personId" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 503);
  }

  const { data: events, error } = await supabase
    .from("contact_events")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("person_id", personId)
    .order("occurred_at", { ascending: false });

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({ events }, 200);
};
