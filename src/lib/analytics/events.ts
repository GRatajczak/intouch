// The event catalog -- and the privacy guarantee of this whole module.
//
// `capture()` accepts only a member of the `AnalyticsEvent` union below, so
// there is no free-form property object anywhere in the call path. That matters
// most at the step-4 emission point (src/lib/ranking/run.ts), which sits in the
// densest third-party-PII scope in the repo: the people array, the literal
// OpenAI prompt and the raw model output are all in that one lexical scope. A
// closed union makes the unsafe call a type error rather than a code-review
// catch.
//
// THE RULE FOR EXTENDING THIS FILE:
//
//   A property may be added here only if it CANNOT identify or describe a
//   third party.
//
// Concretely, none of these may ever appear in a payload: a person's `name`,
// `description`, `relationship_context`, `tags` or `last_contact_bucket`; the
// user's email; any free text the user or the model wrote; and any `person_id`
// (a stable identifier that joins straight back to `name` and `description`).
// Presence booleans and counts are fine -- they describe the shape of what the
// user did, not who anyone is.
//
// The full catalog, with each event's emission point and gating condition, is
// documented in context/changes/product-analytics-posthog/event-catalog.md.

/**
 * Step 1 of the PRD's primary funnel: an account was created.
 *
 * Named `_started`, not `_completed`, on purpose: production requires email
 * confirmation, and this fires before it. So the count knowingly includes
 * accounts that are never confirmed, and the event name says so rather than
 * hiding the caveat in a dashboard footnote.
 */
interface SignupStarted {
  event: "signup_started";
  properties?: never;
}

/**
 * Step 2: the self-profile was filled for the first time.
 *
 * The plan also specified `has_life_context` and `has_birth_date` presence
 * booleans. They are deliberately absent: `profileSchema` in
 * src/lib/validation/profile.ts requires both fields (`.min(1, ...)`), so the
 * route 400s before the upsert if either is empty and both booleans would be
 * a constant `true` on every event ever sent -- a property of the schema, not
 * of user behaviour, that would read in a PostHog breakdown as a real 100%.
 * Re-add them only if those fields ever become optional.
 */
interface ProfileCompleted {
  event: "profile_completed";
  properties: {
    /**
     * How many preferred channels were picked. The enum VALUES stay out: which
     * channels a person prefers is a personal attribute, and the count is what
     * a funnel analysis actually reads.
     */
    rhythm_channels_count: number;
    /** How many availability windows were picked. Same reasoning as above. */
    rhythm_slots_count: number;
  };
}

/** Step 3: the user went from zero people to some. */
interface FirstPersonAdded {
  event: "first_person_added";
  properties: {
    /**
     * How many people arrived in the submit that crossed zero. The route is a
     * batch insert, so "first person" may in truth be "first N in one submit"
     * -- this records which, without naming any of them.
     */
    people_added: number;
  };
}

/** Step 4: a hierarchy was generated AND persisted (not merely dispatched). */
interface HierarchyGenerated {
  event: "hierarchy_generated";
  properties: {
    /** The OpenAI model id, e.g. the RANKING_MODEL constant. Identifies nothing. */
    model: string;
    /** How many people the owner has. */
    people_total: number;
    /** How many of them the prompt actually considered after filtering. */
    people_considered: number;
    /** Wall-clock duration of the whole deferred ranking run. */
    duration_ms: number;
  };
}

/**
 * Step 5, the funnel's terminal step: a suggested contact was confirmed as
 * having happened. Gated on `outcome === "happened"` at the call site --
 * `"not_yet"` is a different answer and gets no event.
 */
interface ContactConfirmed {
  event: "contact_confirmed";
  properties: {
    /** Whether a note was written -- never the note text. */
    has_note: boolean;
    /**
     * Whether the confirmation came from an AI suggestion (`rankingEntryId !==
     * null`) rather than a free-standing log. This is the Guardrail
     * "confirmed-vs-dismissed per generated hierarchy" signal.
     */
    from_suggestion: boolean;
  };
}

/**
 * The closed set of events this app may send. Exactly the five steps of the
 * PRD's Success Criteria funnel -- no more. F-06's own risk note names
 * instrumentation sprawl as one of its two real risks, so a sixth event is a
 * product decision, not a convenience.
 */
export type AnalyticsEvent =
  | SignupStarted
  | ProfileCompleted
  | FirstPersonAdded
  | HierarchyGenerated
  | ContactConfirmed;

/** The event names, for readers and for anything that needs the literal union. */
export type AnalyticsEventName = AnalyticsEvent["event"];
