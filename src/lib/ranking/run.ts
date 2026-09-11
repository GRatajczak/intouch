import { zodTextFormat } from "openai/helpers/zod";
import { AuthenticationError, RateLimitError } from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/db/database.types";
import { createOpenAIClient } from "@/lib/openai";
import { resolveOwnerKey, type OwnerKey } from "@/lib/openai-key";
import { writeJob } from "@/lib/ai-jobs";
import { loadContactFacts, type ContactFacts } from "@/lib/contact-history/facts";
import { buildRankingPrompt } from "@/lib/ranking/prompt";
import { applyRecencyFloor, sortByUrgency } from "@/lib/ranking/recency-floor";
import { persistRanking, type PersistRankingEntry } from "@/lib/ranking/store";
import { rankingOutputSchema, type RankingOutputEntry, type TimeWindow } from "@/lib/validation/ranking";
import { capture, consentFromOptOut } from "@/lib/analytics";

// F-02's gpt-4o-mini was a throwaway ping choice it explicitly deferred to
// this slice. Named constant so the model is visible at a glance and never
// duplicated as a string literal elsewhere.
export const RANKING_MODEL = "gpt-5.4-mini";

/**
 * The ranking's people input: every ACTIVE person this owner has.
 *
 * Extracted from runRanking's Promise.all so the S-05 exclusion rule has one
 * named home instead of living as a bare `.eq()` inside a destructuring call.
 * That matters for proof, not for tidiness: tests/routes/erasure.test.ts asserts
 * a deactivated person never reaches the prompt, and the only way to assert that
 * without re-stating the filter -- i.e. without writing a test that stays green
 * when the filter is deleted -- is to call the app's own query. runRanking itself
 * cannot serve as that oracle here: it needs a live OpenAI client.
 */
