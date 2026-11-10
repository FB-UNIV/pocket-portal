import { test, expect } from "@playwright/test";
import { sessionFile, signInAsSeedUser } from "./helpers/auth";

// Signed-in journeys against the seeded catalog, as `e2e-user` (in `media`
// only). The first test runs the real OIDC sign-in; the rest reuse the
// session e2e/auth.setup.ts signed in, because PocketID rate-limits sign-in.
//
// Read-only on purpose: filing a request would change shared Postgres state
// and break re-runs. Submission is covered by the unit and integration
// suites.

test("completes a real OIDC sign-in and lands on the portal home", async ({ page }) => {
  await signInAsSeedUser(page);
  await expect(page.getByText("Signed in as")).toBeVisible();
});

test.describe("authenticated portal journeys", () => {
  test.use({ storageState: sessionFile("e2e-user") });

  test("the dashboard launches the apps this user can open, and only those", async ({ page }) => {
    await page.goto("/");

    const yourApps = page.getByRole("region", { name: "Your apps" });
    await expect(yourApps.getByRole("link", { name: "Open Immich (seed)" })).toBeVisible();
    await expect(yourApps.getByRole("link", { name: "Open Sonarr (seed)" })).toBeVisible();
    // Grafana is engineering-only: askable on /apps, never a launcher here.
    await expect(yourApps.getByText("Grafana (seed)")).toHaveCount(0);
    await expect(yourApps.getByRole("link", { name: "See all apps, or ask for more" })).toHaveAttribute(
      "href",
      "/apps",
    );
  });

  test("Apps reflects the seeded access matrix for this user", async ({ page }) => {
    await page.goto("/apps");

    // Open app (unrestricted) and media-gated app (user is in media) both show a
    // launch link…
    await expect(page.getByText("Immich (seed)")).toBeVisible();
    await expect(page.getByText("Sonarr (seed)")).toBeVisible();
    expect(await page.getByRole("link", { name: "Open" }).count()).toBeGreaterThanOrEqual(2);

    // …the engineering-gated app the user can't reach is listed to ask for,
    // and pressing Ask opens its request form, ready to type in.
    await expect(page.getByText("Grafana (seed)")).toBeVisible();
    await page.getByRole("link", { name: "Ask for Grafana (seed)" }).click();
    await expect(page).toHaveURL(/[?&]ask=/);
    await expect(
      page.getByRole("button", { name: "Send request for Grafana (seed)" }),
    ).toBeVisible();
    await expect(page.getByLabel(/Why\?/)).toBeFocused();
  });
});
