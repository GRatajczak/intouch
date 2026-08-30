import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SelectFieldProps } from "./types";

const selectBase =
  "w-full rounded-lg bg-input border border-border px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors";

export function SelectField({ id, name, label, value, onChange, options, placeholder, error, hint }: SelectFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="text-muted-foreground mb-1 block text-sm">
        {label}
      </label>
      <select
        id={id}
        name={name ?? id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className={cn(selectBase, error && "border-destructive focus:ring-destructive")}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p className="text-destructive mt-1 flex items-center gap-1 text-xs">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : (
        hint
      )}
    </div>
  );
}
