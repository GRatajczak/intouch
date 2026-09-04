import type { RankingViewModel } from "@/lib/ranking/store";
import type { ContactFacts } from "@/lib/contact-history/facts";

export interface HierarchyViewProps {
  initialRanking: RankingViewModel | null;
  staleOnLoad: boolean;
  /** Keyed by person id -- a plain object since a Map doesn't survive island serialization. */
  initialFacts: Record<string, ContactFacts>;
  /** Whether at least one contact_events answer was recorded after the stored ranking's createdAt. */
  hasPendingAnswers: boolean;
}
