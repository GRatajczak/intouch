import React, { useState } from "react";
import { UserRound, Info, CircleAlert } from "lucide-react";
import { TextField } from "@/components/forms/TextField";
import { ChoiceChips } from "@/components/forms/ChoiceChips";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/layout/Toaster";
import { cn } from "@/lib/utils";
import {
  profileSchema,
  WEEKLY_TIME_BUDGET_OPTIONS,
  PREFERRED_CHANNEL_OPTIONS,
  AVAILABILITY_WINDOW_OPTIONS,
} from "@/lib/validation/profile";
import type { ProfileFormProps } from "./types";

const LIFE_CONTEXT_EXAMPLE = "np. zapracowany rodzic dwójki dzieci, często w podróżach służbowych";

const textareaBase =
  "w-full rounded-lg bg-input border border-border px-3 py-2 text-foreground placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-ring transition-colors resize-none";

export default function ProfileForm({ initialValues }: ProfileFormProps) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [birthDate, setBirthDate] = useState(initialValues?.birthDate ?? "");
  const [lifeContext, setLifeContext] = useState(initialValues?.lifeContext ?? "");
  const [weeklyTimeBudget, setWeeklyTimeBudget] = useState<string[]>(
    initialValues?.weeklyTimeBudget ? [initialValues.weeklyTimeBudget] : [],
  );
  const [preferredChannels, setPreferredChannels] = useState<string[]>(initialValues?.preferredChannels ?? []);
  const [availabilityWindows, setAvailabilityWindows] = useState<string[]>(initialValues?.availabilityWindows ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate() {
    const result = profileSchema.safeParse({
      name,
      birthDate,
      lifeContext,
      weeklyTimeBudget: weeklyTimeBudget[0],
      preferredChannels,
      availabilityWindows,
    });
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

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/profile", { method: "POST", body: new FormData(e.currentTarget) });

      if (response.status === 401) {
        window.location.href = "/auth/signin";
        return;
      }

      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        showToast("error", body?.error ?? "Nie udało się zapisać profilu");
        return;
      }

      showToast("success", "Zapisano zmiany profilu");
    } catch {
      showToast("error", "Nie udało się połączyć z serwerem");
    } finally {
      setIsSubmitting(false);
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

      <div className="border-border space-y-4 border-t pt-4">
        <div>
          <h2 className="text-foreground text-sm font-semibold">Twój rytm</h2>
          <p className="text-muted-foreground text-xs">Opcjonalne — możesz to później zmienić.</p>
        </div>

        <ChoiceChips
          id="weeklyTimeBudget"
          name="weeklyTimeBudget"
          label="Ile czasu realnie masz w tygodniu na kontakt z bliskimi?"
          mode="single"
          options={WEEKLY_TIME_BUDGET_OPTIONS}
          value={weeklyTimeBudget}
          onChange={setWeeklyTimeBudget}
        />

        <ChoiceChips
          id="preferredChannels"
          name="preferredChannels"
          label="Jak najchętniej się odzywasz?"
          mode="multi"
          options={PREFERRED_CHANNEL_OPTIONS}
          value={preferredChannels}
          onChange={setPreferredChannels}
        />

        <ChoiceChips
          id="availabilityWindows"
          name="availabilityWindows"
          label="Kiedy zwykle masz na to przestrzeń?"
          mode="multi"
          options={AVAILABILITY_WINDOW_OPTIONS}
          value={availabilityWindows}
          onChange={setAvailabilityWindows}
        />
      </div>

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? (
          <span className="flex items-center gap-2">
            <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
            Zapisywanie...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <UserRound className="size-4" />
            Zapisz profil
          </span>
        )}
      </Button>
    </form>
  );
}
