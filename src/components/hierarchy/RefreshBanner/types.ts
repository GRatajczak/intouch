export type RefreshBannerStatus = "fresh" | "refreshing" | "failed";

export interface RefreshBannerProps {
  status: RefreshBannerStatus;
  /** Present only when a ranking is actually stored -- absent covers the two "nothing stored yet" cases. */
  createdAt: string | null;
  peopleConsidered: number | null;
  peopleTotal: number | null;
  hasStoredRanking: boolean;
  /** At least one contact_events answer was recorded since this ranking was computed. */
  hasPendingAnswers: boolean;
  onRefresh: () => void;
}
