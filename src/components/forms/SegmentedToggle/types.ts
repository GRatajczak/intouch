import type { ReactNode } from "react";

export interface SegmentedToggleOption {
  value: string;
  label: string;
}

export interface SegmentedToggleProps {
  id: string;
  name: string;
  label: string;
  options: SegmentedToggleOption[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
}
