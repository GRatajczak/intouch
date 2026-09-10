import { defineConfig, devices } from "@playwright/test";

// THIS SUITE NEVER STARTS A SERVER -- deliberately no `webServer` block.
//
// The convention is inherited from tests/http (test-plan.md §6.1): the developer
// starts the app, the suite addresses it from outside. Two reasons it holds here
// too. First, this layer needs *two* processes up (a dev server and the local
// Supabase stack), and a `webServer` block that starts one of them hides the fact
// that the other is missing behind a confusing timeout. Second, the app's own
// dev server is the developer's to run.
//
// Unlike tests/http, this layer does NOT skip on an unset base URL. It is opt-in
// by invocation (`npm run test:e2e`), so a run that cannot reach the app is a
// failure, not a silent pass.
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";

const AUTH_STATE = "playwright/.auth/user.json";

export default defineConfig({
  testDir: "tests/e2e",

  // Chromium only. A second engine would double the runtime of the slowest,
  // most flake-prone layer in the project to protect risks that are not
  // engine-specific -- test-plan.md §1 principle 1 (cost x signal).
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      teardown: "cleanup",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "cleanup",
      testMatch: /auth\.teardown\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE },
      dependencies: ["setup"],
    },
  ],

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries. A retry turns a flaky test green and hides exactly the signal
  // this layer exists to produce; if a spec needs one, fix the spec.
  retries: 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  // Long enough for a cold SSR route on a dev server, short enough that a hung
  // poll fails rather than hangs the run.
  timeout: 30_000,
  expect: { timeout: 10_000 },
});
