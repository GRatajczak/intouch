// Risk #5 (context/foundation/test-plan.md §2): "An unauthenticated visitor, or
// a stale/replayed password-recovery token, reaches relationship data." Impact
// High.
//
// The recovery-token half is already proven at the route layer
// (tests/routes/recovery-token.test.ts). This file covers the half nothing
// cheaper can reach: a real browser cookie jar crossing real middleware on a
// real SSR page load. §7 of the test plan named exactly this case as the reason
// to reconsider its own no-E2E exclusion -- "a cookie/session crossing the
// Workers boundary is the likeliest candidate".
//
// Nothing is mocked here. Auth, middleware, routing, SSR and Postgres are all
// real; that is the entire point of the test.
import { test, expect } from "@playwright/test";
import { readTestUser } from "./fixtures/test-user";

const PROTECTED_ROUTES = ["/dashboard", "/people", "/profile", "/settings"];

test.describe("signed out", () => {
  // Opting out of the suite-wide storageState for these tests only. Everything
  // else in the run stays signed in.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a browser with no session reaches no protected route and no relationship data", async ({ page }) => {
    const { peopleNames } = readTestUser();

    // Unconditional, even though a redirect should make it unreachable: if the
    // gate ever regresses -- the exact thing this test exists to catch -- the
    // dashboard island would mount and POST /api/rankings for real, spending
    // OpenAI budget during the run that is supposed to be reporting the bug.
    // The invariant in E2E_RULES.md must not depend on the code under test.
    await page.route("**/api/rankings*", (route) => route.abort());

    for (const route of PROTECTED_ROUTES) {
      await page.goto(route);

      // Asserting the redirect alone would be a naive assertion: it passes just
      // as well against an app that redirects everyone and serves nothing.
      await expect(page).toHaveURL(/\/auth\/signin/);
      await expect(page.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();

      // This is the assertion tied to the risk. These two people exist, belong
      // to the seeded account, and are rendered by name on /people when that
      // account is signed in. A gate that let this request through would put
      // them on screen.
      for (const name of peopleNames) {
        await expect(page.getByText(name)).toHaveCount(0);
      }
    }
  });
});

test("a real session survives a real page reload", async ({ page }) => {
  // The positive control. Without it the test above would pass against an app
  // that is simply broken for everyone, which is not what Risk #5 is about.
  //
  // /dashboard mounts HierarchyView, which POSTs /api/rankings on mount and
  // would spend real OpenAI budget -- the ranking itself is irrelevant here, so
  // the request is aborted in the browser (see E2E_RULES.md).
  await page.route("**/api/rankings*", (route) => route.abort());

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Kto teraz czeka na Twój telefon" })).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Kto teraz czeka na Twój telefon" })).toBeVisible();
});
