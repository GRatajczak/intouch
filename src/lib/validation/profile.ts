import { z } from "zod";

const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Values and Polish labels for the "Twój rytm" section (slice S-09), derived
// from the onboarding card in
// .ai/intouch-design-preparation/project/InTouch.dc.html:105-128. These are
// the single source both the form and any future read-only display draw from.

export const WEEKLY_TIME_BUDGET_VALUES = ["under_1h", "hours_1_3", "over_3h"] as const;
export const WEEKLY_TIME_BUDGET_LABELS: Record<(typeof WEEKLY_TIME_BUDGET_VALUES)[number], string> = {
  under_1h: "Mniej niż godzinę",
  hours_1_3: "1–3 godziny",
  over_3h: "Więcej niż 3",
};
export const WEEKLY_TIME_BUDGET_OPTIONS = WEEKLY_TIME_BUDGET_VALUES.map((value) => ({
  value,
  label: WEEKLY_TIME_BUDGET_LABELS[value],
}));

export const PREFERRED_CHANNEL_VALUES = ["phone", "message", "in_person", "video"] as const;
export const PREFERRED_CHANNEL_LABELS: Record<(typeof PREFERRED_CHANNEL_VALUES)[number], string> = {
  phone: "Telefon",
  message: "Wiadomość",
  in_person: "Spotkanie na żywo",
  video: "Wideo",
};
export const PREFERRED_CHANNEL_OPTIONS = PREFERRED_CHANNEL_VALUES.map((value) => ({
  value,
  label: PREFERRED_CHANNEL_LABELS[value],
}));

export const AVAILABILITY_WINDOW_VALUES = ["weekday_morning", "weekday_evening", "weekend"] as const;
export const AVAILABILITY_WINDOW_LABELS: Record<(typeof AVAILABILITY_WINDOW_VALUES)[number], string> = {
  weekday_morning: "Rano w tygodniu",
  weekday_evening: "Wieczorem w tygodniu",
  weekend: "Weekend",
};
export const AVAILABILITY_WINDOW_OPTIONS = AVAILABILITY_WINDOW_VALUES.map((value) => ({
  value,
  label: AVAILABILITY_WINDOW_LABELS[value],
}));

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
  // Rhythm fields (S-09): optional -- absent is a valid "no answer" state, not
  // a validation failure. parseForm drops out-of-set values before this runs,
  // so these enums only ever see values already known to be valid.
  weeklyTimeBudget: z.enum(WEEKLY_TIME_BUDGET_VALUES).optional(),
  preferredChannels: z.array(z.enum(PREFERRED_CHANNEL_VALUES)).optional(),
  availabilityWindows: z.array(z.enum(AVAILABILITY_WINDOW_VALUES)).optional(),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

function getString(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
}

function getOptionalEnum<T extends string>(form: FormData, field: string, allowed: readonly T[]): T | undefined {
  const value = form.get(field);
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function getFilteredArray<T extends string>(form: FormData, field: string, allowed: readonly T[]): T[] {
  const allowedSet = new Set<string>(allowed);
  return form
    .getAll(field)
    .filter((value): value is string => typeof value === "string" && allowedSet.has(value)) as T[];
}

export function parseForm(form: FormData) {
  return profileSchema.safeParse({
    name: getString(form, "name"),
    birthDate: getString(form, "birthDate"),
    lifeContext: getString(form, "lifeContext"),
    weeklyTimeBudget: getOptionalEnum(form, "weeklyTimeBudget", WEEKLY_TIME_BUDGET_VALUES),
    preferredChannels: getFilteredArray(form, "preferredChannels", PREFERRED_CHANNEL_VALUES),
    availabilityWindows: getFilteredArray(form, "availabilityWindows", AVAILABILITY_WINDOW_VALUES),
  });
}

export function toRow(values: ProfileFormValues, ownerId: string) {
  return {
    owner_id: ownerId,
    name: values.name,
    birth_date: values.birthDate,
    life_context: values.lifeContext,
    weekly_time_budget: values.weeklyTimeBudget ?? null,
    preferred_channels: values.preferredChannels ?? [],
    availability_windows: values.availabilityWindows ?? [],
  };
}
