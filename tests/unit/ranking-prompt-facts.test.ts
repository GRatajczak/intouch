// test-plan Phase 3, Risk #3 (narrow scope): regression-pins the
// feedback-triage-2026-09-08 fix -- the stale last_contact_bucket estimate
// must never reach the prompt alongside a real, fresher ContactFacts entry.
// Pure-function test against buildRankingPrompt: no fetch or Supabase stub.
import { describe, expect, it } from "vitest";
import { buildRankingPrompt } from "@/lib/ranking/prompt";
import type { ContactFacts } from "@/lib/contact-history/facts";
import { profileRow, personRow } from "../stubs/fake-ranking-supabase";

const STALE_ESTIMATE_LABEL = "Szacunek użytkownika sprzed rejestrowania kontaktów";

function noFacts(): ContactFacts {
  return {
    lastHappenedAt: null,
    daysSinceLastHappened: null,
    lastAttemptFailed: false,
    failedAttemptsSinceLastHappened: 0,
    recentNotes: [],
  };
}

describe("buildRankingPrompt: stale last_contact_bucket omission", () => {
  it("omits the stale estimate line when a real successful contact is on record", () => {
    const person = personRow({ last_contact_bucket: "over_six_months" });
    const facts = new Map<string, ContactFacts>([
      [person.id, { ...noFacts(), lastHappenedAt: "2026-09-01T00:00:00.000Z", daysSinceLastHappened: 5 }],
    ]);

    const { messages } = buildRankingPrompt(profileRow(), [person], facts);

    expect(messages[1]?.content).not.toContain(STALE_ESTIMATE_LABEL);
  });

  it("includes the estimate line when no facts entry exists at all (control)", () => {
    const person = personRow({ last_contact_bucket: "over_six_months" });
    const facts = new Map<string, ContactFacts>();

    const { messages } = buildRankingPrompt(profileRow(), [person], facts);

    expect(messages[1]?.content).toContain(STALE_ESTIMATE_LABEL);
  });

  it("includes the estimate line when facts exist but no successful contact has happened yet", () => {
    const person = personRow({ last_contact_bucket: "over_six_months" });
    const facts = new Map<string, ContactFacts>([
      [person.id, { ...noFacts(), lastAttemptFailed: true, failedAttemptsSinceLastHappened: 1 }],
    ]);

    const { messages } = buildRankingPrompt(profileRow(), [person], facts);

    expect(messages[1]?.content).toContain(STALE_ESTIMATE_LABEL);
  });
});
