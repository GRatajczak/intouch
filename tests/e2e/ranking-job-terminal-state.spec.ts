// Risk #4 (context/foundation/test-plan.md §2): "A deferred ranking job never
// reaches a terminal state and the view polls forever -- stuck is
// indistinguishable from slow." Impact Medium, Likelihood High, and it has
// already happened once in this project (test-plan interview Q2).
//
// Why this risk is browser-level and nothing cheaper will do: the whole
// protective behaviour is the polling state machine inside HierarchyView, an
// island that only exists once mounted. `POLL_INTERVAL_MS`, `MAX_POLL_ATTEMPTS`,
// the `failed` branch and the attempts bound are unreachable from tests/routes,
// which invokes handlers directly and never renders anything.
//
// Real vs mocked. Auth, middleware, routing, SSR and Postgres are all real -- the
// page is served to a genuinely signed-in browser. Only the browser's own
// `/api/rankings` calls are intercepted, because "the job never settles" is not
// a state the real backend can be asked to hold on demand, and because letting
// this endpoint through would make a paid OpenAI call on every run.
//
// The seeded user deliberately owns no ranking row, so `loadLatestRanking`
// returns null, `staleOnLoad` is true, and the island mounts straight into the
// first-ever-run path -- the spinner that Risk #4 says is indistinguishable from
// a job that will never finish.
import { test, expect, type Page } from "@playwright/test";

const JOB_ID = "e2e-job";

/** POST always dispatches a job; GET answers with whatever the test needs. */
async function mockRankings(page: Page, getBody: Record<string, unknown>, onGet?: () => void): Promise<void> {
  await page.route("**/api/rankings*", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ jobId: JOB_ID }),
      });
      return;
    }
    onGet?.();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getBody),
    });
  });
}

test.describe("Risk #4 — a ranking job must reach a terminal state", () => {
  test("a failed job renders a visible error instead of an endless spinner", async ({ page }) => {
    // Registered before navigation: a handler installed afterwards would miss
    // the island's very first POST, which is the request under test.
    await mockRankings(page, { status: "failed" });

    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Nie udało się wygenerować kolejności" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Spróbuj ponownie" })).toBeEnabled();

    // The risk is a spinner that never resolves, so its absence is half the claim.
    await expect(page.getByText("Układamy Twoją kolejność kontaktów")).toHaveCount(0);
  });

  test("a job that never settles stops polling and reaches the same error state", async ({ page }) => {
    // The bound is MAX_POLL_ATTEMPTS (60) x POLL_INTERVAL_MS (2000) = 120s.
    // A fake clock is what makes that assertable: waiting it out would be a
    // two-minute, time-dependent test -- the very anti-pattern this suite bans.
    // It must be installed before the island mounts, or the interval is already
    // scheduled against the real timer and never sees the fast-forward.
    await page.clock.install();

    let pollCount = 0;
    await mockRankings(page, { status: "pending" }, () => (pollCount += 1));

    // The island only creates its interval after the dispatch POST resolves, so
    // fast-forwarding before the first poll lands would advance a timer that does
    // not exist yet. Waiting for that poll is the state this test needs.
    const firstPoll = page.waitForResponse(
      (response) => response.url().includes("/api/rankings") && response.request().method() === "GET",
    );
    await page.goto("/dashboard");
    await expect(page.getByText("Układamy Twoją kolejność kontaktów")).toBeVisible();
    await firstPoll;

    // `runFor` fires every due timer, so this is poll tick after poll tick, not a
    // single jump past them (`fastForward` would fire a due timer at most once).
    await page.clock.runFor(70 * 2000);

    await expect(page.getByRole("heading", { name: "Nie udało się wygenerować kolejności" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Spróbuj ponownie" })).toBeEnabled();

    // The part that actually distinguishes "bounded" from "renders an error and
    // keeps hammering the API": polling must have stopped, not just reported.
    const countAtBound = pollCount;
    await page.clock.runFor(10 * 2000);
    expect(pollCount).toBe(countAtBound);
  });
});
