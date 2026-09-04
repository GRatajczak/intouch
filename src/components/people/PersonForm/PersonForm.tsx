import React, { useEffect, useRef, useState } from "react";
import { UserRound, UserPlus, Plus, Trash2, CircleAlert } from "lucide-react";
import { TextField } from "@/components/forms/TextField";
import { SelectField } from "@/components/forms/SelectField";
import { WeightSelector } from "@/components/forms/WeightSelector";
import { ChoiceChips } from "@/components/forms/ChoiceChips";
import { SegmentedToggle } from "@/components/forms/SegmentedToggle";
import { TagChipsField } from "@/components/forms/TagChipsField";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import {
  peopleFormSchema,
  RELATIONSHIP_TYPES,
  RELATIONSHIP_TYPE_LABELS,
  LAST_CONTACT_BUCKETS,
  LAST_CONTACT_BUCKET_LABELS,
  CONTEXT_TAGS_MAX,
} from "@/lib/validation/person";
import type { PersonFormProps, PersonRowState } from "./types";

const RELATIONSHIP_TYPE_OPTIONS = RELATIONSHIP_TYPES.map((value) => ({
  value,
  label: RELATIONSHIP_TYPE_LABELS[value],
}));

const COLLECTIVE_OPTIONS = [
  { value: "false", label: "Osoba" },
  { value: "true", label: "Grupa" },
];

const LAST_CONTACT_BUCKET_OPTIONS = LAST_CONTACT_BUCKETS.map((value) => ({
  value,
  label: LAST_CONTACT_BUCKET_LABELS[value],
}));

const TAG_MAX_LENGTH = 30;

function toOptionalString(value: string): string | undefined {
  return value.length > 0 ? value : undefined;
}

const textareaBase =
  "w-full rounded-lg bg-input border border-border px-3 py-2 text-foreground placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-ring transition-colors resize-none";

let nextRowId = 0;

function createEmptyRow(): PersonRowState {
  return {
    id: nextRowId++,
    name: "",
    relationshipType: "",
    description: "",
    isCollective: "false",
    weight: 0,
    relationshipContext: "",
    contextTags: [],
    lastContactBucket: "",
  };
}

const DRAFT_STORAGE_KEY = "intouch:add-person-draft";

// A draft is per-viewer convenience, not durable state -- any read/write
// failure (private browsing, storage disabled, corrupt JSON) is swallowed
// and simply falls back to no draft, never surfaced to the user.
function loadDraftRows(): PersonRowState[] | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const rows = parsed as PersonRowState[];
    nextRowId = Math.max(...rows.map((row) => row.id), -1) + 1;
    return rows;
  } catch {
    return null;
  }
}

function saveDraftRows(rows: PersonRowState[]) {
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // ignore -- see loadDraftRows
  }
}

function clearDraftRows() {
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore -- see loadDraftRows
  }
}

// `window` is undefined during Astro's server render pass of this
// client:load island; the lazy useState initializer below only actually
// reads localStorage once the same code runs again on the client during
// hydration. A visitor with a saved draft gets a one-render DOM patch from
// React's hydration mismatch recovery (dev-only console warning) rather
// than a visible empty-then-populated flash -- an accepted tradeoff for a
// fully client-interactive form island with nothing server-critical riding
// on the exact first-paint markup.
function getInitialRows(): PersonRowState[] {
  if (typeof window === "undefined") return [createEmptyRow()];
  return loadDraftRows() ?? [createEmptyRow()];
}

