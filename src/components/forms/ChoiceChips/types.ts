import type { ReactNode } from "react";

export interface ChoiceChipOption {
  value: string;
  label: string;
}

export interface ChoiceChipsProps {
  id: string;
  name: string;
  label: string;
  options: ChoiceChipOption[];
  value: string[];
  onChange: (value: string[]) => void;
  mode: "single" | "multi";
  hint?: ReactNode;
}
