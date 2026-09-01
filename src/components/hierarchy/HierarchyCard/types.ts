import type { RankingEntryViewModel } from "@/lib/ranking/store";

export interface HierarchyCardProps {
  entry: RankingEntryViewModel;
  rank: number;
  expanded: boolean;
  onToggleExpanded: (personId: string) => void;
}
