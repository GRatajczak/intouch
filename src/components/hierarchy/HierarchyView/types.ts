import type { RankingViewModel } from "@/lib/ranking/store";

export interface HierarchyViewProps {
  initialRanking: RankingViewModel | null;
  staleOnLoad: boolean;
}
