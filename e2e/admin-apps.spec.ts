import { test, expect } from "@playwright/test";
import { sessionFile } from "./helpers/auth";

test("unauthenticated visitors are redirected to sign in", async ({ request }) => {
  const response = await request.get("/admin/apps", { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toBe("/?callbackUrl=%2Fadmin%2Fapps");
});

// ADR-0012, end to end: an admin says Immich needs Grafana; the e2e user,
// who has Immich but not Grafana, is told on /apps; the admin takes it back.
test("an admin links two apps and the user is told what else they need", async ({ browser }) => {
  const admin = await browser.newContext({ storageState: sessionFile("e2e-admin") });
  const user = await browser.newContext({ storageState: sessionFile("e2e-user") });
  const adminPage = await admin.newPage();
  const userPage = await user.newPage();

  await adminPage.goto("/admin/apps");
  await adminPage.locator('a[href^="/admin/apps/"]').filter({ hasText: "Immich (seed)" }).first().click();
  const needs = adminPage.getByRole("region", { name: "Needs another app" });
  await needs.getByRole("combobox", { name: "Add an app it needs" }).selectOption({ label: "Grafana (seed)" });
  await needs.getByRole("button", { name: "Add" }).click();
  await expect(needs.getByRole("button", { name: "Remove Grafana (seed)" })).toBeVisible();

  try {
    await userPage.goto("/apps");
    await expect(userPage.getByText("Needs Grafana (seed) to work, which you don’t have yet.")).toBeVisible();
    // Informs, doesn't enforce: Immich still opens.
    await expect(
      userPage.getByRole("region", { name: "Ready to open" }).getByRole("link", { name: /Immich \(seed\)$/ }),
    ).toBeVisible();
  } finally {
    await needs.getByRole("button", { name: "Remove Grafana (seed)" }).click();
    await expect(needs.getByText("Nothing else. It works on its own.")).toBeVisible();
    await admin.close();
    await user.close();
  }
});
