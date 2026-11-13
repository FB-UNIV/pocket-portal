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

// #22, end to end: an admin posts news for the media group; the e2e user
// (in media) reads it on the dashboard, rendered from Markdown; the admin
// deletes it.
test("an admin posts news that its audience reads on the dashboard", async ({ browser }) => {
  const admin = await browser.newContext({ storageState: sessionFile("e2e-admin") });
  const user = await browser.newContext({ storageState: sessionFile("e2e-user") });
  const adminPage = await admin.newPage();
  const userPage = await user.newPage();
  const title = `Media maintenance ${Date.now()}`;

  await adminPage.goto("/admin/news/new");
  await adminPage.getByLabel("Title").fill(title);
  await adminPage.getByLabel("What it says").fill("Back by **10pm**.\n\n<script>alert(1)</script>");
  await adminPage.getByRole("group", { name: "Who sees it" }).getByLabel("media", { exact: false }).check();
  await adminPage.getByRole("button", { name: "Publish" }).click();
  await expect(adminPage.getByRole("status")).toHaveText("Saved.");

  try {
    await userPage.goto("/");
    const article = userPage.getByRole("region", { name: "News" }).getByRole("article", { name: title });
    await expect(article.locator("strong")).toHaveText("10pm");
    // Shown as text, never run.
    await expect(article.getByText("<script>alert(1)</script>")).toBeVisible();
  } finally {
    await adminPage.getByRole("button", { name: "Delete this post" }).click();
    await expect(adminPage).toHaveURL(/\/admin\/news$/);
    await admin.close();
    await user.close();
  }
});

// #22 pictures, end to end: uploaded in the editor, stripped of metadata,
// served inert, only to the post's readers; an SVG is refused.
test("an admin adds a picture to a post: stripped, served inert, to its readers", async ({ browser }) => {
  const { crc32 } = await import("node:zlib");
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    chunk("tEXt", Buffer.from("Comment\0GPS 48.85N 2.35E", "latin1")),
    chunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0x60, 0, 0, 0, 2, 0, 1])),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  const admin = await browser.newContext({ storageState: sessionFile("e2e-admin") });
  const user = await browser.newContext({ storageState: sessionFile("e2e-user") });
  const adminPage = await admin.newPage();
  const title = `Pictures ${Date.now()}`;

  await adminPage.goto("/admin/news/new");
  await adminPage.getByLabel("Title").fill(title);
  await adminPage.getByLabel("What it says").fill("With a picture.");
  await adminPage.getByRole("group", { name: "Who sees it" }).getByLabel("media", { exact: false }).check();
  await adminPage.getByRole("button", { name: "Publish" }).click();
  await expect(adminPage.getByRole("status")).toHaveText("Saved.");

  try {
    await adminPage.getByLabel("Add a picture").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await adminPage.getByRole("button", { name: "Upload" }).click();
    await expect(adminPage.getByText("Picture added.")).toBeVisible();
    await adminPage.getByRole("button", { name: "Use as cover" }).click();
    const src = await adminPage.getByRole("img", { name: "Picture 1" }).getAttribute("src");
    expect(src).toMatch(/^\/api\/news\/images\/[0-9a-f-]{36}$/);

    // The post's reader (in media) gets it, stripped and inert.
    const res = await user.request.get(src!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    const served = await res.body();
    expect(served.includes(Buffer.from("GPS"))).toBe(false);
    expect(served.includes(Buffer.from("IDAT"))).toBe(true);

    const userPage = await user.newPage();
    await userPage.goto("/");
    await expect(userPage.getByRole("article", { name: title }).locator(`img[src="${src}"]`)).toBeVisible();

    // An SVG, whatever it's called, is refused.
    await adminPage.getByLabel("Add a picture").setInputFiles({
      name: "innocent.png",
      mimeType: "image/png",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    });
    await adminPage.getByRole("button", { name: "Upload" }).click();
    // (By its words: Next's route announcer is a role="alert" too.)
    await expect(adminPage.getByText("That isn’t a PNG, JPEG, WebP or GIF picture.")).toBeVisible();
  } finally {
    await adminPage.getByRole("button", { name: "Delete this post" }).click();
    await expect(adminPage).toHaveURL(/\/admin\/news$/);
    await admin.close();
    await user.close();
  }
});
