import React, { useState } from "react";
import { UserRound, Info, CircleAlert } from "lucide-react";
import { TextField } from "@/components/forms/TextField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import { profileSchema } from "@/lib/validation/profile";
import type { ProfileFormProps } from "./types";

const LIFE_CONTEXT_EXAMPLE = "np. zapracowany rodzic dwójki dzieci, często w podróżach służbowych";

const textareaBase =
  "w-full rounded-lg bg-input border border-border px-3 py-2 text-foreground placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-ring transition-colors resize-none";

export default function ProfileForm({ initialValues, serverError }: ProfileFormProps) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [birthDate, setBirthDate] = useState(initialValues?.birthDate ?? "");
  const [lifeContext, setLifeContext] = useState(initialValues?.lifeContext ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const result = profileSchema.safeParse({ name, birthDate, lifeContext });
    if (result.success) {
      setErrors({});
      return true;
    }
    const next: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !next[field]) {
        next[field] = issue.message;
      }
    }
    setErrors(next);
    return false;
  }

  function clearError(field: string) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/profile" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <TextField
        id="name"
        label="Imię"
        value={name}
        onChange={(v) => {
          setName(v);
          clearError("name");
        }}
        placeholder="np. Anna"
        error={errors.name}
        icon={<UserRound className="size-4" />}
      />

      <TextField
        id="birthDate"
        label="Data urodzenia"
        type="date"
        value={birthDate}
        onChange={(v) => {
          setBirthDate(v);
          clearError("birthDate");
        }}
        error={errors.birthDate}
      />

      <div>
        <label htmlFor="lifeContext" className="text-muted-foreground mb-1 flex items-center gap-1 text-sm">
          Kontekst życiowy
          <span title={LIFE_CONTEXT_EXAMPLE} className="text-text-tertiary inline-flex cursor-help">
            <Info className="size-3.5" />
          </span>
        </label>
        <textarea
          id="lifeContext"
          name="lifeContext"
          rows={3}
          value={lifeContext}
          onChange={(e) => {
            setLifeContext(e.target.value);
            clearError("lifeContext");
          }}
          placeholder={LIFE_CONTEXT_EXAMPLE}
          className={cn(textareaBase, errors.lifeContext && "border-destructive focus:ring-destructive")}
        />
        {errors.lifeContext && (
          <p className="text-destructive mt-1 flex items-center gap-1 text-xs">
            <CircleAlert className="size-3" />
            {errors.lifeContext}
          </p>
        )}
      </div>

      <ServerError message={serverError} />

      <SubmitButton pendingText="Zapisywanie..." icon={<UserRound className="size-4" />}>
        Zapisz profil
      </SubmitButton>
    </form>
  );
}
