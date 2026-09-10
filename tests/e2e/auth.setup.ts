// The one place the sign-in UI is a dependency of anything.
//
// Every other spec starts already signed in through `storageState`, so a change
// to the sign-in form breaks this file and nothing else. The sign-in path itself
// is covered on cheaper layers (tests/http mints its cookie jars through the
// same route); what this file needs from it is a real browser cookie jar.
//
// It also costs exactly one of the 30-per-5-minutes sign-ins that
// supabase/config.toml allows per IP -- a per-test sign-in would not fit that
// budget alongside the Vitest suite's ~18.
import { test as setup, expect } from "@playwright/test";
import { AUTH_STATE_PATH, createTestUser } from "./fixtures/test-user";
import { gotoHydrated } from "./fixtures/hydration";

setup("sign in once and save the session", async ({ page }) => {
  const user = await createTestUser();

  // Sign-in redirects to `/`, which redirects to /dashboard -- and the seeded
  // user has a profile and people but no ranking, so HierarchyView mounts
  // "stale" and immediately POSTs /api/rankings. On a dev server holding a real
  // OPENAI_API_KEY that is a real, paid model call on every single E2E run.
  // Aborting the request in the browser means it never reaches the server.
  // No spec may ever let this route through unmocked -- see E2E_RULES.md.
  await page.route("**/api/rankings*", (route) => route.abort());

  await gotoHydrated(page, "/auth/signin");
  await expect(page.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();

  await page.getByLabel("Adres e-mail").fill(user.email);
  // `exact` matters: the show/hide toggle beside the field is labelled
  // "Pokaż hasło", and getByLabel matches substrings by default.
  await page.getByLabel("Hasło", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  // /api/auth/signin redirects to `/`, which redirects a signed-in visitor to
  // /dashboard. Waiting for the final URL proves the cookie survived both hops.
  await page.waitForURL("**/dashboard");

  await page.context().storageState({ path: AUTH_STATE_PATH });
});
