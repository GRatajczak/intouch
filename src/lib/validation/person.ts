import { z } from "zod";

export const RELATIONSHIP_TYPES = ["family", "friend", "colleague", "acquaintance", "other"] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const RELATIONSHIP_TYPE_LABELS: Record<RelationshipType, string> = {
  family: "Rodzina",
  friend: "Przyjaciel/Przyjaciółka",
  colleague: "Współpracownik/Współpracowniczka",
  acquaintance: "Znajomy/Znajoma",
  other: "Inne",
};

/**
 * Catalog-card color swatch per relationship type. Derived from the enum rather
 * than hashed from `id`, so every `family` card renders the same color. Values
 * are full Tailwind utility classes (not fragments) so the class scanner sees
 * them; the colors themselves come from the `--color-swatch-*` tokens.
 */
export const RELATIONSHIP_TYPE_SWATCH: Record<RelationshipType, string> = {
  family: "bg-swatch-family",
  friend: "bg-swatch-friend",
  colleague: "bg-swatch-colleague",
  acquaintance: "bg-swatch-acquaintance",
  other: "bg-swatch-other",
};

export const LAST_CONTACT_BUCKETS = ["this_month", "two_to_six_months", "over_six_months", "unknown"] as const;

export type LastContactBucket = (typeof LAST_CONTACT_BUCKETS)[number];

export const LAST_CONTACT_BUCKET_LABELS: Record<LastContactBucket, string> = {
  this_month: "W tym miesiącu",
  two_to_six_months: "2–6 miesięcy temu",
  over_six_months: "Ponad pół roku",
  unknown: "Nie pamiętam",
};

export const CONTEXT_TAGS_MAX = 5;

export const personSchema = z.object({
  name: z.string().trim().min(1, "Imię jest wymagane").max(100, "Imię jest za długie"),
  relationshipType: z.enum(RELATIONSHIP_TYPES, { message: "Wybierz typ relacji" }),
  description: z.string().trim().min(1, "Opis jest wymagany").max(500, "Opis jest za długi (maks. 500 znaków)"),
  isCollective: z.boolean(),
  weight: z.number().int().min(1, "Wybierz wagę relacji").max(10, "Wybierz wagę relacji"),
  relationshipContext: z.string().trim().max(100, "Za długie (maks. 100 znaków)").optional(),
  contextTags: z
    .array(z.string().trim().min(1).max(30, "Tag jest za długi (maks. 30 znaków)"))
    .max(CONTEXT_TAGS_MAX, `Maksymalnie ${String(CONTEXT_TAGS_MAX)} tagów`)
    .optional(),
  lastContactBucket: z.enum(LAST_CONTACT_BUCKETS, { message: "Wybierz jedną z opcji" }).optional(),
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

// The three new context fields are optional, so an empty/absent submission
// must parse as `undefined`, not `""` -- an empty string would otherwise
// fail `lastContactBucket`'s enum check and would persist a stray "" instead
// of `null` for `relationshipContext`.
function getOptionalString(form: FormData, field: string): string | undefined {
  const value = getString(form, field);
  return value.length > 0 ? value : undefined;
}

// Tags are submitted as repeated same-named inputs (`contextTags-${i}`
// appearing once per chip), read via `FormData.getAll` rather than `.get`.
function getTags(form: FormData, field: string): string[] | undefined {
  const values = form
    .getAll(field)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return values.length > 0 ? values : undefined;
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
      relationshipContext: getOptionalString(form, `relationshipContext-${i}`),
      contextTags: getTags(form, `contextTags-${i}`),
      lastContactBucket: getOptionalString(form, `lastContactBucket-${i}`),
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
    relationship_context: values_.relationshipContext ?? null,
    context_tags: values_.contextTags ?? [],
    last_contact_bucket: values_.lastContactBucket ?? null,
  }));
}
