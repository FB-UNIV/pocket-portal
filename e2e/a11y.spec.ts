import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { sessionFile } from "./helpers/auth";

// Automated WCAG 2.2 AA regression gate for what the manual accessibility pass
// fixed. Runs in a real browser because colour contrast, the largest class of
// that pass's failures, needs layout and computed colours that jsdom doesn't have.
//
// A gate, not advice: any violation fails. An exception belongs here as an
// explicit, commented `.disableRules([...])` on the page that needs it.
// Tag levels aren't cumulative, so each version's A and AA are listed.
// axe-core 4.13 has no wcag22a rules yet; the tag picks them up if it adds any.
const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  // Rule id + offending selectors, so a CI failure says what to fix without
  // having to download the report.
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary).toEqual([]);
}

// Both schemes: the manual pass's contrast failures were split across light and dark.
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("signed-out home page", async ({ page }) => {
      await page.goto("/");
      await expectNoViolations(page);
    });

    test("not-found page", async ({ page }) => {
      await page.goto("/no-such-page");
      await expectNoViolations(page);
    });

    test.describe("as a user", () => {
      test.use({ storageState: sessionFile("e2e-user") });

      for (const path of ["/", "/apps", "/my-access"]) {
        test(path, async ({ page }) => {
          await page.goto(path);
          // The saved session must still be live, or axe would be checking a
          // sign-in redirect instead of this page.
          await expect(page).toHaveURL(path);
          await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
          await expectNoViolations(page);
        });
      }
    });

    test.describe("as an admin", () => {
      test.use({ storageState: sessionFile("e2e-admin") });

      for (const path of ["/admin/apps", "/admin/requests", "/admin/audit"]) {
        test(path, async ({ page }) => {
          await page.goto(path);
          // Guards against a silent redirect home, which would pass axe while
          // checking the wrong page.
          await expect(page).toHaveURL(path);
          await expectNoViolations(page);
        });
      }
    });
  });
}
