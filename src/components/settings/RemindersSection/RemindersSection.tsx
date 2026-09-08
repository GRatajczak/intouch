import { useState } from "react";
import { showToast } from "@/components/layout/Toaster";
import { cn } from "@/lib/utils";
import type { RemindersSectionProps } from "./types";

/**
 * The reminder kill switch — the one control FR-008 cannot ship without.
 *
 * Deliberately not a frequency picker: the cadence stays product-owned,
 * because "the app decides on your behalf" is the product's whole claim and a
 * slider hands that back to the user. The copy below says so plainly rather
 * than leaving the absence to be read as an oversight.
 *
 * `role="switch"` on a button rather than a styled checkbox: there is no switch
 * primitive under components/ui, and this needs no form semantics — it posts on
 * change and owns its own state.
 */
export default function RemindersSection({ remindersEnabled }: RemindersSectionProps) {
  const [enabled, setEnabled] = useState(remindersEnabled);
  const [isSaving, setIsSaving] = useState(false);

  async function toggle() {
    if (isSaving) {
      return;
    }

    const next = !enabled;
    // Optimistic: the switch is the feedback, and waiting on a round trip to
    // move it makes the control feel broken. Reverted below if the write fails.
    setEnabled(next);
    setIsSaving(true);

    try {
      const response = await fetch("/api/settings/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Nie udało się zapisać ustawienia";
        throw new Error(message);
      }

      showToast("success", next ? "Przypomnienia włączone" : "Przypomnienia wyłączone");
    } catch (err: unknown) {
      setEnabled(!next);
      showToast("error", err instanceof Error ? err.message : "Nie udało się zapisać ustawienia");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-foreground text-sm font-medium">E-mail o relacjach, które cichną</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Wysyłamy najwyżej jedną taką wiadomość dziennie i tylko wtedy, gdy naprawdę jest o kim przypomnieć. O tym,
          kiedy i o kim, decyduje aplikacja — tutaj możesz to wyłączyć.
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Przypomnienia e-mail"
        disabled={isSaving}
        onClick={() => void toggle()}
        className={cn(
          "focus-visible:ring-ring relative mt-1 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
          enabled ? "bg-primary" : "bg-border",
        )}
      >
        <span
          className={cn(
            "bg-card inline-block h-5 w-5 transform rounded-full shadow transition-transform",
            enabled ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
