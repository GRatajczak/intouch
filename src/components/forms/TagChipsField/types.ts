import type { ReactNode } from "react";

export interface TagChipsFieldProps {
  id: string;
  name: string;
  label: string;
  value: string[];
  onChange: (tags: string[]) => void;
  max: number;
  tagMaxLength: number;
  error?: string;
  hint?: ReactNode;
}
