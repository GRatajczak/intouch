export interface AnalyticsSectionProps {
  /**
   * Whether product-analytics events are currently being sent for this user.
   *
   * Positive polarity on purpose, matching the wire contract and the switch --
   * it comes from `profiles.analytics_consent === true`, so a never-asked
   * profile reads as off.
   */
  analyticsEnabled: boolean;
}
