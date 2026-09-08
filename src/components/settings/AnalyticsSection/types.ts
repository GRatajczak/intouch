export interface AnalyticsSectionProps {
  /**
   * Whether product-analytics events are currently being sent for this user.
   *
   * Positive polarity on purpose, matching the wire contract and the switch --
   * the column it comes from is the negative `profiles.analytics_opt_out`, and
   * settings.astro is where that inversion happens for the initial render.
   */
  analyticsEnabled: boolean;
}
