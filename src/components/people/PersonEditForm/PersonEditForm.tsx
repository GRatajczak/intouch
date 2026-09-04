import { useState } from "react";
import { UserRound, Check, X } from "lucide-react";
import { TextField } from "@/components/forms/TextField";
import { SelectField } from "@/components/forms/SelectField";
import { WeightSelector } from "@/components/forms/WeightSelector";
import { ChoiceChips } from "@/components/forms/ChoiceChips";
import { SegmentedToggle } from "@/components/forms/SegmentedToggle";
import { TagChipsField } from "@/components/forms/TagChipsField";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/layout/Toaster/toast";
import {
  personSchema,
  RELATIONSHIP_TYPES,
  RELATIONSHIP_TYPE_LABELS,
  LAST_CONTACT_BUCKETS,
  LAST_CONTACT_BUCKET_LABELS,
  CONTEXT_TAGS_MAX,
} from "@/lib/validation/person";
import type { Tables } from "@/db/database.types";
import type { PersonEditFormProps, PersonEditFormState } from "./types";

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

function toInitialState(person: Tables<"people">): PersonEditFormState {
  return {
    name: person.name,
    relationshipType: person.relationship_type,
    description: person.description,
    isCollective: person.is_collective ? "true" : "false",
    weight: person.weight,
    relationshipContext: person.relationship_context ?? "",
    contextTags: person.context_tags,
    lastContactBucket: person.last_contact_bucket ?? "",
  };
}

interface PatchResponse {
  person?: Tables<"people">;
  error?: string;
}

/**
 * Single-person edit, pre-filled from `person`. Validates against
 * `personSchema` directly (not `peopleFormSchema`'s array wrapper) and
 * submits as a fetch-driven PATCH, unlike PersonForm's native multipart
 * POST -- plan.md Phase 4 §4.
 */
export function PersonEditForm({ person, onSaved, onCancel }: PersonEditFormProps) {
  const [state, setState] = useState<PersonEditFormState>(() => toInitialState(person));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function update(patch: Partial<PersonEditFormState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  function clearError(field: string) {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: "" } : prev));
  }

  function validate() {
    const result = personSchema.safeParse({
      name: state.name,
      relationshipType: state.relationshipType,
      description: state.description,
      isCollective: state.isCollective === "true",
      weight: state.weight,
      relationshipContext: toOptionalString(state.relationshipContext),
      contextTags: state.contextTags.length > 0 ? state.contextTags : undefined,
      lastContactBucket: toOptionalString(state.lastContactBucket),
    });
    if (result.success) {
      setErrors({});
      // This is a full-form edit (every field always present), so an empty
      // optional field means "clear it," not "not entered" -- send `null`,
      // not `undefined`, since JSON.stringify drops undefined keys and the
      // route would then leave the old value in place (personUpdateSchema
      // accepts null for these three fields precisely for this case).
      return {
        ...result.data,
        relationshipContext: result.data.relationshipContext ?? null,
        contextTags: result.data.contextTags ?? null,
        lastContactBucket: result.data.lastContactBucket ?? null,
      };
    }
    const next: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (typeof field !== "string") continue;
      if (!next[field]) next[field] = issue.message;
    }
    setErrors(next);
    return null;
  }

  async function handleSave() {
    const values = validate();
    if (!values) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body: PatchResponse = await res.json();
      if (!res.ok || !body.person) {
        throw new Error(body.error ?? "Nie udało się zapisać zmian");
      }
      onSaved(body.person);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Nie udało się zapisać zmian");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <TextField
        id="edit-name"
        label="Imię"
        value={state.name}
        onChange={(v) => {
          update({ name: v });
          clearError("name");
        }}
        placeholder="np. Marek"
        error={errors.name}
        icon={<UserRound className="size-4" />}
      />

      <SelectField
        id="edit-relationshipType"
        label="Typ relacji"
        value={state.relationshipType}
        onChange={(v) => {
          update({ relationshipType: v });
          clearError("relationshipType");
        }}
        options={RELATIONSHIP_TYPE_OPTIONS}
        placeholder="Wybierz typ relacji"
        error={errors.relationshipType}
      />

      <div>
        <label htmlFor="edit-description" className="text-muted-foreground mb-1 block text-sm">
          Opis
        </label>
        <textarea
          id="edit-description"
          rows={3}
          value={state.description}
          onChange={(e) => {
            update({ description: e.target.value });
            clearError("description");
          }}
          placeholder="np. mieszka w Krakowie, uwielbia wspinaczkę"
          className="bg-input border-border text-foreground placeholder-text-tertiary focus:ring-ring w-full resize-none rounded-lg border px-3 py-2 transition-colors focus:ring-2 focus:outline-none"
        />
        {errors.description && <p className="text-destructive mt-1 text-xs">{errors.description}</p>}
      </div>

      <SegmentedToggle
        id="edit-isCollective"
        name="isCollective"
        label="Osoba czy grupa"
        value={state.isCollective}
        onChange={(v) => {
          update({ isCollective: v });
        }}
        options={COLLECTIVE_OPTIONS}
      />

      <TextField
        id="edit-relationshipContext"
        label="Kim jest dla Ciebie?"
        value={state.relationshipContext}
        onChange={(v) => {
          update({ relationshipContext: v });
          clearError("relationshipContext");
        }}
        placeholder="np. przyjaciel ze studiów"
        error={errors.relationshipContext}
      />

      <TagChipsField
        id="edit-contextTags"
        name="contextTags"
        label="Co go cieszy, co jest u niego ważne?"
        value={state.contextTags}
        onChange={(tags) => {
          update({ contextTags: tags });
          clearError("contextTags");
        }}
        max={CONTEXT_TAGS_MAX}
        tagMaxLength={TAG_MAX_LENGTH}
        error={errors.contextTags}
      />

      <WeightSelector
        name="weight"
        value={state.weight}
        onChange={(v) => {
          update({ weight: v });
          clearError("weight");
        }}
        label="Waga relacji (1–10)"
        error={errors.weight}
      />

      <ChoiceChips
        id="edit-lastContactBucket"
        name="lastContactBucket"
        label="Kiedy ostatnio rozmawialiście?"
        mode="single"
        options={LAST_CONTACT_BUCKET_OPTIONS}
        value={state.lastContactBucket ? [state.lastContactBucket] : []}
        onChange={(selected) => {
          update({ lastContactBucket: selected[0] ?? "" });
        }}
      />

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            void handleSave();
          }}
        >
          <Check className="size-4" />
          Zapisz
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          <X className="size-4" />
          Anuluj
        </Button>
      </div>
    </div>
  );
}