export async function loadRankingPeople(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<Tables<"people">[] | null> {
  const { data } = await supabase.from("people").select("*").eq("owner_id", ownerId).eq("status", "active");
  return data;
}

const REASON_MAX_LENGTH = 400;
const CONTEXT_NOTE_MAX_LENGTH = 60;
const RHYTHM_NOTE_MAX_LENGTH = 60;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function truncateNullable(value: string | null, maxLength: number): string | null {
  return value === null ? null : truncate(value, maxLength);
}

export interface ReconcileResult {
  entries: PersistRankingEntry[];
  /** How many entries the recency floor overrode -- reported in the completion log. */
  flooredCount: number;
}

/**
 * Reconciles the model's entries against the people actually sent: drops any
 * id the model hallucinated -- never sent to it -- and appends any sent
 * person the model omitted, at the tail, in the weight order `peopleSent`
 * already carries. responses.parse() only validates shape, never referential
 * integrity: without this a hallucinated id becomes a foreign-key violation
 * at insert time, and a silently dropped person disappears from the user's
 * screen with no trace.
 *
 * It also enforces the recency floor (see recency-floor.ts) and returns the
 * entries ordered by urgency, so `rank_position` -- assigned by persistRanking
 * as the array index + 1 -- cannot contradict the window driving the card's
 * colour. Entries appended for people the model skipped are already `no_rush`,
 * the calmest window, so the floor never touches them and the stable sort
 * leaves them at the tail.
 */
function reconcileEntries(
  modelEntries: RankingOutputEntry[],
  peopleSent: { id: string }[],
  facts: Map<string, ContactFacts>,
): ReconcileResult {
  const sentIds = new Set(peopleSent.map((person) => person.id));
  const seen = new Set<string>();
  const reconciled: PersistRankingEntry[] = [];
  let flooredCount = 0;

  for (const entry of modelEntries) {
    if (!sentIds.has(entry.personId) || seen.has(entry.personId)) {
      continue;
    }
    seen.add(entry.personId);
    const floored = applyRecencyFloor(entry.timeWindow, facts.get(entry.personId));
    if (floored.applied) {
      flooredCount += 1;
    }
    reconciled.push({
      personId: entry.personId,
      timeWindow: floored.timeWindow,
      reason: truncate(floored.reason ?? entry.reason, REASON_MAX_LENGTH),
      contextNote: truncateNullable(entry.contextNote, CONTEXT_NOTE_MAX_LENGTH),
      rhythmNote: truncateNullable(entry.rhythmNote, RHYTHM_NOTE_MAX_LENGTH),
    });
  }

  const fallbackTimeWindow: TimeWindow = "no_rush";
  for (const person of peopleSent) {
    if (!seen.has(person.id)) {
      reconciled.push({
        personId: person.id,
        timeWindow: fallbackTimeWindow,
        reason: "Nie udało się wygenerować uzasadnienia dla tej osoby w tym przebiegu.",
        contextNote: null,
        rhythmNote: null,
      });
    }
  }

  return { entries: sortByUrgency(reconciled), flooredCount };
}

/**
 * Turns a caught error into the message written to the failed job.
 *
 * A rejection of the OWNER'S OWN key is the user's problem, not ours: name
 * which of the two OpenAI raised (rejected key vs. exhausted quota) so
 * /settings and the dashboard banner can say something actionable, in
 * Polish, and never quote the key itself. Every other error -- including a
 * user-key failure that is neither of those two classes -- falls through to
 * the vendor message unchanged, exactly as before S-17.
 */
function classifyRankingError(err: unknown, ownerKey: OwnerKey | undefined): string {
  if (ownerKey?.source === "user") {
    if (err instanceof AuthenticationError) {
      return "OpenAI odrzucił Twój klucz — sprawdź go w Ustawieniach i wklej ponownie.";
    }
    if (err instanceof RateLimitError) {
      return "Przekroczono limit Twojego klucza OpenAI — sprawdź swój plan i limity w OpenAI.";
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Records or clears whether the owner's OWN key is currently working.
 *
 * Never throws: a health-write failure must not turn a job that already
 * reached its terminal state (writeJob has already run by the time this is
 * called, in both branches) into an uncaught rejection in the background
 * task nothing is awaiting.
 */
async function writeKeyHealth(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  health: { failedAt: string; reason: "auth" | "quota" } | null,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("profiles")
      .update({
        openai_api_key_failed_at: health?.failedAt ?? null,
        openai_api_key_failure_reason: health?.reason ?? null,
      })
      .eq("owner_id", ownerId);
    if (error) {
      console.error(`[ranking] failed to write key health for owner ${ownerId}: ${error.message}`);
    }
  } catch (err: unknown) {
    console.error(
      `[ranking] failed to write key health for owner ${ownerId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * The background task: fetch inputs, call the model, reconcile, persist, and
 * report terminal status. Kept out of the route so the route stays a thin
 * auth-and-dispatch shell like ai-ping.ts. Every failure path is caught,
 * logged with a [ranking] prefix mirroring ai-ping.ts, and written as a
 * failed job -- nothing is written to `rankings` on failure, so the previous
 * ranking survives untouched.
 */
/**
 * Returns its terminal status -- the same value it writes to the KV job.
 *
 * S-04's sweep needs this: it must not send an email built from a ranking
 * whose refresh just failed, and the failure is otherwise invisible here
 * because every path is caught and reported as a job status rather than
 * thrown. Purely additive -- POST /api/rankings ignores the return value.
 */
export async function runRanking(
  ownerId: string,
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<"done" | "failed"> {
  const startedAt = Date.now();
  // Set before the OpenAI client exists, so the catch block below can tell a
  // user-key rejection apart from an app-key misconfiguration even when the
  // failure happens before ownerKey would otherwise be in scope.
  let ownerKey: OwnerKey | undefined;
  try {
    // Profile loads BEFORE the client is built -- S-17 inverted this order on
    // purpose, because the client now depends on the profile's key, not the
    // other way around. The "No profile found" throw below still fires before
    // any OpenAI call is attempted.
    const [{ data: profile }, people, facts] = await Promise.all([
      supabase.from("profiles").select("*").eq("owner_id", ownerId).maybeSingle(),
      loadRankingPeople(supabase, ownerId),
      // Never throws on its own -- a query failure folds to an empty map via
      // the same `data ?? []` fallback loadContactFacts already applies, so
      // a facts-load problem degrades to today's history-blind prompt rather
      // than failing the whole ranking.
      loadContactFacts(supabase, ownerId),
    ]);

    if (!profile) {
      throw new Error("No profile found for this account");
    }
    if (!people || people.length === 0) {
      throw new Error("No people found for this account");
    }

    ownerKey = await resolveOwnerKey(profile);
    const openai = createOpenAIClient(ownerKey.source === "user" ? ownerKey.apiKey : undefined);
    if (!openai) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const { messages, peopleIncluded } = buildRankingPrompt(profile, people, facts);

    // maxRetries: 0 -- a rejected or exhausted USER key must fail outright, on
    // the first call, never masked by the SDK's own retry-on-429 default. That
    // is what makes "no second call follows a user-key rejection" true rather
    // than merely likely.
    const response = await openai.responses.parse(
      {
        model: RANKING_MODEL,
        input: messages,
        text: { format: zodTextFormat(rankingOutputSchema, "ranking") },
      },
      { maxRetries: 0 },
    );

    const parsed = response.output_parsed;
    if (!parsed) {
      throw new Error("OpenAI response had no parsed output");
    }

    const { entries, flooredCount } = reconcileEntries(parsed.entries, peopleIncluded, facts);

    const rankingId = await persistRanking(supabase, {
      ownerId,
      model: RANKING_MODEL,
      peopleConsidered: peopleIncluded.length,
      peopleTotal: people.length,
      entries,
    });

    await writeJob(jobId, { status: "done", rankingId });

    // A successful run made with the owner's own key clears any earlier
    // rejection/quota mark -- the key works now, whatever it did before.
    // Sits after writeJob for the same reason the analytics capture below
    // does: never able to stop the job reaching "done".
    if (ownerKey.source === "user") {
      await writeKeyHealth(supabase, ownerId, null);
    }

    const durationMs = Date.now() - startedAt;

    // F-06 funnel step 4, at the point the hierarchy is TRUTHFULLY generated:
    // after persistRanking and after the job reaches its terminal state. POST
    // /api/rankings returns 202 long before this and means only "dispatched".
    //
    // A plain `await`, not dispatch(): this whole function already runs inside
    // rankings.ts's cfContext.waitUntil(), so there is no second deferral to
    // reach for and no cfContext in scope. It sits after writeJob so a capture
    // can never stop the job reaching "done" -- though capture() also never
    // throws.
    //
    // PRIVACY: this is the densest third-party-PII scope in the repo. `profile`,
    // `people`, `facts`, `messages` (the literal prompt), `response` (raw model
    // output) and `entries[].reason` are all in scope here and NONE of them may
    // be referenced below. The event catalog makes that a type error; this
    // comment is here so a reader checks it deliberately anyway.
    //
    // Consent comes from the already-loaded profile row -- no second query.
    if (consentFromOptOut(profile.analytics_opt_out)) {
      await capture(ownerId, {
        event: "hierarchy_generated",
        properties: {
          model: RANKING_MODEL,
          people_total: people.length,
          people_considered: peopleIncluded.length,
          duration_ms: durationMs,
        },
      });
    }

    // Without this the happy path is invisible in `wrangler tail` -- mirrors
    // ai-ping.ts's own completion log. Shares `durationMs` with the event above
    // so the two never disagree. Key source is here too, so `wrangler tail`
    // shows whose key paid for the run.
    console.log(
      `[ranking] job ${jobId} done in ${String(durationMs)}ms, source=${ownerKey.source}, recency floor applied to ${String(flooredCount)} entries`,
    );
    return "done";
  } catch (err: unknown) {
    const message = classifyRankingError(err, ownerKey);
    console.error(`[ranking] job ${jobId} failed: ${message}`);
    await writeJob(jobId, { status: "failed", error: message });

    // Marks the owner's OWN key as needing attention -- OUR fault getting a
    // decryption failure wrong is Phase 2's concern (silent app-key fallback,
    // no mark); this is the user's key genuinely being rejected or exhausted.
    // Sits after writeJob for the same never-block-the-terminal-state reason
    // as the success branch's clear above.
    if (ownerKey?.source === "user") {
      if (err instanceof AuthenticationError) {
        await writeKeyHealth(supabase, ownerId, { failedAt: new Date().toISOString(), reason: "auth" });
      } else if (err instanceof RateLimitError) {
        await writeKeyHealth(supabase, ownerId, { failedAt: new Date().toISOString(), reason: "quota" });
      }
    }

    return "failed";
  }
}
