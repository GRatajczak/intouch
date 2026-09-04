import React, { useState } from "react";
import { Lock, KeyRound } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/layout/Toaster";

const MIN_PASSWORD_LENGTH = 6;

export default function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{ currentPassword?: string; newPassword?: string; confirmPassword?: string }>(
    {},
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate() {
    const next: typeof errors = {};

    if (!currentPassword) {
      next.currentPassword = "Podaj obecne hasło";
    }

    if (!newPassword) {
      next.newPassword = "Hasło jest wymagane";
    } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
      next.newPassword = `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków`;
    }

    if (!confirmPassword) {
      next.confirmPassword = "Potwierdź nowe hasło";
    } else if (newPassword !== confirmPassword) {
      next.confirmPassword = "Hasła nie są takie same";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/settings/password", { method: "POST", body: new FormData(e.currentTarget) });

      if (response.status === 401) {
        window.location.href = "/auth/signin";
        return;
      }

      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        showToast("error", body?.error ?? "Nie udało się zmienić hasła");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("success", "Hasło zostało zmienione");
    } catch {
      showToast("error", "Nie udało się połączyć z serwerem");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form method="POST" action="/api/settings/password" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="currentPassword"
        label="Obecne hasło"
        type={showCurrentPassword ? "text" : "password"}
        value={currentPassword}
        onChange={(v) => {
          setCurrentPassword(v);
          clearError("currentPassword");
        }}
        error={errors.currentPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showCurrentPassword}
            onToggle={() => {
              setShowCurrentPassword(!showCurrentPassword);
            }}
          />
        }
      />

      <FormField
        id="newPassword"
        label="Nowe hasło"
        type={showNewPassword ? "text" : "password"}
        value={newPassword}
        onChange={(v) => {
          setNewPassword(v);
          clearError("newPassword");
        }}
        placeholder="Min. 6 znaków"
        error={errors.newPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showNewPassword}
            onToggle={() => {
              setShowNewPassword(!showNewPassword);
            }}
          />
        }
      />

      <FormField
        id="confirmPassword"
        label="Potwierdź nowe hasło"
        type={showConfirmPassword ? "text" : "password"}
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        error={errors.confirmPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showConfirmPassword}
            onToggle={() => {
              setShowConfirmPassword(!showConfirmPassword);
            }}
          />
        }
      />

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? (
          <span className="flex items-center gap-2">
            <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
            Zapisywanie...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Zmień hasło
          </span>
        )}
      </Button>
    </form>
  );
}
