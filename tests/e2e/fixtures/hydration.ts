// The hydration barrier, and the one place a CSS selector is allowed.
//
// Every interactive surface in this app is an Astro island (`client:load`).
// Astro server-renders the island's markup with an `ssr` attribute and its
// client runtime removes that attribute once React has hydrated
// (astro-island.prebuilt.js: `this.removeAttribute("ssr")`, immediately before
// it dispatches `astro:hydrate`).
//
// Until that moment the button is in the DOM, visible, and enabled -- so
// Playwright's actionability checks pass -- but no React handler is attached
// yet. A click in that window is swallowed silently: no error, no request, no
// state change, and a test that fails minutes later on an assertion about the
// state that never arrived. It is intermittent by nature, because it depends on
// how fast Vite serves the island's modules.
//
// Waiting for `astro-island[ssr]` to reach zero is waiting for state, not for
// time -- it is the app telling us it is interactive. The E2E rules forbid CSS
// selectors for locating UI; this is an infrastructure barrier, not a locator,
// which is why it lives here rather than in a spec.
import { expect, type Page } from "@playwright/test";

/** Blocks until every island on the current page has hydrated. */
export async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

/** `page.goto` plus the hydration barrier. Use this instead of a bare `goto`. */
export async function gotoHydrated(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitForHydration(page);
}
