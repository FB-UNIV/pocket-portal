import { test, expect } from "@playwright/test";

// Placeholder smoke test proving the e2e harness (build + serve + browser) works
// end to end. Replace with real workspace user journeys once pages exist that
// exercise the PocketID client (src/lib/pocketid/client.ts).
test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
});
