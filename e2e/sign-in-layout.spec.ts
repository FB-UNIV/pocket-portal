import { test, expect, type Page } from "@playwright/test";

// The sign-in page's picture is PocketID's login background (the test
// PocketID serves its stock one). A layout check only a real browser can
// make: jsdom has no boxes.
const picture = (page: Page) => page.locator('main img[alt=""]');

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1871, height: 913 } });

  test("gives the picture most of the page, beside the button", async ({ page }) => {
    await page.goto("/");

    const image = (await picture(page).boundingBox())!;
    const main = (await page.getByRole("main").boundingBox())!;
    const button = (await page.getByRole("button", { name: "Sign in" }).boundingBox())!;

    expect(image.width).toBeGreaterThanOrEqual(main.width * 0.55);
    expect(image.height).toBeGreaterThanOrEqual(640);
    expect(image.x).toBeGreaterThan(button.x + button.width);
  });

  // The page grew wider than the signed-in pages; the header grows with it,
  // so its logo and language switch line up with the page's edges.
  test("lines the header up with the wider page", async ({ page }) => {
    await page.goto("/");

    const logo = (await page.getByRole("banner").getByRole("link", { name: /Pocket Portal/ }).boundingBox())!;
    const image = (await picture(page).boundingBox())!;
    const main = (await page.getByRole("main").boundingBox())!;
    const language = (await page.getByRole("button", { name: "Français" }).boundingBox())!;

    expect(logo.x).toBeCloseTo(main.x + 24, 0);
    expect(language.x + language.width).toBeGreaterThan(image.x + image.width - 48);
  });
});

// As PocketID's own login page does on a phone: the picture covers the whole
// screen, and the sign-in card sits on top of it.
test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("puts the picture behind the whole page, the button on top", async ({ page }) => {
    await page.goto("/");

    const image = (await picture(page).boundingBox())!;
    expect(image).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });

    const button = page.getByRole("button", { name: "Sign in" });
    await expect(button).toBeInViewport();
    // Nothing covers the button: a click at its centre lands on it.
    const box = (await button.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? null,
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(hit).toContain("Sign in");
  });
});
