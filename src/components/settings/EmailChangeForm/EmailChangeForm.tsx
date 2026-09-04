import React, { useState } from "react";
import { Mail, Send } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/layout/Toaster";
import type { EmailChangeFormProps } from "./types";

export default function EmailChangeForm({ currentEmail }: EmailChangeFormProps) {
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate() {
    if (!newEmail.trim()) {
      setError("Podaj adres e-mail");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setError("Podaj prawidłowy adres e-mail");
      return false;
    }
    setError(undefined);
    return true;
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/settings/email", { method: "POST", body: new FormData(e.currentTarget) });

      if (response.status === 401) {
        window.location.href = "/auth/signin";
        return;
      }

      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        showToast("error", body?.error ?? "Nie udało się rozpocząć zmiany adresu e-mail");
        return;
      }

      setNewEmail("");
      showToast(
        "success",
        "Wysłaliśmy potwierdzenie na obecny i nowy adres e-mail. Zmiana wejdzie w życie po kliknięciu obu linków.",
      );
    } catch {
      showToast("error", "Nie udało się połączyć z serwerem");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-muted-foreground mb-1 text-sm">Obecny adres e-mail</p>
        <p className="text-foreground text-sm font-medium">{currentEmail}</p>
      </div>

      <form method="POST" action="/api/settings/email" className="space-y-4" onSubmit={handleSubmit} noValidate>
        <FormField
          id="newEmail"
          name="newEmail"
          label="Nowy adres e-mail"
          type="email"
          value={newEmail}
          onChange={(v) => {
            setNewEmail(v);
            if (error) setError(undefined);
          }}
          placeholder="np. jan.kowalski@example.com"
          error={error}
          icon={<Mail className="size-4" />}
        />

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <span className="flex items-center gap-2">
              <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
              Wysyłanie...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Send className="size-4" />
              Zmień adres e-mail
            </span>
          )}
        </Button>
      </form>
    </div>
  );
}
