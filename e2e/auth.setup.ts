import { test as setup } from "@playwright/test";
import { sessionFile, signInAsSeedUser } from "./helpers/auth";

// Runs before every other spec (the "setup" project in playwright.config.ts).
for (const username of ["e2e-user", "e2e-admin"]) {
  setup(`sign in ${username}`, async ({ page }) => {
    await signInAsSeedUser(page, username);
    await page.context().storageState({ path: sessionFile(username) });
  });
}
