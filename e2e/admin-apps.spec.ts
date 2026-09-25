import { test, expect } from "@playwright/test";

test("unauthenticated visitors are redirected to sign in", async ({ request }) => {
  const response = await request.get("/admin/apps", { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toBe("/?callbackUrl=%2Fadmin%2Fapps");
});
