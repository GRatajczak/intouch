import type { RankingEntryViewModel } from "@/lib/ranking/store";
import type { ContactFacts } from "@/lib/contact-history/facts";

export interface HierarchyCardProps {
  entry: RankingEntryViewModel;
  rank: number;
  expanded: boolean;
  onToggleExpanded: (personId: string) => void;
  facts: ContactFacts | null;
  onMarked: (personId: string, facts: ContactFacts | null) => void;
}
