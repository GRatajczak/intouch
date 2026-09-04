import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/layout/Toaster/toast";
import {
  CONTACT_EVENT_OUTCOMES,
  CONTACT_EVENT_OUTCOME_LABELS,
  type ContactEventOutcome,
} from "@/lib/validation/contact-event";
import type { Tables } from "@/db/database.types";
import type { ContactFacts } from "@/lib/contact-history/facts";
import {
  CONTACT_HISTORY_OPEN_EVENT,
  broadcastContactFactsUpdate,
  type ContactHistoryOpenDetail,
} from "./openContactHistory";
import type { ContactHistorySheetState, ContactHistoryRowMode } from "./types";

const NOTE_MAX_LENGTH = 200;

interface EventsResponse {
  events?: Tables<"contact_events">[];
  error?: string;
}

interface MutationResponse {
  facts?: ContactFacts | null;
  error?: string;
}

// Same dziś/wczoraj/"X dni temu" shape as ContactChips's formatRelativeDate --
// kept local to each component per this repo's existing pattern (RefreshBanner
// and ContactChips each own their own date formatter rather than sharing one).
function formatEventDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return "dziś";
  }
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 1) {
    return "wczoraj";
  }
  if (diffDays >= 0 && diffDays < 30) {
    return `${String(diffDays)} dni temu`;
  }
  return date.toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
}

/**
 * Mounted once in Layout.astro, not per card -- listens for the open event
 * and holds its own personId/personName state, exactly as Toaster does.
 * Every edit/delete re-broadcasts the person's updated facts so an open
 * hierarchy card (a separate island) can refresh its chips.
 */
