import { getAnalyticsConfig } from "./config";
import type { AnalyticsEvent } from "./events";

/**
 * The only place in this app that talks to PostHog.
 *
 * Transport is a bare `fetch` POST to PostHog's public capture endpoint, not
 * `posthog-node`: the SDK's batching is the first thing PostHog's own Workers
 * recipe disables, and retries and typings are not worth a dependency for five
 * fire-and-forget events. Contract (verified against PostHog's capture API
 * docs): `POST <host>/i/v0/e/` with `Content-Type: application/json` and a body
 * of `{ api_key, event, distinct_id, properties?, timestamp? }`.
 *
 * `distinctId` is the Supabase user id and nothing else -- never an email.
 *
 * NEVER THROWS. A non-2xx response or a failed fetch logs `[analytics] ...`
 * (mirroring the `[ranking]` convention in src/lib/ranking/run.ts) and resolves
 * normally. A failed capture must not be able to turn a successful profile save
 * into an error response.
 *
 * Callers do not call this directly from a request path -- see `dispatch()` in
 * ./index.ts, which defers it through `cfContext.waitUntil()`. The one direct
 * caller is src/lib/ranking/run.ts, which already runs inside a `waitUntil`.
 */
export async function capture(distinctId: string, event: AnalyticsEvent): Promise<void> {
  const config = getAnalyticsConfig();
  if (!config) {
    return;
  }

  // The event's own allow-listed properties (see ./events.ts) plus one PostHog
  // control flag. `$process_person_profile: false` suppresses person-profile
  // creation: a funnel needs only consistently named events sharing a
  // distinct_id, and a profile would pull user-level attributes into the vendor
  // for nothing.
  const properties = {
    ...(event.properties ?? {}),
    $process_person_profile: false,
  };

  try {
    const response = await fetch(`${config.host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.apiKey,
        event: event.event,
        distinct_id: distinctId,
        properties,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.error(`[analytics] capture of ${event.event} returned ${String(response.status)}`);
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[analytics] capture of ${event.event} failed: ${message}`);
  }
}
