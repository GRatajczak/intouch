import { useState } from "react";
import { showToast } from "@/components/layout/Toaster";
import { cn } from "@/lib/utils";
import type { AnalyticsSectionProps } from "./types";

/**
 * F-06's analytics opt-out — the control that closes the privacy story the
 * `analytics_opt_out` column has been honouring since phase 1.
 *
 * Deliberately built as the twin of RemindersSection: same `role="switch"` on a
 * native button (there is still no switch primitive under components/ui, and
 * this change does not add one), same optimistic update, same toast-and-revert
 * on failure. Two toggles doing the same kind of job on one screen should not
 * look like two different ideas.
 *
 * The copy is the honest version of what is collected. It names the shape of
 * the data ("which steps you reached") and states the boundary plainly, because
 * the whole product promise is that a third party's details never leave the
 * app — a vague "we collect anonymous usage data" would be the sentence that
 * quietly erodes it.
 */
export default function AnalyticsSection({ analyticsEnabled }: AnalyticsSectionProps) {
  const [enabled, setEnabled] = useState(analyticsEnabled);
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
      const response = await fetch("/api/settings/analytics", {
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

      showToast("success", next ? "Analityka włączona" : "Analityka wyłączona");
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
        <p className="text-foreground text-sm font-medium">Anonimowa analityka produktu</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Zapisujemy tylko to, które kroki w aplikacji przechodzisz — że wypełniłeś profil, że dodałeś pierwszą osobę,
          że potwierdziłeś kontakt. Nigdy imion, opisów ani notatek o Twoich ludziach. Pomaga nam to zobaczyć, gdzie
          aplikacja gubi ludzi po drodze.
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Anonimowa analityka produktu"
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
