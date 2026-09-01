import type { Tables } from "@/db/database.types";
import { RELATIONSHIP_TYPE_LABELS, type RelationshipType } from "@/lib/validation/person";
import {
  WEEKLY_TIME_BUDGET_LABELS,
  PREFERRED_CHANNEL_LABELS,
  AVAILABILITY_WINDOW_LABELS,
  WEEKLY_TIME_BUDGET_VALUES,
  PREFERRED_CHANNEL_VALUES,
  AVAILABILITY_WINDOW_VALUES,
} from "@/lib/validation/profile";

type WeeklyTimeBudget = (typeof WEEKLY_TIME_BUDGET_VALUES)[number];
type PreferredChannel = (typeof PREFERRED_CHANNEL_VALUES)[number];
type AvailabilityWindow = (typeof AVAILABILITY_WINDOW_VALUES)[number];

// Highest weight first, then truncated. The model must see -- and rank -- every
// person sent, so the cap decides who is sent, never who is dropped afterward.
export const PEOPLE_CAP = 50;

export interface RankingPromptMessage {
  role: "system" | "user";
  content: string;
}

export interface RankingPromptResult {
  messages: RankingPromptMessage[];
  peopleIncluded: Tables<"people">[];
}

function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

function hasRhythmData(profile: Tables<"profiles">): boolean {
  return (
    profile.weekly_time_budget !== null ||
    profile.preferred_channels.length > 0 ||
    profile.availability_windows.length > 0
  );
}

function buildSystemMessage(rhythmIncluded: boolean): string {
  const lines = [
    "Jesteś asystentem InTouch, który pomaga użytkownikowi ustalić kolejność, w jakiej powinien odezwać się do bliskich osób.",
    "Dla KAŻDEJ osoby z listy zwróć dokładnie jeden wpis w polu entries, identyfikowany przez personId -- żadna osoba nie może zostać pominięta ani zdublowana, a personId musi być dokładnie jednym z id podanych w danych wejściowych.",
    "Uszereguj listę od najpilniejszej do najmniej pilnej potrzeby kontaktu, opierając się przede wszystkim na wadze relacji (weight, skala 1-10, gdzie 10 to najważniejsza relacja) oraz na opisie osoby.",
    "Gdy dwie osoby mają tę samą wagę, rozstrzygnij kolejność na podstawie kontekstu z ich opisów -- nigdy losowo ani dowolnie -- i nazwij ten kontekst w uzasadnieniu.",
    "Dla każdej osoby wybierz timeWindow z zamkniętego zbioru wartości: this_week, two_weeks, this_month, no_rush.",
    'Pole reason napisz po polsku, zwracając się bezpośrednio do użytkownika (per "Ty"), maksymalnie kilka zdań, i opieraj się WYŁĄCZNIE na faktach obecnych w danych wejściowych -- nie wymyślaj dat, historii kontaktu ani żadnych szczegółów, których nie podano.',
    "Pole contextNote to opcjonalna krótka etykieta (maksymalnie kilka słów) podsumowująca kluczowy kontekst z opisu osoby, albo null, jeśli nic konkretnego się nie wyróżnia.",
  ];

  lines.push(
    rhythmIncluded
      ? "Pole rhythmNote to opcjonalna krótka etykieta (maksymalnie kilka słów) łącząca podany niżej rytm kontaktu użytkownika z tą konkretną osobą, albo null, jeśli rytm nie ma znaczenia dla tej osoby."
      : "Użytkownik nie podał swojego rytmu kontaktu -- pole rhythmNote MUSI być null dla każdej osoby, bez wyjątku. Nie zgaduj ani nie zakładaj żadnego rytmu.",
  );

  return lines.join(" ");
}

function buildProfileSection(profile: Tables<"profiles">, rhythmIncluded: boolean): string {
  const lines = [
    `Imię: ${profile.name}`,
    `Wiek: ${String(calculateAge(profile.birth_date))}`,
    `Kontekst życiowy: ${profile.life_context}`,
  ];

  if (rhythmIncluded) {
    lines.push("Rytm kontaktu:");
    if (profile.weekly_time_budget) {
      const budget = profile.weekly_time_budget as WeeklyTimeBudget;
      lines.push(`- Czas tygodniowo na kontakty: ${WEEKLY_TIME_BUDGET_LABELS[budget]}`);
    }
    if (profile.preferred_channels.length > 0) {
      const channels = profile.preferred_channels as PreferredChannel[];
      lines.push(`- Preferowane kanały: ${channels.map((c) => PREFERRED_CHANNEL_LABELS[c]).join(", ")}`);
    }
    if (profile.availability_windows.length > 0) {
      const windows = profile.availability_windows as AvailabilityWindow[];
      lines.push(`- Dostępność: ${windows.map((w) => AVAILABILITY_WINDOW_LABELS[w]).join(", ")}`);
    }
  }

  return lines.join("\n");
}

function buildPeopleSection(people: Tables<"people">[]): string {
  return people
    .map((person) => {
      const relationshipType = RELATIONSHIP_TYPE_LABELS[person.relationship_type as RelationshipType];
      const collective = person.is_collective ? " (grupa)" : "";
      return [
        `- id: ${person.id}`,
        `  Imię: ${person.name}${collective}`,
        `  Relacja: ${relationshipType}`,
        `  Waga: ${String(person.weight)}/10`,
        `  Opis: ${person.description}`,
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * Turns a profile row and a people list into the messages sent to the model.
 * Applies the PEOPLE_CAP truncation and the rhythm-omission rule: the rhythm
 * block is present only when the profile has at least one rhythm field set,
 * and the system message forces rhythmNote to null when it is absent rather
 * than defaulting it -- a model told "no stated preference" would otherwise
 * still produce a confident-sounding claim grounded in nothing.
 */
export function buildRankingPrompt(profile: Tables<"profiles">, people: Tables<"people">[]): RankingPromptResult {
  const peopleIncluded = [...people].sort((a, b) => b.weight - a.weight).slice(0, PEOPLE_CAP);
  const rhythmIncluded = hasRhythmData(profile);

  const userContent = [
    "Profil użytkownika:",
    buildProfileSection(profile, rhythmIncluded),
    "",
    "Osoby do uszeregowania:",
    buildPeopleSection(peopleIncluded),
  ].join("\n");

  return {
    messages: [
      { role: "system", content: buildSystemMessage(rhythmIncluded) },
      { role: "user", content: userContent },
    ],
    peopleIncluded,
  };
}