export default function PersonForm({ serverError }: PersonFormProps) {
  const [rows, setRows] = useState<PersonRowState[]>(getInitialRows);
  const [errors, setErrors] = useState<Record<number, Record<string, string> | undefined>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Persists on every change -- covers both "data in inputs" and "number of
  // people" (row count is just rows.length), so a refresh or accidental
  // navigation doesn't lose an in-progress multi-person entry.
  useEffect(() => {
    saveDraftRows(rows);
  }, [rows]);

  // Keeps the "+" add-person control in view after the row count changes.
  // Desktop lays the rows out as horizontally scrolling columns, mobile
  // stacks them down the page -- so only snap the scroller sideways when it
  // really overflows horizontally, otherwise bring the end of the stack into
  // view vertically.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (container.scrollWidth > container.clientWidth) {
      container.scrollTo({ left: container.scrollWidth, behavior: "smooth" });
      return;
    }
    container.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [rows.length]);

  function updateRow(id: number, patch: Partial<PersonRowState>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function clearRowError(id: number, field: string) {
    setErrors((prev) => {
      if (!prev[id]?.[field]) return prev;
      return { ...prev, [id]: { ...prev[id], [field]: "" } };
    });
  }

  function addRow() {
    setRows((prev) => [...prev, createEmptyRow()]);
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  }

  function validate() {
    const result = peopleFormSchema.safeParse(
      rows.map((row) => ({
        name: row.name,
        relationshipType: row.relationshipType,
        description: row.description,
        isCollective: row.isCollective === "true",
        weight: row.weight,
        relationshipContext: toOptionalString(row.relationshipContext),
        contextTags: row.contextTags.length > 0 ? row.contextTags : undefined,
        lastContactBucket: toOptionalString(row.lastContactBucket),
      })),
    );
    if (result.success) {
      setErrors({});
      return true;
    }
    const next: Record<number, Record<string, string> | undefined> = {};
    for (const issue of result.error.issues) {
      const [rowIndex, field] = issue.path;
      if (typeof rowIndex !== "number" || typeof field !== "string") continue;
      const rowId = rows[rowIndex].id;
      const rowErrors = next[rowId] ?? {};
      if (!rowErrors[field]) rowErrors[field] = issue.message;
      next[rowId] = rowErrors;
    }
    setErrors(next);
    return false;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
      return;
    }
    // This is a native form POST (full-page navigation), not fetch -- there
    // is no client-side "request succeeded" moment to hook after the
    // redirect. Clearing here, right as a validated submission is let
    // through, is the last point this component is still mounted.
    clearDraftRows();
  }

  return (
    <form
      method="POST"
      action="/api/people"
      className="flex flex-col gap-4 md:h-full"
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="font-display text-display-sm text-foreground">Dodaj osoby</h1>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <ServerError message={serverError} />
          {/* Mobile stacks the people down the page, so its save button sits
              at the very bottom of the form instead (rendered below). */}
          <div className="hidden md:block">
            <SubmitButton pendingText="Zapisywanie..." icon={<UserPlus className="size-4" />}>
              Zapisz osoby
            </SubmitButton>
          </div>
        </div>
      </div>

      {/* From md up each person is a fixed-width column so adding one shows up
          beside the existing ones (overflow-x-auto scrolls right as columns
          overflow the available width) instead of growing the page downward --
          field spacing below is deliberately tighter than the shared
          components' own defaults so one column's 8 fields fit a typical
          viewport height without its own vertical scroll. On mobile there is
          no room for side-by-side columns, so people stack one under another
          and the page scrolls vertically as usual. */}
      <div
        ref={scrollContainerRef}
        className="scrollbar-hide flex flex-1 flex-col gap-6 md:flex-row md:items-start md:gap-4 md:overflow-x-auto md:pb-2"
      >
        {rows.map((row, index) => {
          const rowErrors = errors[row.id] ?? {};
          return (
            <div
              key={row.id}
              className="border-border flex w-full shrink-0 flex-col gap-3 border-b pb-6 last:border-b-0 last:pb-0 md:w-80 md:border-r md:border-b-0 md:pr-4 md:pb-0 md:last:border-r-0 md:last:pr-0"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-muted-foreground text-sm font-medium">Osoba {index + 1}</h2>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      removeRow(row.id);
                    }}
                    className="text-text-tertiary hover:text-destructive inline-flex items-center gap-1 text-xs"
                  >
                    <Trash2 className="size-3.5" />
                    Usuń
                  </button>
                )}
              </div>

              <TextField
                id={`name-${index}`}
                label="Imię"
                value={row.name}
                onChange={(v) => {
                  updateRow(row.id, { name: v });
                  clearRowError(row.id, "name");
                }}
                placeholder="np. Marek"
                error={rowErrors.name}
                icon={<UserRound className="size-4" />}
              />

              <SelectField
                id={`relationshipType-${index}`}
                label="Typ relacji"
                value={row.relationshipType}
                onChange={(v) => {
                  updateRow(row.id, { relationshipType: v });
                  clearRowError(row.id, "relationshipType");
                }}
                options={RELATIONSHIP_TYPE_OPTIONS}
                placeholder="Wybierz typ relacji"
                error={rowErrors.relationshipType}
              />

              <div>
                <label htmlFor={`description-${index}`} className="text-muted-foreground mb-1 block text-sm">
                  Opis
                </label>
                <textarea
                  id={`description-${index}`}
                  name={`description-${index}`}
                  rows={2}
                  value={row.description}
                  onChange={(e) => {
                    updateRow(row.id, { description: e.target.value });
                    clearRowError(row.id, "description");
                  }}
                  placeholder="np. mieszka w Krakowie, uwielbia wspinaczkę"
                  className={cn(textareaBase, rowErrors.description && "border-destructive focus:ring-destructive")}
                />
                {rowErrors.description && (
                  <p className="text-destructive mt-1 flex items-center gap-1 text-xs">
                    <CircleAlert className="size-3" />
                    {rowErrors.description}
                  </p>
                )}
              </div>

              <SegmentedToggle
                id={`isCollective-${index}`}
                name={`isCollective-${index}`}
                label="Osoba czy grupa"
                value={row.isCollective}
                onChange={(v) => {
                  updateRow(row.id, { isCollective: v });
                }}
                options={COLLECTIVE_OPTIONS}
              />

              <TextField
                id={`relationshipContext-${index}`}
                name={`relationshipContext-${index}`}
                label="Kim jest dla Ciebie?"
                value={row.relationshipContext}
                onChange={(v) => {
                  updateRow(row.id, { relationshipContext: v });
                  clearRowError(row.id, "relationshipContext");
                }}
                placeholder="np. przyjaciel ze studiów"
                error={rowErrors.relationshipContext}
              />

              <TagChipsField
                id={`contextTags-${index}`}
                name={`contextTags-${index}`}
                label="Co go cieszy, co jest u niego ważne?"
                value={row.contextTags}
                onChange={(tags) => {
                  updateRow(row.id, { contextTags: tags });
                  clearRowError(row.id, "contextTags");
                }}
                max={CONTEXT_TAGS_MAX}
                tagMaxLength={TAG_MAX_LENGTH}
                error={rowErrors.contextTags}
              />

              <WeightSelector
                name={`weight-${index}`}
                value={row.weight}
                onChange={(v) => {
                  updateRow(row.id, { weight: v });
                  clearRowError(row.id, "weight");
                }}
                label="Waga relacji (1–10)"
                error={rowErrors.weight}
              />

              <ChoiceChips
                id={`lastContactBucket-${index}`}
                name={`lastContactBucket-${index}`}
                label="Kiedy ostatnio rozmawialiście?"
                mode="single"
                options={LAST_CONTACT_BUCKET_OPTIONS}
                value={row.lastContactBucket ? [row.lastContactBucket] : []}
                onChange={(selected) => {
                  updateRow(row.id, { lastContactBucket: selected[0] ?? "" });
                }}
              />
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-[3rem] w-full shrink-0 md:w-16 md:self-stretch"
          onClick={addRow}
        >
          <Plus className="size-4" />
          <span className="md:hidden">Dodaj kolejną osobę</span>
        </Button>
      </div>

      <div className="md:hidden">
        <SubmitButton pendingText="Zapisywanie..." icon={<UserPlus className="size-4" />}>
          Zapisz osoby
        </SubmitButton>
      </div>
    </form>
  );
}
