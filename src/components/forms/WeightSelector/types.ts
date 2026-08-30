export interface WeightSelectorProps {
  name?: string;
  value: number;
  onChange: (value: number) => void;
  label: string;
  error?: string;
}
