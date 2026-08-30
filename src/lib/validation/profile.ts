import { z } from "zod";

const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Imię jest wymagane").max(100, "Imię jest za długie"),
  birthDate: z
    .string()
    .trim()
    .min(1, "Data urodzenia jest wymagana")
    .regex(BIRTH_DATE_PATTERN, "Podaj prawidłową datę")
    .refine((value) => new Date(value) <= new Date(), "Data urodzenia nie może być w przyszłości"),
  lifeContext: z
    .string()
    .trim()
    .min(1, "Opisz swój kontekst życiowy")
    .max(300, "Opis jest za długi (maks. 300 znaków)"),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

function getString(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
}

export function parseForm(form: FormData) {
  return profileSchema.safeParse({
    name: getString(form, "name"),
    birthDate: getString(form, "birthDate"),
    lifeContext: getString(form, "lifeContext"),
  });
}

export function toRow(values: ProfileFormValues, ownerId: string) {
  return {
    owner_id: ownerId,
    name: values.name,
    birth_date: values.birthDate,
    life_context: values.lifeContext,
  };
}
