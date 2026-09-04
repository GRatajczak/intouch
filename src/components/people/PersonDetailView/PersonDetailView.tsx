import { useRef, useState } from "react";
import { Pencil, ChevronDown, ChevronUp, Trash2, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { WeightIndicator } from "@/components/people/WeightIndicator";
import { PersonEditForm } from "@/components/people/PersonEditForm";
import { showToast } from "@/components/layout/Toaster/toast";
import {
  RELATIONSHIP_TYPE_LABELS,
  RELATIONSHIP_TYPE_SWATCH,
  LAST_CONTACT_BUCKET_LABELS,
  type RelationshipType,
  type LastContactBucket,
} from "@/lib/validation/person";
import {
  CONTACT_EVENT_OUTCOMES,
  CONTACT_EVENT_OUTCOME_LABELS,
  type ContactEventOutcome,
} from "@/lib/validation/contact-event";
import type { Tables } from "@/db/database.types";
import type { ContactFacts } from "@/lib/contact-history/facts";
import type { PersonDetailViewMode, PersonDetailViewProps } from "./types";

// Same dziś/wczoraj/"X dni temu" shape PersonCard and ContactHistorySheet
// each own locally -- no shared date-utils module exists in this repo.
function formatLastContact(iso: string): string {
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

const NOTE_MAX_LENGTH = 200;

type HistoryState = "idle" | "loading" | "loaded" | "error";

interface PatchResponse {
  person?: Tables<"people">;
  error?: string;
}

interface DeleteResponse {
  error?: string;
}

interface EventsResponse {
  events?: Tables<"contact_events">[];
  error?: string;
}

interface CreateEventResponse {
  event?: Tables<"contact_events">;
  facts?: ContactFacts | null;
  error?: string;
}

/**
 * Owns the view/edit toggle and the three lifecycle actions for one person
 * -- plan.md Phase 4 §3. No second route for editing: this single island
 * swaps between a read-only view and PersonEditForm in place. History is an
 * inline expandable section on this page (not the ContactHistorySheet
 * sidebar the catalog cards still use), matching the design mock's inline
 * timeline and "+ Dopisz kontakt" trigger (InTouch.dc.html:566-594) rather
 * than a slide-out panel.
 */
export function PersonDetailView({ person: initialPerson, facts: initialFacts }: PersonDetailViewProps) {
  const [person, setPerson] = useState<Tables<"people">>(initialPerson);
  const [facts, setFacts] = useState<ContactFacts | null>(initialFacts);
  const [mode, setMode] = useState<PersonDetailViewMode>("view");
  const [statusBusy, setStatusBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyState, setHistoryState] = useState<HistoryState>("idle");
  const [historyError, setHistoryError] = useState("");
  const [events, setEvents] = useState<Tables<"contact_events">[]>([]);
  const [addingContact, setAddingContact] = useState(false);
  const [addOutcome, setAddOutcome] = useState<ContactEventOutcome>("happened");
  const [addNote, setAddNote] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const relationshipType = person.relationship_type as RelationshipType;
  const isDeactivated = person.status === "deactivated";

  async function toggleStatus() {
    const nextStatus = isDeactivated ? "active" : "deactivated";
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body: PatchResponse = await res.json();
      if (!res.ok || !body.person) {
        throw new Error(body.error ?? "Nie udało się zapisać zmiany statusu");
      }
      setPerson(body.person);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Nie udało się zapisać zmiany statusu");
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleDelete() {
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/people/${person.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body: DeleteResponse = await res.json();
        throw new Error(body.error ?? "Nie udało się usunąć osoby");
      }
      window.location.href = "/people";
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Nie udało się usunąć osoby");
      setDeleteBusy(false);
    }
  }

  // Tracks the in-flight load, if any, so a second caller (e.g. submitContact
  // firing right after toggleHistory) can await the same request instead of
  // dispatching a concurrent duplicate GET.
  const historyLoadRef = useRef<Promise<void> | null>(null);

  function loadHistory(): Promise<void> {
    const promise = (async () => {
      setHistoryState("loading");
      try {
        const res = await fetch(`/api/contact-events?personId=${encodeURIComponent(person.id)}`);
        const body: EventsResponse = await res.json();
        if (!res.ok) {
          throw new Error(body.error ?? "Nie udało się wczytać historii");
        }
        setEvents(body.events ?? []);
        setHistoryState("loaded");
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : "Nie udało się wczytać historii");
        setHistoryState("error");
      }
    })();
    historyLoadRef.current = promise;
    return promise;
  }

  function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && (historyState === "idle" || historyState === "error")) {
      void loadHistory();
    }
  }

  async function submitContact() {
    setAddBusy(true);
    try {
      const res = await fetch("/api/contact-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: person.id, outcome: addOutcome, note: addNote.trim() || null }),
      });
      const body: CreateEventResponse = await res.json();
      const createdEvent = body.event;
      if (!res.ok || !createdEvent) {
        throw new Error(body.error ?? "Nie udało się zapisać kontaktu");
      }
      setFacts(body.facts ?? null);
      setAddNote("");
      setAddOutcome("happened");
      setAddingContact(false);
      setHistoryOpen(true);
      if (historyState === "loaded") {
        setEvents((prev) => [createdEvent, ...prev]);
      } else {
        // A load may already be in flight (e.g. just opened via toggleHistory)
        // -- wait for it instead of firing a concurrent duplicate GET, then
        // reload once more since that in-flight request predates this event.
        if (historyState === "loading" && historyLoadRef.current) {
          await historyLoadRef.current;
        }
        await loadHistory();
      }
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Nie udało się zapisać kontaktu");
    } finally {
      setAddBusy(false);
    }
  }

  // relationship_context (if present) · typ relacji · osoba/grupa, dot-joined
  // -- mirrors the mock's subtitle line (InTouch.dc.html:528), minus the
  // location segment, which has no field in this schema.
  const subtitleParts = [
    person.relationship_context,
    RELATIONSHIP_TYPE_LABELS[relationshipType],
    person.is_collective ? "grupa" : "osoba",
  ].filter(Boolean);

  if (mode === "editing") {
    return (
      <div className="max-w-[720px]">
        <h1 className="font-display text-display-sm text-foreground mb-6">Edytuj osobę</h1>
        <PersonEditForm
          person={person}
          onSaved={(updated) => {
            setPerson(updated);
            setMode("view");
          }}
          onCancel={() => {
            setMode("view");
          }}
        />
      </div>
    );
  }

  return (
    // No enclosing card -- flat on the page background, matching /profile's
    // own cardless layout (profile.astro has no bg-card/border/shadow
    // wrapper either). Otherwise follows the design mock's "5 -- Profil
    // osoby i dodawanie" section (InTouch.dc.html:522-564): 64px avatar
    // swatch, serif name, two-action header, stat-tile row, titled tags
    // section, inline history.
    <div className="flex max-w-[720px] flex-col gap-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4.5">
          <div
            className={`size-16 shrink-0 rounded-[20px] ${RELATIONSHIP_TYPE_SWATCH[relationshipType]}`}
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-display-md text-foreground leading-none">{person.name}</h1>
            <div className="text-muted-foreground text-sm">{subtitleParts.join(" · ")}</div>
          </div>
        </div>
        <div className="flex gap-2 sm:shrink-0">
          <Button
            type="button"
            className="flex-1 sm:flex-initial"
            onClick={() => {
              setMode("editing");
            }}
          >
            <Pencil className="size-4" />
            Edytuj
          </Button>
          <Button
            type="button"
            className="flex-1 sm:flex-initial"
            disabled={statusBusy}
            onClick={() => {
              void toggleStatus();
            }}
          >
            {isDeactivated ? "Aktywuj" : "Dezaktywuj"}
          </Button>
        </div>
      </div>

      {isDeactivated && (
        <span className="bg-muted text-muted-foreground w-fit rounded-full px-2.5 py-1 text-xs font-bold">
          nieaktywna
        </span>
      )}

      <p className="text-foreground text-sm leading-relaxed">{person.description}</p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="bg-secondary border-border flex flex-1 flex-col gap-2 rounded-2xl border p-4">
          <div className="text-muted-foreground text-xs">Waga relacji</div>
          <div className="flex items-center gap-2">
            <div className="text-xl font-bold">{person.weight}</div>
            <WeightIndicator value={person.weight} relationshipType={relationshipType} />
          </div>
        </div>
        <div className="bg-secondary border-border flex flex-1 flex-col gap-2 rounded-2xl border p-4">
          <div className="text-muted-foreground text-xs">Ostatni kontakt</div>
          <div className="text-xl font-bold">
            {isDeactivated
              ? "Pominięty"
              : facts?.lastHappenedAt
                ? formatLastContact(facts.lastHappenedAt)
                : person.last_contact_bucket
                  ? LAST_CONTACT_BUCKET_LABELS[person.last_contact_bucket as LastContactBucket]
                  : "Brak danych"}
          </div>
        </div>
      </div>

      {isDeactivated && (
        <p className="text-muted-foreground -mt-4 text-sm">Pominięty w podpowiedziach, historia zachowana</p>
      )}

      <div className="flex flex-col gap-3">
        <div className="text-muted-foreground text-xs font-bold tracking-wide uppercase">Co o nim wiemy</div>
        {person.context_tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {person.context_tags.map((tag) => (
              <span key={tag} className="bg-secondary border-border rounded-xl border px-3.5 py-2.5 text-sm">
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Brak zapisanych informacji. Dodaj je w edycji osoby.</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-foreground flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase"
            onClick={toggleHistory}
            aria-expanded={historyOpen}
          >
            Historia kontaktu
            {historyOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-semibold"
            onClick={() => {
              setAddingContact((prev) => !prev);
              setHistoryOpen(true);
              if (historyState === "idle" || historyState === "error") {
                void loadHistory();
              }
            }}
          >
            <Plus className="size-3.5" />
            Dopisz kontakt
          </button>
        </div>

        {addingContact && (
          <div className="border-border bg-secondary flex flex-col gap-2 rounded-2xl border p-4">
            <div className="flex gap-2">
              {CONTACT_EVENT_OUTCOMES.map((outcome) => (
                <Button
                  key={outcome}
                  type="button"
                  size="sm"
                  variant={addOutcome === outcome ? "default" : "outline"}
                  disabled={addBusy}
                  onClick={() => {
                    setAddOutcome(outcome);
                  }}
                >
                  {CONTACT_EVENT_OUTCOME_LABELS[outcome]}
                </Button>
              ))}
            </div>
            <input
              type="text"
              value={addNote}
              onChange={(e) => {
                setAddNote(e.target.value.slice(0, NOTE_MAX_LENGTH));
              }}
              placeholder="Notatka (opcjonalnie)"
              disabled={addBusy}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground rounded-lg border px-3 py-1.5 text-xs outline-none disabled:opacity-50"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={addBusy}
                onClick={() => {
                  void submitContact();
                }}
              >
                {addBusy && <Loader2 className="size-3.5 animate-spin" />}
                Zapisz
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={addBusy}
                onClick={() => {
                  setAddingContact(false);
                  setAddNote("");
                }}
              >
                Anuluj
              </Button>
            </div>
          </div>
        )}

        {historyOpen && (
          <div className="flex flex-col gap-0">
            {historyState === "loading" && <p className="text-muted-foreground text-sm">Wczytywanie…</p>}
            {historyState === "error" && <p className="text-destructive text-sm">{historyError}</p>}
            {historyState === "loaded" && events.length === 0 && (
              <p className="text-muted-foreground text-sm">Brak zapisanej historii dla tej osoby.</p>
            )}
            {historyState === "loaded" &&
              events.map((event) => (
                <div key={event.id} className="border-border flex gap-3.5 border-b py-3.5 last:border-b-0">
                  <div
                    className={`mt-1 size-2.5 flex-shrink-0 rounded-full ${event.outcome === "happened" ? "bg-success" : "bg-urgent"}`}
                    aria-hidden="true"
                  />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <div className="text-sm font-semibold">
                      {event.outcome === "happened" ? "Kontakt udany" : "Kontakt nieudany"}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(event.occurred_at).toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}
                      {event.note && ` · ${event.note}`}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {isDeactivated && (
        <div className="flex justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" size="sm">
                <Trash2 className="size-4" />
                Usuń na zawsze
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Usunąć {person.name} na zawsze?</AlertDialogTitle>
                <AlertDialogDescription>
                  Nie można cofnąć tej operacji. Ta osoba oraz cała jej historia kontaktu zostaną usunięte bezpowrotnie.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteBusy}>Anuluj</AlertDialogCancel>
                {/* A plain Button, not AlertDialogAction -- Action closes the
                    dialog on click unconditionally (Radix ignores
                    preventDefault there), which would dismiss the
                    confirmation even when the delete request fails. */}
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleteBusy}
                  onClick={() => {
                    void handleDelete();
                  }}
                >
                  Usuń na zawsze
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
