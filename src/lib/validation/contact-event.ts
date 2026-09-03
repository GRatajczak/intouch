import { z } from "zod";

export const CONTACT_EVENT_OUTCOMES = ["happened", "not_yet"] as const;

export type ContactEventOutcome = (typeof CONTACT_EVENT_OUTCOMES)[number];

export const CONTACT_EVENT_OUTCOME_LABELS: Record<ContactEventOutcome, string> = {
  happened: "Tak, rozmawialiśmy",
  not_yet: "Jeszcze nie",
};

const NOTE_MAX_LENGTH = 200;

export const createContactEventSchema = z.object({
  personId: z.string().trim().min(1, "Brak identyfikatora osoby"),
  outcome: z.enum(CONTACT_EVENT_OUTCOMES, { message: "Wybierz odpowiedź" }),
  note: z.string().trim().max(NOTE_MAX_LENGTH, "Notatka jest za długa (maks. 200 znaków)").nullable().optional(),
  rankingEntryId: z.string().trim().min(1).nullable().optional(),
});

export type CreateContactEventValues = z.infer<typeof createContactEventSchema>;

export const updateContactEventSchema = z.object({
  outcome: z.enum(CONTACT_EVENT_OUTCOMES, { message: "Wybierz odpowiedź" }).optional(),
  note: z.string().trim().max(NOTE_MAX_LENGTH, "Notatka jest za długa (maks. 200 znaków)").nullable().optional(),
});

export type UpdateContactEventValues = z.infer<typeof updateContactEventSchema>;