export function ContactHistorySheet() {
  const [state, setState] = useState<ContactHistorySheetState>({ kind: "closed" });
  const [rowModes, setRowModes] = useState<Record<string, ContactHistoryRowMode>>({});
  const [editOutcome, setEditOutcome] = useState<ContactEventOutcome>("happened");
  const [editNote, setEditNote] = useState("");
  const [busyEventId, setBusyEventId] = useState<string | null>(null);

  useEffect(() => {
    function handleOpen(event: Event) {
      const { personId, personName } = (event as CustomEvent<ContactHistoryOpenDetail>).detail;
      setRowModes({});
      setState({ kind: "loading", personId, personName });
      void (async () => {
        try {
          const res = await fetch(`/api/contact-events?personId=${encodeURIComponent(personId)}`);
          const body: EventsResponse = await res.json();
          if (!res.ok) {
            throw new Error(body.error ?? "Nie udało się wczytać historii");
          }
          setState({ kind: "loaded", personId, personName, events: body.events ?? [] });
        } catch (err) {
          setState({
            kind: "error",
            personId,
            personName,
            message: err instanceof Error ? err.message : "Nie udało się wczytać historii",
          });
        }
      })();
    }
    window.addEventListener(CONTACT_HISTORY_OPEN_EVENT, handleOpen);
    return () => {
      window.removeEventListener(CONTACT_HISTORY_OPEN_EVENT, handleOpen);
    };
  }, []);

  function close() {
    setState({ kind: "closed" });
    setRowModes({});
  }

  function startEdit(event: Tables<"contact_events">) {
    setRowModes((prev) => ({ ...prev, [event.id]: "editing" }));
    setEditOutcome(event.outcome as ContactEventOutcome);
    setEditNote(event.note ?? "");
  }

  function cancelRowMode(eventId: string) {
    setRowModes((prev) => ({ ...prev, [eventId]: "view" }));
  }

  async function saveEdit(eventId: string, personId: string) {
    setBusyEventId(eventId);
    try {
      const res = await fetch(`/api/contact-events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: editOutcome, note: editNote.trim() || null }),
      });
      const body: MutationResponse & { event?: Tables<"contact_events"> } = await res.json();
      if (!res.ok || !body.event) {
        throw new Error(body.error ?? "Nie udało się zapisać zmian");
      }
      const updatedEvent = body.event;
      setState((prev) =>
        prev.kind === "loaded"
          ? { ...prev, events: prev.events.map((e) => (e.id === eventId ? updatedEvent : e)) }
          : prev,
      );
      setRowModes((prev) => ({ ...prev, [eventId]: "view" }));
      broadcastContactFactsUpdate(personId, body.facts ?? null);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Nie udało się zapisać zmian");
    } finally {
      setBusyEventId(null);
    }
  }

  async function confirmDelete(eventId: string, personId: string) {
    setBusyEventId(eventId);
    try {
      const res = await fetch(`/api/contact-events/${eventId}`, { method: "DELETE" });
      const body: MutationResponse = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Nie udało się usunąć wpisu");
      }
      setState((prev) =>
        prev.kind === "loaded" ? { ...prev, events: prev.events.filter((e) => e.id !== eventId) } : prev,
      );
      broadcastContactFactsUpdate(personId, body.facts ?? null);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Nie udało się usunąć wpisu");
    } finally {
      setBusyEventId(null);
    }
  }

  const isOpen = state.kind !== "closed";

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Historia kontaktu</SheetTitle>
          <SheetDescription>{state.kind !== "closed" ? state.personName : ""}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
          {state.kind === "loading" && <p className="text-muted-foreground text-sm">Wczytywanie…</p>}

          {state.kind === "error" && <p className="text-destructive text-sm">{state.message}</p>}

          {state.kind === "loaded" && state.events.length === 0 && (
            <p className="text-muted-foreground text-sm">Brak zapisanej historii dla tej osoby.</p>
          )}

          {state.kind === "loaded" &&
            state.events.map((event) => {
              const mode = rowModes[event.id] ?? "view";
              const busy = busyEventId === event.id;
              const dotTone = event.outcome === "happened" ? "bg-success" : "bg-urgent";

              return (
                <div key={event.id} className="border-border flex flex-col gap-2 border-b py-3 last:border-b-0">
                  {mode === "editing" ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        {CONTACT_EVENT_OUTCOMES.map((outcome) => (
                          <Button
                            key={outcome}
                            type="button"
                            size="sm"
                            variant={editOutcome === outcome ? "default" : "outline"}
                            disabled={busy}
                            onClick={() => {
                              setEditOutcome(outcome);
                            }}
                          >
                            {CONTACT_EVENT_OUTCOME_LABELS[outcome]}
                          </Button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={editNote}
                        onChange={(e) => {
                          setEditNote(e.target.value.slice(0, NOTE_MAX_LENGTH));
                        }}
                        maxLength={NOTE_MAX_LENGTH}
                        placeholder="Notatka (opcjonalnie)"
                        disabled={busy}
                        className="border-border bg-background text-foreground placeholder:text-muted-foreground rounded-lg border px-3 py-1.5 text-xs outline-none disabled:opacity-50"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            void saveEdit(event.id, state.personId);
                          }}
                        >
                          Zapisz
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            cancelRowMode(event.id);
                          }}
                        >
                          Anuluj
                        </Button>
                      </div>
                    </div>
                  ) : mode === "confirmingDelete" ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm">Na pewno usunąć ten wpis?</span>
                      <div className="flex flex-shrink-0 gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => {
                            void confirmDelete(event.id, state.personId);
                          }}
                        >
                          Usuń
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            cancelRowMode(event.id);
                          }}
                        >
                          Anuluj
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className={`mt-1.5 size-2.5 flex-shrink-0 rounded-full ${dotTone}`} aria-hidden="true" />
                      <div className="flex-1">
                        <div className="text-foreground text-sm font-semibold">
                          {CONTACT_EVENT_OUTCOME_LABELS[event.outcome as ContactEventOutcome]}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {formatEventDate(event.occurred_at)}
                          {event.note && ` · ${event.note}`}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 gap-1">
                        <button
                          type="button"
                          aria-label="Edytuj wpis"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            startEdit(event);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Usuń wpis"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            setRowModes((prev) => ({ ...prev, [event.id]: "confirmingDelete" }));
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
