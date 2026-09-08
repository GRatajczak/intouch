// The contract half of S-04's reminder email. What this file can prove is
// narrow on purpose: that every link points where it should, that sections
// appear and disappear with the data behind them, and that no domain is baked
// into the template.
//
// What it deliberately does NOT claim to prove is that the email *renders*
// correctly. lessons.md is explicit -- `astro check`, ESLint and a green build
// all passed while S-06 shipped three phases of CTAs rendering as plain text.
// The same trap exists in email HTML, where a styled <a> is the only thing
// standing between a button and a bare link. That is what the human look at
// `npm run render:email-preview` is for, and no assertion here substitutes.
import { describe, it, expect } from "vitest";
import type { Tables } from "@/db/database.types";
import type { RankingEntryViewModel } from "@/lib/ranking/store";
import { renderReminderEmail } from "@/lib/reminders/email";
import type { ReasonFactor } from "@/lib/reminders/select";

/** A sentinel origin: anything real leaking into the output shows up as a miss. */
const BASE_URL = "https://base.test";

function person(over: Partial<Tables<"people">> = {}): Tables<"people"> {
  return {
    id: "basia-id",
    owner_id: "owner-1",
    name: "Rodzina z gór",
    description: "Ciocia Basia, wujek Marek i dziadkowie",
    relationship_type: "family",
    relationship_context: null,
    context_tags: [],
    last_contact_bucket: null,
    is_collective: true,
    status: "active",
    weight: 9,
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function entry(over: Partial<RankingEntryViewModel> = {}): RankingEntryViewModel {
  return {
    id: "entry-1",
    rankPosition: 1,
    timeWindow: "this_week",
    reason: "Minął rok od ostatniej rozmowy.",
    contextNote: null,
    rhythmNote: null,
    person: person(),
    ...over,
  };
}

const FACTORS: ReasonFactor[] = [
  { kind: "weight", text: "Waga relacji 9 na 10" },
  { kind: "silence", text: "Cisza od 365 dni" },
];

function render(over: Partial<Parameters<typeof renderReminderEmail>[0]> = {}) {
  return renderReminderEmail({
    hero: entry(),
    queue: [],
    factors: FACTORS,
    profileName: "Anna",
    baseUrl: BASE_URL,
    ...over,
  });
}

/** Every href the template emitted. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

describe("renderReminderEmail", () => {
  describe("links", () => {
    it("builds every link from the supplied origin and hardcodes no domain", () => {
      // CLAUDE.md: the canonical domain is set in exactly one place (`site` in
      // astro.config.mjs) and must not be written anywhere else. An email is the
      // easiest place for that rule to be broken silently, because a wrong link
      // still renders perfectly and only fails once a real recipient clicks it.
      const { html } = render();
      const links = hrefs(html);

      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.startsWith(BASE_URL)).toBe(true);
      }
      expect(html).not.toContain("get-in-touch.pl");
      expect(html).not.toContain("workers.dev");
      expect(html).not.toContain("localhost");
    });

    it("points the primary call to action at the hero's own page", () => {
      const { html } = render({ hero: entry({ person: person({ id: "person-42" }) }) });

      expect(hrefs(html)).toContain(`${BASE_URL}/people/person-42`);
    });

    it("offers a route to the reminder settings", () => {
      // The footer promises the reader can change this. A promise with no link
      // behind it is worse than not making it -- unsubscribing is the one
      // control that has to work.
      expect(hrefs(render().html)).toContain(`${BASE_URL}/settings`);
    });
  });

  describe("sections follow the data", () => {
    it("names the hero in the subject", () => {
      const { subject } = render({ hero: entry({ person: person({ name: "Maciej" }) }) });

      expect(subject).toContain("Maciej");
    });

    it("lists every reason factor it was given", () => {
      const { html } = render();

      for (const factor of FACTORS) {
        expect(html).toContain(factor.text);
      }
    });

    it("shows the queue when there is one", () => {
      const { html } = render({
        queue: [
          entry({ rankPosition: 2, timeWindow: "two_weeks", person: person({ id: "m", name: "Maciej" }) }),
          entry({ rankPosition: 3, timeWindow: "this_month", person: person({ id: "k", name: "Kasia" }) }),
        ],
      });

      expect(html).toContain("Maciej");
      expect(html).toContain("Kasia");
    });

    it("omits the queue heading entirely when the queue is empty", () => {
      // A person with one relationship should not receive a section header with
      // nothing under it. Rendering an empty block is the default a template
      // falls into, which is exactly why it is worth pinning.
      expect(render({ queue: [] }).html).not.toContain("W kolejce");
    });

    it("addresses the reader by name when there is one", () => {
      expect(render({ profileName: "Anna" }).html).toContain("Anna");
    });

    it("leaves no dangling punctuation when there is no name", () => {
      // profiles.name is non-null in the schema but can be an empty string, and
      // a headline opening with ", " reads as broken software in an inbox.
      const { html } = render({ profileName: null });

      expect(html).not.toMatch(/>\s*,/);
      expect(html).not.toContain(", ,");
    });
  });

  it("escapes user-authored text instead of interpolating it raw", () => {
    // Names, descriptions and the model's reason are all free text the user or
    // the model wrote. Interpolating them into HTML unescaped breaks the email
    // on an innocent apostrophe or angle bracket, and hands anything worse a
    // direct path into the owner's inbox. The template is a string builder, so
    // nothing escapes for it.
    const { html, subject } = render({
      hero: entry({
        person: person({ name: '<script>alert("x")</script>' }),
        reason: "Ostatnio rozmawialiście <dawno> temu",
      }),
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;dawno&gt;");

    // The subject is deliberately NOT html-escaped: it is a MIME header, not
    // markup, so a person whose name contains an angle bracket should read as
    // itself in the inbox rather than as "&lt;". What a header cannot survive
    // is a line break, which splits it in two.
    expect(subject).toContain("<script>");
  });

  it("keeps the subject on a single line", () => {
    // A name is free text and can contain a newline. In a MIME header that ends
    // the Subject field and starts whatever follows as a new header.
    const { subject } = render({
      hero: entry({ person: person({ name: "Basia\r\nBcc: kto-inny@example.com" }) }),
    });

    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain("Basia");
  });
});
