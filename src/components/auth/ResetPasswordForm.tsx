import React, { useState } from "react";
import { Lock, KeyRound } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

const MIN_PASSWORD_LENGTH = 6;

interface Props {
  serverError?: string | null;
}

export default function ResetPasswordForm({ serverError }: Props) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string }>({});

  function validate() {
    const next: typeof errors = {};

    if (!password) {
      next.password = "Hasło jest wymagane";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków`;
    }

    if (!confirmPassword) {
      next.confirmPassword = "Potwierdź hasło";
    } else if (password !== confirmPassword) {
      next.confirmPassword = "Hasła nie są takie same";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  function charLabel(n: number) {
    if (n === 1) return "znak";
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "znaki";
    return "znaków";
  }

  const remaining = MIN_PASSWORD_LENGTH - password.length;
  const passwordHint =
    !errors.password && password.length > 0 && password.length < MIN_PASSWORD_LENGTH ? (
      <p className="text-text-tertiary mt-1 text-xs">
        Jeszcze {remaining} {charLabel(remaining)}
      </p>
    ) : undefined;

  return (
    <form method="POST" action="/api/auth/reset-password" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="password"
        label="Nowe hasło"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError("password");
        }}
        placeholder="Min. 6 znaków"
        error={errors.password}
        hint={passwordHint}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <FormField
        id="confirmPassword"
        name="confirmPassword"
        label="Potwierdź nowe hasło"
        type={showConfirmPassword ? "text" : "password"}
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        placeholder="Powtórz hasło"
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

      <ServerError message={serverError} />

      <SubmitButton pendingText="Zapisywanie..." icon={<KeyRound className="size-4" />}>
        Ustaw nowe hasło
      </SubmitButton>
    </form>
  );
}
