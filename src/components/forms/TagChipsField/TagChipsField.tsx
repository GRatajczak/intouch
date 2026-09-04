import { useState } from "react";
import { CircleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TagChipsFieldProps } from "./types";

// Radius/padding/font-size match the design bundle's tag chips exactly
// (`.ai/intouch-design-preparation/project/InTouch.dc.html:629-631`) --
// deliberately not the app's rounded-full pill scale, since the mock draws
// context tags as softer rounded rectangles, distinct from ChoiceChips'
// fully-pill bucket/rhythm chips.
const chipBase =
  "inline-flex items-center gap-1 rounded-[12px] border px-[13px] py-[9px] text-[13px] bg-accent border-accent-foreground/20 text-accent-foreground font-semibold";

const inputBase =
  "min-w-[9rem] flex-1 rounded-[12px] border border-dashed border-border bg-transparent px-[13px] py-[9px] text-[13px] text-foreground placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-ring transition-colors";

/**
 * Freeform tag chips, capped at `max` -- Enter (or a trailing comma) commits
 * the draft input as a new chip; each existing chip's `×` removes it. Tags
 * serialize as repeated same-named hidden inputs (`form.getAll(name)` on the
 * server, `src/lib/validation/person.ts`'s `getTags`), matching how
 * `ChoiceChips` already serializes its own multi-select values.
 */
export function TagChipsField({
  id,
  name,
  label,
  value,
  onChange,
  max,
  tagMaxLength,
  error,
  hint,
}: TagChipsFieldProps) {
  const [draft, setDraft] = useState("");
  const atCap = value.length >= max;

  function commitDraft() {
    const tag = draft.trim().slice(0, tagMaxLength);
    setDraft("");
    if (!tag || atCap || value.includes(tag)) return;
    onChange([...value, tag]);
  }

  function removeTag(tag: string) {
    onChange(value.filter((v) => v !== tag));
  }

  return (
    <div>
      <label htmlFor={id} className="text-muted-foreground mb-2 block text-sm">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((tag) => (
          <span key={tag} className={chipBase}>
            {tag}
            <button
              type="button"
              onClick={() => {
                removeTag(tag);
              }}
              aria-label={`Usuń tag ${tag}`}
              className="hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {!atCap && (
          <input
            id={id}
            value={draft}
            onChange={(e) => {
              const next = e.target.value;
              if (next.endsWith(",")) {
                setDraft(next.slice(0, -1));
                commitDraft();
                return;
              }
              setDraft(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              }
            }}
            onBlur={commitDraft}
            placeholder="+ dopisz"
            className={cn(inputBase, error && "border-destructive focus:ring-destructive")}
          />
        )}
      </div>
      {error ? (
        <p className="text-destructive mt-1 flex items-center gap-1 text-xs">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : (
        hint
      )}
      {value.map((tag) => (
        <input key={tag} type="hidden" name={name} value={tag} />
      ))}
    </div>
  );
}
