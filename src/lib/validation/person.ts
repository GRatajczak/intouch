import { z } from "zod";

export const RELATIONSHIP_TYPES = ["family", "friend", "colleague", "acquaintance", "other"] as const;

export const personSchema = z.object({
  name: z.string().trim().min(1, "Imię jest wymagane").max(100, "Imię jest za długie"),
  relationshipType: z.enum(RELATIONSHIP_TYPES, { message: "Wybierz typ relacji" }),
  description: z.string().trim().min(1, "Opis jest wymagany").max(500, "Opis jest za długi (maks. 500 znaków)"),
  isCollective: z.boolean(),
  weight: z.number().int().min(1, "Wybierz wagę relacji").max(10, "Wybierz wagę relacji"),
});

export const peopleFormSchema = z.array(personSchema).min(1, "Dodaj przynajmniej jedną osobę");

export type PersonFormValues = z.infer<typeof personSchema>;

function getString(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
}

function getNumber(form: FormData, field: string): number {
  const value = form.get(field);
  return typeof value === "string" ? Number(value) : NaN;
}

/**
 * Rows are submitted as indexed fields (`name-0`, `name-1`, ...) since this is
 * a native multipart form POST, not JSON. Reads rows until an index's `name-i`
 * field is missing.
 */
export function parseForm(form: FormData) {
  const rows: unknown[] = [];
  for (let i = 0; form.has(`name-${i}`); i++) {
    rows.push({
      name: getString(form, `name-${i}`),
      relationshipType: getString(form, `relationshipType-${i}`),
      description: getString(form, `description-${i}`),
      isCollective: form.get(`isCollective-${i}`) === "true",
      weight: getNumber(form, `weight-${i}`),
    });
  }
  return peopleFormSchema.safeParse(rows);
}

export function toRows(values: PersonFormValues[], ownerId: string) {
  return values.map((values_) => ({
    owner_id: ownerId,
    name: values_.name,
    relationship_type: values_.relationshipType,
    description: values_.description,
    is_collective: values_.isCollective,
    weight: values_.weight,
  }));
}
