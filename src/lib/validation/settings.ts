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
