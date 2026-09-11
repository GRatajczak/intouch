import { z } from "zod";

const MIN_PASSWORD_LENGTH = 6;

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Podaj obecne hasło"),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH, `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków`),
    confirmPassword: z.string().min(1, "Potwierdź nowe hasło"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Hasła nie są takie same",
    path: ["confirmPassword"],
  });

export type PasswordChangeValues = z.infer<typeof passwordChangeSchema>;

function getString(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
}

export function parsePasswordChangeForm(form: FormData) {
  return passwordChangeSchema.safeParse({
    currentPassword: getString(form, "currentPassword"),
    newPassword: getString(form, "newPassword"),
    confirmPassword: getString(form, "confirmPassword"),
  });
}

export const emailChangeSchema = z.object({
  newEmail: z.string().trim().min(1, "Podaj adres e-mail").pipe(z.email("Podaj prawidłowy adres e-mail")),
});

export type EmailChangeValues = z.infer<typeof emailChangeSchema>;

export function parseEmailChangeForm(form: FormData) {
  return emailChangeSchema.safeParse({
    newEmail: getString(form, "newEmail"),
  });
}

// S-04's reminder opt-out. A JSON body rather than form-encoded, matching
// src/pages/api/rankings.ts: this is a toggle posted by a React island, not a
// form submission, and `enabled` is a boolean the moment it leaves the switch.
export const remindersToggleSchema = z.object({
  enabled: z.boolean("Podaj wartość przełącznika"),
});

export type RemindersToggleValues = z.infer<typeof remindersToggleSchema>;

// F-06's analytics opt-out. Same JSON-body shape as remindersToggleSchema
// above, and deliberately the same polarity as that switch rather than the
// column's: `enabled: true` means "send events", which the UI writes to the
// database as `analytics_opt_out: false`. The inversion lives in one place --
// src/pages/api/settings/analytics.ts -- so neither the island nor this schema
// has to think in negatives.
export const analyticsToggleSchema = z.object({
  enabled: z.boolean("Podaj wartość przełącznika"),
});

export type AnalyticsToggleValues = z.infer<typeof analyticsToggleSchema>;

// S-17's bring-your-own-key. A plausible-shape check, not a real validation --
// the only thing that actually proves a key works is calling OpenAI with it,
// which POST /api/settings/openai-key does itself before ever writing a row.
// This just stops an obviously-wrong paste (empty, no "sk-" prefix, a handful
// of characters) from spending that network call.
const MIN_OPENAI_KEY_LENGTH = 20;

export const openAiKeySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(1, "Podaj klucz OpenAI")
    .startsWith("sk-", "Klucz OpenAI powinien zaczynać się od „sk-”")
    .min(MIN_OPENAI_KEY_LENGTH, "Ten klucz wygląda na zbyt krótki"),
});

export type OpenAiKeyValues = z.infer<typeof openAiKeySchema>;
