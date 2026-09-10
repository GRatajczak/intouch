// Deletes the run's throwaway user, and with it every row it owns.
//
// Runs as a Playwright teardown project, so it fires after the last spec even
// when one of them failed -- a per-test cleanup alone would leak the user on any
// crash. The unique-suffix naming in the fixture is the other half of the pair:
// unique data prevents collisions, teardown prevents accumulation.
import { test as teardown } from "@playwright/test";
import { destroyTestUser } from "./fixtures/test-user";

teardown("delete the throwaway user", async () => {
  await destroyTestUser();
});
