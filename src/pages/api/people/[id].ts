import type { APIRoute } from "astro";
import type { TablesUpdate } from "@/db/database.types";
import { createClient } from "@/lib/supabase";
import { personUpdateSchema } from "@/lib/validation/person";

// Mirrors src/pages/api/contact-events/[id].ts's json() helper -- a JSON
// contract for the browser island, never a redirect.
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
  const personId = context.params.id;
  if (!personId) {
    return json({ error: "Brak identyfikatora osoby" }, 400);
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

  const parsed = personUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane" }, 400);
  }

  // Field edits and status transitions (deactivate/reactivate) both land
  // here -- both are "update this person" -- so the updates object is built
  // conditionally per key present, same as contact-events/[id].ts:43-49.
  const updates: TablesUpdate<"people"> = {};
  if ("name" in parsed.data) {
    updates.name = parsed.data.name;
  }
  if ("relationshipType" in parsed.data) {
    updates.relationship_type = parsed.data.relationshipType;
  }
  if ("description" in parsed.data) {
    updates.description = parsed.data.description;
  }
  if ("isCollective" in parsed.data) {
    updates.is_collective = parsed.data.isCollective;
  }
  if ("weight" in parsed.data) {
    updates.weight = parsed.data.weight;
  }
  if ("relationshipContext" in parsed.data) {
    updates.relationship_context = parsed.data.relationshipContext ?? null;
  }
  if ("contextTags" in parsed.data) {
    updates.context_tags = parsed.data.contextTags ?? [];
  }
  if ("lastContactBucket" in parsed.data) {
    updates.last_contact_bucket = parsed.data.lastContactBucket ?? null;
  }
  if ("status" in parsed.data) {
    updates.status = parsed.data.status;
  }

  // Scoped by owner_id in addition to RLS so a row the caller does not own
  // updates zero rows -- 404, never 403, leaks nothing about existence.
  const { data: updated, error: updateError } = await supabase
    .from("people")
    .update(updates)
    .eq("id", personId)
    .eq("owner_id", ownerId)
    .select()
    .maybeSingle();

  if (updateError) {
    return json({ error: updateError.message }, 500);
  }
  if (!updated) {
    return json({ error: "Nie znaleziono osoby" }, 404);
  }

  return json({ person: updated }, 200);
};

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return json({ error: "Unauthorized" }, 401);
  }
  const ownerId = context.locals.user.id;
  const personId = context.params.id;
  if (!personId) {
    return json({ error: "Brak identyfikatora osoby" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 503);
  }

  // The deactivate-before-delete rule is enforced here, independent of any
  // UI gating -- a direct DELETE against a still-active person must fail too.
  const { data: existing, error: readError } = await supabase
    .from("people")
    .select("status")
    .eq("id", personId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (readError) {
    return json({ error: readError.message }, 500);
  }
  if (!existing) {
    return json({ error: "Nie znaleziono osoby" }, 404);
  }
  if (existing.status !== "deactivated") {
    return json({ error: "Najpierw dezaktywuj tę osobę." }, 409);
  }

  // Scoped by owner_id in addition to RLS -- same 404-not-403 posture as PATCH.
  const { data: deleted, error: deleteError } = await supabase
    .from("people")
    .delete()
    .eq("id", personId)
    .eq("owner_id", ownerId)
    .select()
    .maybeSingle();

  if (deleteError) {
    return json({ error: deleteError.message }, 500);
  }
  if (!deleted) {
    return json({ error: "Nie znaleziono osoby" }, 404);
  }

  return json({}, 200);
};
