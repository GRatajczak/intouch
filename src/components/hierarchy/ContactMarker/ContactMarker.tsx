import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/layout/Toaster/toast";
import { CONTACT_EVENT_OUTCOME_LABELS, type ContactEventOutcome } from "@/lib/validation/contact-event";
import type { ContactFacts } from "@/lib/contact-history/facts";
import type { ContactMarkerProps } from "./types";

const NOTE_MAX_LENGTH = 200;

interface ContactEventResponse {
  event?: { id: string };
  facts?: ContactFacts | null;
  error?: string;
}

type LocalState =
  | { kind: "idle" }
  | { kind: "submitting"; outcome: ContactEventOutcome }
  | { kind: "confirmed"; eventId: string; outcome: ContactEventOutcome }
  | { kind: "noteSaved"; outcome: ContactEventOutcome };

/**
 * The one-tap answer plus the optional note revealed after answering. The
 * answer commits alone on POST; the note is a separate PATCH against the
 * event the POST just created, so skipping it never blocks the answer
 * (plan.md Phase 3 §2).
 */
export function ContactMarker({ personId, rankingEntryId, facts, onMarked }: ContactMarkerProps) {
  const [state, setState] = useState<LocalState>({ kind: "idle" });
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const alreadyConfirmedToday = facts !== null && facts.daysSinceLastHappened === 0 && !facts.lastAttemptFailed;

  async function mark(outcome: ContactEventOutcome) {
    setState({ kind: "submitting", outcome });
    try {
      const res = await fetch("/api/contact-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, outcome, rankingEntryId }),
      });
      const body: ContactEventResponse = await res.json();
      if (!res.ok || !body.event) {
        throw new Error(body.error ?? "Nie udało się zapisać odpowiedzi");
      }
      onMarked(body.facts ?? null);
      setState({ kind: "confirmed", eventId: body.event.id, outcome });
    } catch {
      showToast("error", "Nie udało się zapisać odpowiedzi. Spróbuj ponownie.");
      setState({ kind: "idle" });
    }
  }

  async function submitNote(eventId: string, outcome: ContactEventOutcome) {
    const trimmed = note.trim();
    if (!trimmed) {
      setState({ kind: "noteSaved", outcome });
      return;
    }
    setSavingNote(true);
    try {
      const res = await fetch(`/api/contact-events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
      });
      const body: ContactEventResponse = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Nie udało się zapisać notatki");
      }
      onMarked(body.facts ?? null);
      setState({ kind: "noteSaved", outcome });
    } catch {
      showToast("error", "Nie udało się zapisać notatki. Spróbuj ponownie.");
    } finally {
      setSavingNote(false);
    }
  }

  if (state.kind === "confirmed" || state.kind === "noteSaved") {
    const label = CONTACT_EVENT_OUTCOME_LABELS[state.outcome];
    return (
      <div className="flex flex-col gap-2">
        <div className="text-success flex items-center gap-1.5 text-xs font-semibold">
          <Check className="size-3.5" />
          Zapisano: {label}
        </div>
        {state.kind === "confirmed" && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={note}
              onChange={(event) => {
                setNote(event.target.value.slice(0, NOTE_MAX_LENGTH));
              }}
              placeholder="Dodaj notatkę (opcjonalnie)"
              maxLength={NOTE_MAX_LENGTH}
              disabled={savingNote}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground flex-1 rounded-lg border px-3 py-1.5 text-xs outline-none disabled:opacity-50"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={savingNote}
              onClick={() => {
                void submitNote(state.eventId, state.outcome);
              }}
            >
              Zapisz
            </Button>
          </div>
        )}
      </div>
    );
  }

  const submitting = state.kind === "submitting";
  const submittingOutcome = state.kind === "submitting" ? state.outcome : null;

  return (
    <div className="flex flex-col gap-1.5">
      {alreadyConfirmedToday && <div className="text-muted-foreground text-xs">Już potwierdzone dzisiaj</div>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={submitting}
          onClick={() => {
            void mark("happened");
          }}
        >
          {submittingOutcome === "happened" && <Loader2 className="size-3.5 animate-spin" />}
          Tak, rozmawialiśmy
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={submitting}
          onClick={() => {
            void mark("not_yet");
          }}
        >
          {submittingOutcome === "not_yet" && <Loader2 className="size-3.5 animate-spin" />}
          Jeszcze nie
        </Button>
      </div>
    </div>
  );
}
