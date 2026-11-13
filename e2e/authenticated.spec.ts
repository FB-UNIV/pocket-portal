import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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

  // #21: the welcome checklist. Ticks the passkey item and undoes it, so the
  // run leaves the person as it found them.
  test("the dashboard starts with a welcome checklist the person can tick", async ({ page }) => {
    await page.goto("/");

    const welcome = page.getByRole("region", { name: "Getting started" });
    await expect(welcome.getByRole("heading", { name: "Add a backup passkey" })).toBeVisible();
    await expect(welcome.getByRole("link", { name: "Open your account" })).toHaveAttribute(
      "href",
      /\/settings\/account$/,
    );

    await welcome.getByRole("button", { name: "I’ve done it" }).click();
    await expect(welcome.getByRole("button", { name: "Undo" })).toBeVisible();
    await welcome.getByRole("button", { name: "Undo" }).click();
    await expect(welcome.getByRole("button", { name: "I’ve done it" })).toBeVisible();
  });

  // #21 phase 2: the guided tour, opened as the checklist opens it. Checked
  // with axe while open, then walked with the keyboard.
  test("the guided tour walks the dashboard, accessibly", async ({ page }) => {
    await page.goto("/?tour=1");

    const step1 = page.getByRole("dialog", { name: "Your apps" });
    await expect(step1).toBeVisible();
    await expect(step1.getByRole("button", { name: "Next" })).toBeFocused();
    const { violations } = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);

    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "All the apps" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("the dashboard launches the apps this user can open, and only those", async ({ page }) => {
    await page.goto("/");

    const yourApps = page.getByRole("region", { name: "Your apps" });
    await expect(yourApps.getByRole("link", { name: /^Immich \(seed\)/ })).toBeVisible();
    await expect(yourApps.getByRole("link", { name: /^Sonarr \(seed\)/ })).toBeVisible();
    // Grafana is engineering-only: askable on /apps, never a launcher here.
    await expect(yourApps.getByText("Grafana (seed)")).toHaveCount(0);
    await expect(yourApps.getByRole("link", { name: "See all apps, or ask for more" })).toHaveAttribute(
      "href",
      "/apps",
    );
  });

  test("Apps reflects the seeded access matrix for this user", async ({ page }) => {
    await page.goto("/apps");

    // Open app (unrestricted) and media-gated app (user is in media) are both
    // launch cards under "Ready to open", each named by its own words…
    const ready = page.getByRole("region", { name: "Ready to open" });
    await expect(ready.getByRole("link", { name: /Immich \(seed\)$/ })).toBeVisible();
    await expect(ready.getByRole("link", { name: /Sonarr \(seed\)$/ })).toBeVisible();

    // …the engineering-gated app the user can't reach is listed to ask for,
    // and pressing Ask opens its request form, ready to type in.
    await expect(page.getByText("Grafana (seed)")).toBeVisible();
    // "Ask again" if an earlier run's request was declined.
    await page.getByRole("link", { name: /^Ask (again )?for Grafana \(seed\)$/ }).click();
    await expect(page).toHaveURL(/[?&]ask=/);
    await expect(
      page.getByRole("button", { name: "Send request for Grafana (seed)" }),
    ).toBeVisible();
    await expect(page.getByLabel(/Why\?/)).toBeFocused();
  });
});
