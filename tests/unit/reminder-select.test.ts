// S-04's cadence rules, and test-plan.md Risk #7 ("the sweep sends more than
// once a day, sends to the wrong recipient, fails silently").
//
// Everything under test is a pure function over data the sweep has already
// loaded -- a ranking, its entries, and the per-person contact facts. No
// clock, no database, no Resend. That is deliberate: the cooldown and the
// send log live in SQL (20260908090338_create_reminder_sends.sql, proven by
// tests/rls/reminder-rpc.test.ts), and what is left here is the part that
// decides *whether there is anything worth saying* and *about whom*.
//
// Follows tests/unit/recency-floor.test.ts: hand-built objects, no fixtures,
// one it.each table per property.
import { describe, it, expect } from "vitest";
import type { Tables } from "@/db/database.types";
import type { ContactFacts } from "@/lib/contact-history/facts";
import type { RankingEntryViewModel, RankingViewModel } from "@/lib/ranking/store";
import type { TimeWindow } from "@/lib/validation/ranking";
import { buildReasonFactors, selectHero } from "@/lib/reminders/select";

const RANKING_CREATED_AT = "2026-09-08T06:00:00.000Z";

function person(over: Partial<Tables<"people">> = {}): Tables<"people"> {
  return {
    id: "person-1",
    owner_id: "owner-1",
    name: "Basia",
    description: "Ciocia z gór",
    relationship_type: "family",
    relationship_context: null,
    context_tags: [],
    last_contact_bucket: null,
    is_collective: false,
    status: "active",
    weight: 8,
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function entry(over: Partial<RankingEntryViewModel> = {}): RankingEntryViewModel {
  return {
    id: `entry-${over.rankPosition?.toString() ?? "1"}`,
    rankPosition: 1,
    timeWindow: "this_week",
    reason: "Minął rok od ostatniej rozmowy.",
    contextNote: null,
    rhythmNote: null,
    person: person(),
    ...over,
  };
}

/**
 * Entries arrive already ordered by urgency -- run.ts runs sortByUrgency before
 * persistRanking, and rank_position is the array index + 1. So "top of the
 * ranking" and "most urgent" are the same thing here, and selectHero walks the
 * list in order rather than re-deriving urgency.
 */
function ranking(entries: RankingEntryViewModel[]): RankingViewModel {
  return {
    id: "ranking-1",
    createdAt: RANKING_CREATED_AT,
    model: "gpt-5.4-mini",
    peopleConsidered: entries.length,
    peopleTotal: entries.length,
    entries,
  };
}

function facts(over: Partial<ContactFacts> = {}): ContactFacts {
  return {
    lastHappenedAt: null,
    daysSinceLastHappened: null,
    lastAttemptFailed: false,
    failedAttemptsSinceLastHappened: 0,
    recentNotes: [],
    ...over,
  };
}

describe("selectHero", () => {
  describe("silence is a valid outcome", () => {
    // The whole point of "decay-driven": an email goes out because a
    // relationship has actually gone quiet, not because a day has passed. A
    // rule that always found someone to nudge would be the calendar reminder
    // the vision statement explicitly rejects.
    it.each([
      ["every entry is this_month", ["this_month", "this_month"]],
      ["every entry is no_rush", ["no_rush", "no_rush"]],
      ["the calm windows are mixed", ["this_month", "no_rush"]],
    ])("returns null when %s", (_label, windows) => {
      const entries = (windows as TimeWindow[]).map((timeWindow, index) =>
        entry({ rankPosition: index + 1, timeWindow, person: person({ id: `person-${(index + 1).toString()}` }) }),
      );

      expect(selectHero(ranking(entries), new Map())).toBeNull();
    });

    it("returns null for a ranking with no entries at all", () => {
      expect(selectHero(ranking([]), new Map())).toBeNull();
    });
  });

  it("picks the most urgent entry as the hero", () => {
    const result = selectHero(
      ranking([
        entry({ rankPosition: 1, timeWindow: "this_week", person: person({ id: "basia", name: "Basia" }) }),
        entry({ rankPosition: 2, timeWindow: "two_weeks", person: person({ id: "maciej", name: "Maciej" }) }),
        entry({ rankPosition: 3, timeWindow: "this_month", person: person({ id: "kasia", name: "Kasia" }) }),
      ]),
      new Map(),
    );

    expect(result?.hero.person.name).toBe("Basia");
  });

  it("carries the next two entries as the queue, whatever their window", () => {
    // The design's "W kolejce, ale bez pośpiechu" list. It is deliberately not
    // filtered by urgency: its job is to show the app is watching more than one
    // relationship, so a calm entry belongs there.
    const result = selectHero(
      ranking([
        entry({ rankPosition: 1, timeWindow: "this_week", person: person({ id: "basia" }) }),
        entry({ rankPosition: 2, timeWindow: "two_weeks", person: person({ id: "maciej" }) }),
        entry({ rankPosition: 3, timeWindow: "no_rush", person: person({ id: "kasia" }) }),
        entry({ rankPosition: 4, timeWindow: "no_rush", person: person({ id: "olek" }) }),
      ]),
      new Map(),
    );

    expect(result?.queue.map((item) => item.person.id)).toEqual(["maciej", "kasia"]);
  });

  it("leaves the queue empty when the hero is the only entry", () => {
    const result = selectHero(ranking([entry({ timeWindow: "this_week" })]), new Map());

    expect(result?.queue).toEqual([]);
  });

  it("skips a deactivated person and promotes the next urgent one", () => {
    // FR-005: a deactivated person is excluded from AI consideration while
    // their history is retained. A ranking computed before the deactivation
    // still lists them, so the sweep must not resurrect them by email.
    const result = selectHero(
      ranking([
        entry({
          rankPosition: 1,
          timeWindow: "this_week",
          person: person({ id: "basia", status: "deactivated" }),
        }),
        entry({ rankPosition: 2, timeWindow: "two_weeks", person: person({ id: "maciej" }) }),
      ]),
      new Map(),
    );

    expect(result?.hero.person.id).toBe("maciej");
  });

  describe("someone already dealt with is not the hero", () => {
    it("skips a person confirmed as contacted after the ranking was computed", () => {
      // The user acted on the suggestion but the ranking has not been recomputed
      // yet. Emailing them about it would be the app failing to notice what the
      // user just told it -- the exact staleness S-03 exists to remove.
      const result = selectHero(
        ranking([
          entry({ rankPosition: 1, timeWindow: "this_week", person: person({ id: "basia" }) }),
          entry({ rankPosition: 2, timeWindow: "two_weeks", person: person({ id: "maciej" }) }),
        ]),
        new Map([["basia", facts({ lastHappenedAt: "2026-09-08T07:30:00.000Z", daysSinceLastHappened: 0 })]]),
      );

      expect(result?.hero.person.id).toBe("maciej");
    });

    it("still nudges a person whose last contact predates the ranking", () => {
      // The mirror case, and the one that would break if the comparison were
      // written as "has any successful contact". The ranking already knew about
      // this contact and ranked them urgent anyway -- that judgement stands.
      const result = selectHero(
        ranking([entry({ rankPosition: 1, timeWindow: "this_week", person: person({ id: "basia" }) })]),
        new Map([["basia", facts({ lastHappenedAt: "2026-09-01T10:00:00.000Z", daysSinceLastHappened: 7 })]]),
      );

      expect(result?.hero.person.id).toBe("basia");
    });
  });
});

describe("buildReasonFactors", () => {
  const kinds = (hero: RankingEntryViewModel, f?: ContactFacts): string[] =>
    buildReasonFactors(hero, f).map((factor) => factor.kind);

  it("states the relationship weight against the 1-10 scale the product actually uses", () => {
    // The design mock says "Waga relacji 5 na 5". The shipped scale is 1-10
    // (FR-004; person.ts caps at 10). lessons.md records S-06 shipping a
    // transcription error from this same file, so the oracle here is the
    // requirement and the schema, never the mock.
    const [weight] = buildReasonFactors(entry({ person: person({ weight: 8 }) }), undefined);

    expect(weight.kind).toBe("weight");
    expect(weight.text).toContain("8");
    expect(weight.text).toContain("10");
    expect(weight.text).not.toContain("na 5");
  });

  it("omits the silence bullet for a person with no recorded contact", () => {
    // facts.ts keeps a person with no events OUT of the map rather than in it
    // with zeroed fields, precisely so callers can tell "never contacted" from
    // "contacted zero days ago". Rendering "Cisza od 0 dni" for someone the
    // user has never logged would be a confident statement about nothing.
    expect(kinds(entry(), undefined)).not.toContain("silence");
  });

  it("includes the silence bullet once there is a successful contact to measure from", () => {
    const factors = buildReasonFactors(
      entry(),
      facts({ lastHappenedAt: "2025-09-08T10:00:00.000Z", daysSinceLastHappened: 365 }),
    );

    expect(factors.map((factor) => factor.kind)).toContain("silence");
    expect(factors.find((factor) => factor.kind === "silence")?.text).toContain("365");
  });

  it.each([
    ["a failed previous attempt is called out", true, true],
    ["no failed attempt stays quiet about it", false, false],
  ])("%s", (_label, lastAttemptFailed, expected) => {
    const result = kinds(entry(), facts({ lastAttemptFailed })).includes("failed_attempt");

    expect(result).toBe(expected);
  });

  it("includes the rhythm bullet only when S-09's optional fields produced one", () => {
    // The rhythm fields are optional by design (FR-002, amended 2026-08-31): a
    // profile filled before they existed stays valid, so FR-007 -- and this --
    // must degrade to saying nothing rather than inventing a channel.
    expect(kinds(entry({ rhythmNote: null }))).not.toContain("rhythm");
    expect(kinds(entry({ rhythmNote: "rozmowa telefoniczna w weekend" }))).toContain("rhythm");
  });

  it("orders the bullets as the design lays them out", () => {
    const factors = kinds(
      entry({ rhythmNote: "rozmowa telefoniczna w weekend" }),
      facts({ lastHappenedAt: "2025-09-08T10:00:00.000Z", daysSinceLastHappened: 365, lastAttemptFailed: true }),
    );

    expect(factors).toEqual(["weight", "silence", "failed_attempt", "rhythm"]);
  });
});
