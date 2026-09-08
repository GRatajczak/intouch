// The first test in test-plan.md's Risk #3 ("wrong order, not a failure"),
// whose §6.5 is still a TBD stub.
//
// Everything under test is a pure function, so this file needs none of the
// machinery the repo does not have: no fake timers, no OpenAI mock, no row
// factory. ContactFacts objects are built by hand for the same reason.
import { describe, it, expect } from "vitest";
import type { ContactFacts } from "@/lib/contact-history/facts";
import {
  applyRecencyFloor,
  buildRecencyFloorReason,
  sortByUrgency,
  NO_RUSH_MAX_DAYS,
  THIS_MONTH_MAX_DAYS,
} from "@/lib/ranking/recency-floor";
import type { TimeWindow } from "@/lib/validation/ranking";

function facts(over: Partial<ContactFacts> = {}): ContactFacts {
  return {
    lastHappenedAt: "2026-09-08T09:00:00Z",
    daysSinceLastHappened: 0,
    lastAttemptFailed: false,
    failedAttemptsSinceLastHappened: 0,
    recentNotes: [],
    ...over,
  };
}

describe("applyRecencyFloor", () => {
  describe("threshold table", () => {
    it.each([
      [0, "no_rush"],
      [1, "no_rush"],
      [NO_RUSH_MAX_DAYS, "no_rush"],
      [NO_RUSH_MAX_DAYS + 1, "this_month"],
      [5, "this_month"],
      [THIS_MONTH_MAX_DAYS, "this_month"],
    ])("caps a this_week entry at %s days to %s", (days, expected) => {
      const result = applyRecencyFloor("this_week", facts({ daysSinceLastHappened: days }));

      expect(result.timeWindow).toBe(expected);
      expect(result.applied).toBe(true);
    });

    it("stops applying past the last threshold", () => {
      const result = applyRecencyFloor("this_week", facts({ daysSinceLastHappened: THIS_MONTH_MAX_DAYS + 1 }));

      expect(result.timeWindow).toBe("this_week");
      expect(result.applied).toBe(false);
    });

    it("caps two_weeks to this_month inside the middle band", () => {
      const result = applyRecencyFloor("two_weeks", facts({ daysSinceLastHappened: 4 }));

      expect(result.timeWindow).toBe("this_month");
      expect(result.applied).toBe(true);
    });
  });

  describe("the floor is a lower bound on calm, never a setter", () => {
    it("leaves a window calmer than the floor untouched", () => {
      const result = applyRecencyFloor("no_rush", facts({ daysSinceLastHappened: 4 }));

      expect(result.timeWindow).toBe("no_rush");
      expect(result.applied).toBe(false);
      expect(result.reason).toBeNull();
    });

    it("leaves a window equal to the floor untouched", () => {
      const result = applyRecencyFloor("this_month", facts({ daysSinceLastHappened: 4 }));

      expect(result.timeWindow).toBe("this_month");
      expect(result.applied).toBe(false);
    });

    it("never raises urgency for a long silence", () => {
      const result = applyRecencyFloor("no_rush", facts({ daysSinceLastHappened: 300 }));

      expect(result.timeWindow).toBe("no_rush");
      expect(result.applied).toBe(false);
    });
  });

  describe("disqualifying conditions", () => {
    it("does nothing without facts", () => {
      const result = applyRecencyFloor("this_week", undefined);

      expect(result.timeWindow).toBe("this_week");
      expect(result.applied).toBe(false);
    });

    it("does nothing when no successful contact was ever recorded", () => {
      const result = applyRecencyFloor(
        "this_week",
        facts({ lastHappenedAt: null, daysSinceLastHappened: null, lastAttemptFailed: true }),
      );

      expect(result.timeWindow).toBe("this_week");
      expect(result.applied).toBe(false);
    });

    // "We spoke" and then "not yet" the same day -- exactly what the tester did.
    // That person became hard to reach, so cooling them down would be wrong.
    it("does nothing when a failed attempt followed the last successful contact", () => {
      const result = applyRecencyFloor(
        "this_week",
        facts({ daysSinceLastHappened: 0, lastAttemptFailed: true, failedAttemptsSinceLastHappened: 1 }),
      );

      expect(result.timeWindow).toBe("this_week");
      expect(result.applied).toBe(false);
    });
  });

  describe("the reason it substitutes", () => {
    it("is present exactly when the floor fired", () => {
      const fired = applyRecencyFloor("this_week", facts({ daysSinceLastHappened: 0 }));
      const untouched = applyRecencyFloor("no_rush", facts({ daysSinceLastHappened: 0 }));

      expect(fired.reason).not.toBeNull();
      expect(untouched.reason).toBeNull();
    });

    it.each([
      [0, "dzisiaj"],
      [1, "wczoraj"],
      [5, "5 dni temu"],
    ])("names the %s-day-old contact as %s", (days, phrase) => {
      const reason = buildRecencyFloorReason(facts({ daysSinceLastHappened: days }), "no_rush");

      expect(reason).toContain(phrase);
    });

    it("stays inside the 400-character CHECK on ranking_entries.reason", () => {
      for (const days of [0, 1, 2, 3, 6, 9999]) {
        for (const window of ["no_rush", "this_month"] as const) {
          expect(buildRecencyFloorReason(facts({ daysSinceLastHappened: days }), window).length).toBeLessThanOrEqual(
            400,
          );
        }
      }
    });
  });
});

describe("sortByUrgency", () => {
  const entry = (id: string, timeWindow: TimeWindow) => ({ id, timeWindow });

  it("orders windows from most to least urgent", () => {
    const sorted = sortByUrgency([
      entry("d", "no_rush"),
      entry("b", "two_weeks"),
      entry("a", "this_week"),
      entry("c", "this_month"),
    ]);

    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });

  // The stability is what limits how far this narrows S-03's "nothing about
  // the order is computed in code": inside one window the model still decides.
  it("keeps the model's order within one window", () => {
    const sorted = sortByUrgency([
      entry("first", "this_month"),
      entry("second", "this_month"),
      entry("urgent", "this_week"),
      entry("third", "this_month"),
    ]);

    expect(sorted.map((e) => e.id)).toEqual(["urgent", "first", "second", "third"]);
  });

  it("does not mutate its input", () => {
    const input = [entry("calm", "no_rush"), entry("urgent", "this_week")];
    sortByUrgency(input);

    expect(input.map((e) => e.id)).toEqual(["calm", "urgent"]);
  });
});
