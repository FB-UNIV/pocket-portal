import { test, expect, type Page } from "@playwright/test";
import { sessionFile } from "./helpers/auth";

// the headers are sent, and the CSP doesn't break any page. A missing
// nonce wouldn't fail loudly; it would just stop scripts, so every page is
// loaded in a real browser and any CSP violation fails the test.

test("pages send the CSP and hardening headers, without X-Powered-By", async ({ request }) => {
  const res = await request.get("/");
  const headers = res.headers();

  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("each response gets its own nonce", async ({ request }) => {
  const nonce = async () =>
    /'nonce-([^']+)'/.exec((await request.get("/")).headers()["content-security-policy"] ?? "")?.[1];

  expect(await nonce()).not.toEqual(await nonce());
});

async function expectNoCspViolations(page: Page, path: string) {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto(path, { waitUntil: "networkidle" });
  expect(violations).toEqual([]);
}

test("the signed-out pages run without CSP violations", async ({ page }) => {
  for (const path of ["/", "/no-such-page"]) await expectNoCspViolations(page, path);
});

test.describe("as a user", () => {
  test.use({ storageState: sessionFile("e2e-user") });

  test("signed-in pages run without CSP violations", async ({ page }) => {
    for (const path of ["/", "/apps", "/my-access"]) await expectNoCspViolations(page, path);
  });
});

test.describe("as an admin", () => {
  test.use({ storageState: sessionFile("e2e-admin") });

  test("admin pages run without CSP violations", async ({ page }) => {
    for (const path of ["/admin/apps", "/admin/requests", "/admin/audit"]) {
      await expectNoCspViolations(page, path);
    }
  });
});
