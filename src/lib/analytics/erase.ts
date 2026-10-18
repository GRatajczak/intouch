import { POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID } from "astro:env/server";

/**
 * PostHog Cloud EU's PRIVATE API host. Not the ingest host in ./config.ts
 * (`eu.i.posthog.com`), which only accepts event writes.
 */
const POSTHOG_PRIVATE_HOST = "https://eu.posthog.com";

/**
 * Ask PostHog to delete the person and their events for one distinct id.
 *
 * Contract (PostHog's REST API, checked via ctx7):
 * `POST /api/projects/:project_id/persons/bulk_delete` with a PERSONAL api key
 * (not the project token the capture path uses), body
 * `{ ids: [], distinct_ids: [<id>], delete_events: true }`. `ids` is documented
 * as required, hence the empty array. Not yet confirmed against a live request.
 *
 * Fail-soft by design, in both directions:
 *  - with either secret absent it returns silently, so deployments that never
 *    configured it still delete accounts;
 *  - it NEVER throws. A PostHog outage must not block the user's right to
 *    erasure, so a non-2xx response or a failed fetch logs `[analytics] ...`
 *    (same convention as ./capture.ts) and resolves.
 *
 * Callers run this BEFORE deleting the account, so a retry after a PostHog
 * failure is safe: a second bulk_delete for an absent person is a no-op.
 *
 * Residual: server events are sent with `$process_person_profile: false`, so
 * PostHog may hold no person to link them to; `delete_events` then removes
 * nothing for them. Those events carry only the pseudonymous user id. The
 * privacy policy has to say so.
 */
export async function eraseAnalyticsSubject(distinctId: string): Promise<void> {
  if (!POSTHOG_PERSONAL_API_KEY || !POSTHOG_PROJECT_ID) {
    console.warn("[analytics] erasure skipped: POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID is not set");
    return;
  }

  try {
    const response = await fetch(
      `${POSTHOG_PRIVATE_HOST}/api/projects/${encodeURIComponent(POSTHOG_PROJECT_ID)}/persons/bulk_delete/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${POSTHOG_PERSONAL_API_KEY}`,
        },
        body: JSON.stringify({ ids: [], distinct_ids: [distinctId], delete_events: true }),
      },
    );

    if (!response.ok) {
      console.error(`[analytics] erasure failed for ${distinctId}: PostHog answered ${response.status.toString()}`);
    }
  } catch (err: unknown) {
    console.error(`[analytics] erasure failed for ${distinctId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
