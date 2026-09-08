import { POSTHOG_API_KEY } from "astro:env/server";

/**
 * PostHog Cloud EU's public ingestion host.
 *
 * A module constant rather than a second secret, because the region is a
 * settled ONE-WAY DOOR: moving a project between Cloud EU and Cloud US needs
 * PostHog support and a paid plan. EU (Frankfurt) is chosen deliberately --
 * this app holds personal data about third parties and the user base is Polish,
 * so EU residency is the defensible default even though no third-party data is
 * ever meant to reach an event payload.
 *
 * Public endpoints are `eu.i.posthog.com`; `eu.posthog.com` is the private-API
 * host and is NOT what /i/v0/e/ lives on.
 */
const POSTHOG_HOST = "https://eu.i.posthog.com";

export interface AnalyticsConfig {
  apiKey: string;
  host: string;
}

/**
 * Resolve the PostHog config, or `null` when the key is absent.
 *
 * Same null-returning factory convention as src/lib/openai.ts and
 * src/lib/resend.ts (originating at src/lib/supabase.ts): a missing key
 * disables analytics silently and breaks nothing else. Never memoized, matching
 * those two.
 *
 * Deliberately NOT registered in src/lib/config-status.ts. That module's
 * `missingConfigs` renders a Polish banner to END USERS on every page
 * (src/layouts/Layout.astro), and an absent analytics key breaks nothing a user
 * can see -- surfacing it there would advertise an internal ops gap to the
 * wrong audience. This matches what OPENAI_API_KEY and RESEND_API_KEY actually
 * did, and diverges from config-status.ts's stated contract knowingly.
 */
export function getAnalyticsConfig(): AnalyticsConfig | null {
  if (!POSTHOG_API_KEY) {
    return null;
  }
  return { apiKey: POSTHOG_API_KEY, host: POSTHOG_HOST };
}
