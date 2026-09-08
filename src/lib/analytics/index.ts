import { capture } from "./capture";
import type { AnalyticsEvent } from "./events";

export type { AnalyticsEvent, AnalyticsEventName } from "./events";
export { capture } from "./capture";
export { hasAnalyticsConsent, consentFromOptOut } from "./consent";
export { getAnalyticsConfig } from "./config";
export type { AnalyticsConfig } from "./config";

/**
 * Fire one catalog event from an API route without putting it in the response
 * path. Synchronous -- callers never await it, and must construct and return
 * their response as if this call were not here.
 *
 * The `waitUntil`-or-warn shape mirrors src/pages/api/rankings.ts verbatim, so
 * no route has to repeat it. `cfContext` is optional on App.Locals (only the
 * Cloudflare handler sets it), which is why the fallback exists at all.
 *
 * Not used by src/lib/ranking/run.ts: that function already executes inside
 * `rankings.ts`'s `waitUntil`, so it awaits `capture()` directly and has no
 * `cfContext` in scope.
 */
export function dispatch(cfContext: App.Locals["cfContext"], distinctId: string, event: AnalyticsEvent): void {
  const work = capture(distinctId, event);
  if (cfContext) {
    cfContext.waitUntil(work);
    return;
  }
  // Not running under the Cloudflare handler, so there is no ExecutionContext
  // to keep the Worker alive. Leave the promise unawaited -- the response still
  // returns immediately, but nothing guarantees the capture finishes.
  console.warn(`[analytics] ${event.event}: no cfContext, delivery is not guaranteed`);
  void work;
}
