import { test, expect } from "@playwright/test";
import { sessionFile } from "./helpers/auth";

// Running the portal in French (#64), signed out. A signed-out choice lives
// in this browser's cookie only, so these tests can't leak into each other
// or into the shared seed users. Saving the choice to a signed-in person is
// covered by the unit and integration suites: switching e2e-user's language
// here would change what every other spec sees.

test.describe("a browser that asks for French", () => {
  test.use({ locale: "fr-FR" });

  test("gets the sign-in page in French, and can switch back to English", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("button", { name: "Se connecter avec PocketID" })).toBeVisible();

    await page.getByRole("button", { name: "English" }).click();

    await expect(page.getByRole("button", { name: "Sign in with PocketID" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("a browser that asks for English", () => {
  test.use({ locale: "en-US" });

  test("switches to French, and stays French after a reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in with PocketID" })).toBeVisible();

    const french = page.getByRole("button", { name: "Français" });
    await expect(french).toHaveAttribute("lang", "fr");
    await french.click();

    await expect(page.getByRole("button", { name: "Se connecter avec PocketID" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    await page.reload();
    await expect(page.getByRole("button", { name: "Se connecter avec PocketID" })).toBeVisible();
  });
});

// Signed in, with a French browser and nothing saved: the whole journey is
// in French, without touching e2e-user's stored preference.
test.describe("a signed-in user whose browser asks for French", () => {
  test.use({ locale: "fr-FR", storageState: sessionFile("e2e-user") });

  test("browses the Apps page in French", async ({ page }) => {
    await page.goto("/apps");

    await expect(page.getByRole("heading", { level: 1, name: "Applications" })).toBeVisible();
    await expect(page).toHaveTitle(/^Applications · /);
    await expect(page.getByRole("link", { name: "Ouvrir Immich (seed)" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Demander l’accès à Grafana (seed)" }),
    ).toBeVisible();
  });
});
