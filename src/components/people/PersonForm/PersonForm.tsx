import React, { useState } from "react";
import { UserRound, UserPlus, Plus, Trash2, CircleAlert } from "lucide-react";
import { TextField } from "@/components/forms/TextField";
import { SelectField } from "@/components/forms/SelectField";
import { WeightSelector } from "@/components/forms/WeightSelector";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import { peopleFormSchema, RELATIONSHIP_TYPES, RELATIONSHIP_TYPE_LABELS } from "@/lib/validation/person";
import type { PersonFormProps, PersonRowState } from "./types";

const RELATIONSHIP_TYPE_OPTIONS = RELATIONSHIP_TYPES.map((value) => ({
  value,
  label: RELATIONSHIP_TYPE_LABELS[value],
}));

const COLLECTIVE_OPTIONS = [
  { value: "false", label: "Osoba" },
  { value: "true", label: "Grupa" },
];

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
  };
}

export default function PersonForm({ serverError }: PersonFormProps) {
  const [rows, setRows] = useState<PersonRowState[]>(() => [createEmptyRow()]);
  const [errors, setErrors] = useState<Record<number, Record<string, string> | undefined>>({});

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
    }
  }

  return (
    <form method="POST" action="/api/people" className="space-y-6" onSubmit={handleSubmit} noValidate>
      {rows.map((row, index) => {
        const rowErrors = errors[row.id] ?? {};
        return (
          <div key={row.id} className="border-border space-y-4 border-b pb-6 last:border-b-0 last:pb-0">
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
                rows={3}
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

            <SelectField
              id={`isCollective-${index}`}
              label="Osoba czy grupa"
              value={row.isCollective}
              onChange={(v) => {
                updateRow(row.id, { isCollective: v });
              }}
              options={COLLECTIVE_OPTIONS}
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
          </div>
        );
      })}

      <Button type="button" variant="outline" className="w-full" onClick={addRow}>
        <Plus className="size-4" />
        Dodaj kolejną osobę
      </Button>

      <ServerError message={serverError} />

      <SubmitButton pendingText="Zapisywanie..." icon={<UserPlus className="size-4" />}>
        Zapisz osoby
      </SubmitButton>
    </form>
  );
}
