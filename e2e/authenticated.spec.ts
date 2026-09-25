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

  test("My Access shows the seed user's real PocketID group memberships", async ({ page }) => {
    await page.goto("/my-access");

    await expect(page.getByRole("heading", { name: "My Access" })).toBeVisible();
    await expect(page.getByText("media", { exact: true })).toBeVisible();
    // e2e-user is not in engineering — that group must not appear.
    await expect(page.getByText("engineering", { exact: true })).toHaveCount(0);
  });

  test("Apps reflects the seeded access matrix for this user", async ({ page }) => {
    await page.goto("/apps");

    // Open app (unrestricted) and media-gated app (user is in media) both show a
    // launch link…
    await expect(page.getByText("Immich (seed)")).toBeVisible();
    await expect(page.getByText("Sonarr (seed)")).toBeVisible();
    expect(await page.getByRole("link", { name: "Open" }).count()).toBeGreaterThanOrEqual(2);

    // …the engineering-gated app the user can't reach shows a request form instead.
    await expect(page.getByText("Grafana (seed)")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Request access via Engineering" }),
    ).toBeVisible();
  });
});
