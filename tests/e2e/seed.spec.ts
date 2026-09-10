// THE EXEMPLAR. Every generated E2E test in this project is modelled on this file.
//
// Playwright's own docs say the planner and generator use the seed test as the
// example for everything they produce -- so what is demonstrated here is what
// comes back. Five patterns are on purpose:
//
//   1. Role- and label-based locators. `getByRole` / `getByLabel` survive class
//      renames, DOM restructuring and component refactors. No CSS, no XPath.
//   2. Test independence. Setup, action, assertion and cleanup all live in this
//      one test. It runs standalone, in parallel, in any order.
//   3. Waiting for state, never for time. `toBeVisible()`, `waitForURL()`, and
//      the hydration barrier below. There is no `waitForTimeout` in this suite
//      and there must never be one.
//   4. Unique test data. A `Date.now()` suffix, so a re-run or a parallel worker
//      never collides with a leftover row.
//   5. Never interact with an island before it has hydrated -- see
//      `fixtures/hydration.ts` for why this is not optional in an Astro app.
//
// The scenario itself is the cheapest honest end-to-end statement this app can
// make: a person entered through the real form, through real auth, routing and
// Postgres, is still there after a real SSR reload.
//
// Cleanup here is per-test; the run's throwaway user is deleted wholesale by
// auth.teardown.ts, which is the safety net for a test that dies before its own
// cleanup runs. Unique ids prevent collisions, cleanup prevents accumulation --
// both, not either.
import { test, expect } from "@playwright/test";
import { gotoHydrated, waitForHydration } from "./fixtures/hydration";

test("a person added through the form is still there after a page reload", async ({ page }) => {
  const personName = `Seed Osoba ${Date.now()}`;

  // --- setup: open the real add-person form as the signed-in test user
  await gotoHydrated(page, "/people/new");
  await expect(page.getByRole("heading", { name: "Dodaj osoby" })).toBeVisible();

  // --- action: fill every field the server-side schema requires and submit
  await page.getByLabel("Imię").fill(personName);
  await page.getByLabel("Typ relacji").selectOption("friend");
  await page.getByLabel("Opis", { exact: true }).fill("Utworzona przez seed test E2E.");
  await page.getByRole("button", { name: "Waga 7" }).click();
  await page.getByRole("button", { name: "Zapisz osoby" }).click();

  // The form is a native POST that redirects to /people -- waiting for the URL
  // is what proves the round trip landed, not an arbitrary pause.
  await page.waitForURL("**/people");
  await expect(page.getByRole("heading", { name: personName })).toBeVisible();

  // --- assertion: the data survives a real reload, not just a client re-render
  await page.reload();
  await expect(page.getByRole("heading", { name: personName })).toBeVisible();

  // --- cleanup: the app enforces deactivate-before-delete, so both steps run
  await page.getByRole("link", { name: personName }).click();
  await page.waitForURL(/\/people\/[0-9a-f-]+$/);
  await waitForHydration(page);

  await page.getByRole("button", { name: "Dezaktywuj" }).click();
  // `exact` is load-bearing: accessible-name matching is a case-insensitive
  // substring, and "Dezaktywuj" contains "aktywuj" -- without it this assertion
  // passes against the button that never changed.
  await expect(page.getByRole("button", { name: "Aktywuj", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Usuń na zawsze" }).click();
  const confirmDialog = page.getByRole("alertdialog");
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Usuń na zawsze" }).click();

  await page.waitForURL("**/people");
  await expect(page.getByRole("heading", { name: personName })).toHaveCount(0);
});
