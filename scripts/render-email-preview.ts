// Renders the reminder email to a local file so a human can look at it.
//
// This exists because no automated check in this repo can tell you an email
// looks right. lessons.md records S-06 shipping three phases of CTAs that
// rendered as plain text while `astro check`, ESLint and the build all passed;
// email HTML has the same trap with a sharper edge, since mail clients strip
// <style> blocks entirely. Open the output, look at it, and check it on a
// phone-width window before trusting any of it.
//
// Usage: npm run render:email-preview
import { writeFileSync } from "node:fs";
import { renderEmailShell } from "../src/lib/email/shell";
import { renderReminderEmail } from "../src/lib/reminders/email";
import type { RankingEntryViewModel } from "../src/lib/ranking/store";
import type { ReasonFactor } from "../src/lib/reminders/select";
import type { Tables } from "../src/db/database.types";

// Not the production origin: a preview that hardcoded the real domain would
// hide exactly the bug the unit test guards against.
const BASE_URL = "https://preview.local";

function person(id: string, name: string, weight: number): Tables<"people"> {
  return {
    id,
    owner_id: "preview-owner",
    name,
    description: "Podgląd lokalny",
    relationship_type: "family",
    relationship_context: null,
    context_tags: [],
    last_contact_bucket: null,
    is_collective: false,
    status: "active",
    weight,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function entry(
  rankPosition: number,
  timeWindow: RankingEntryViewModel["timeWindow"],
  personRow: Tables<"people">,
  reason: string,
  rhythmNote: string | null = null,
): RankingEntryViewModel {
  return {
    id: `preview-entry-${String(rankPosition)}`,
    rankPosition,
    timeWindow,
    reason,
    contextNote: null,
    rhythmNote,
    person: personRow,
  };
}

// All four factor kinds at once, so the preview shows every dot colour rather
// than only the two a typical person produces.
const factors: ReasonFactor[] = [
  { kind: "weight", text: "Waga relacji 9 na 10" },
  { kind: "silence", text: "Cisza od 365 dni" },
  { kind: "failed_attempt", text: "Poprzednia próba kontaktu nie doszła do skutku" },
  { kind: "rhythm", text: "Twój rytm: rozmowa telefoniczna w weekend" },
];

const reminder = renderReminderEmail({
  hero: entry(
    1,
    "this_week",
    person("preview-basia", "Rodzina z gór", 9),
    "Minął rok od ostatniej rozmowy z ciocią Basią, wujkiem Markiem i dziadkami. To relacja, którą oznaczyłaś jako najważniejszą, a poprzednia próba kontaktu nie doszła do skutku.",
    "rozmowa telefoniczna w weekend",
  ),
  queue: [
    entry(2, "two_weeks", person("preview-maciej", "Maciej", 7), "—"),
    entry(3, "this_month", person("preview-kasia", "Kasia", 5), "—"),
  ],
  factors,
  profileName: "Anna",
  baseUrl: BASE_URL,
});

writeFileSync("email-preview.html", reminder.html);

// The chrome-only shell F-04 proved, kept so a change to the wrapper can be
// eyeballed without the reminder body on top of it.
writeFileSync(
  "email-preview-shell.html",
  renderEmailShell({
    subject: "InTouch — sprawdzenie ścieżki dostarczania",
    bodyHtml: `<p>To jest testowa wiadomość potwierdzająca, że Worker InTouch potrafi wysłać e-mail z zaplanowanego triggera.</p>`,
    footerNote:
      "To jest testowa wiadomość ze ścieżki dostarczania InTouch — nie zawiera jeszcze prawdziwych przypomnień.",
  }),
);

console.log(`Subject: ${reminder.subject}`);
console.log("Written to email-preview.html and email-preview-shell.html");
