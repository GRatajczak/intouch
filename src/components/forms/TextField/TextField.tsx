import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TextFieldProps } from "./types";

const inputBase =
  "w-full rounded-lg bg-input border border-border px-3 py-2 text-foreground placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-ring transition-colors";

export function TextField({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  error,
  hint,
  icon,
}: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="text-muted-foreground mb-1 block text-sm">
        {label}
      </label>
      <div className="relative">
        {icon && <span className="text-text-tertiary absolute top-1/2 left-3 size-4 -translate-y-1/2">{icon}</span>}
        <input
          id={id}
          name={name ?? id}
          type={type}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          className={cn(inputBase, icon && "pl-10", error && "border-destructive focus:ring-destructive")}
        />
      </div>
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
