import { describe, it, expect } from "vitest";
import { isVisibleTo, orderPosts, normalizePostInput, type NewsPost } from "./posts";

const NOW = new Date("2026-11-13T12:00:00Z");
const post = (overrides: Partial<NewsPost> = {}): NewsPost => ({
  id: "p1",
  title: "Maintenance tonight",
  body: "Back by 10.",
  authorSubject: "admin-1",
  publishedAt: new Date("2026-11-13T09:00:00Z"),
  pinned: false,
  expiresAt: null,
  audienceGroups: [],
  coverImageId: null,
  createdAt: new Date("2026-11-13T09:00:00Z"),
  updatedAt: new Date("2026-11-13T09:00:00Z"),
  ...overrides,
});

// #22: who sees a post. Decided on the server, so a post for another
// group never reaches the browser.
describe("isVisibleTo", () => {
  it("shows a post for everyone to everyone", () => {
    expect(isVisibleTo(post(), [], NOW)).toBe(true);
  });

  // Matched by group name, like the OIDC groups claim (hasAccessToClient).
  it("shows a post for some groups only to their members", () => {
    const forEngineering = post({ audienceGroups: ["engineering"] });

    expect(isVisibleTo(forEngineering, ["engineering", "media"], NOW)).toBe(true);
    expect(isVisibleTo(forEngineering, ["media"], NOW)).toBe(false);
  });

  it("hides a post once it has expired, and one not published yet", () => {
    expect(isVisibleTo(post({ expiresAt: new Date("2026-11-13T11:59:59Z") }), [], NOW)).toBe(false);
    expect(isVisibleTo(post({ expiresAt: new Date("2026-11-14T00:00:00Z") }), [], NOW)).toBe(true);
    expect(isVisibleTo(post({ publishedAt: new Date("2026-11-13T12:00:01Z") }), [], NOW)).toBe(false);
  });
});

describe("orderPosts", () => {
  it("puts pinned posts first, then the newest", () => {
    const older = post({ id: "older", publishedAt: new Date("2026-11-01T00:00:00Z") });
    const newer = post({ id: "newer", publishedAt: new Date("2026-11-12T00:00:00Z") });
    const pinned = post({ id: "pinned", pinned: true, publishedAt: new Date("2026-10-01T00:00:00Z") });

    expect(orderPosts([older, newer, pinned]).map((p) => p.id)).toEqual(["pinned", "newer", "older"]);
  });
});

// The admin form is user input: trimmed, bounded, and only real groups.
describe("normalizePostInput", () => {
  const form = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      for (const v of [value].flat()) data.append(key, v);
    }
    return data;
  };
  const GROUPS = ["engineering", "media"];

  it("reads a post from the form", () => {
    expect(
      normalizePostInput(
        form({ title: "  Grafana upgrade ", body: "Tonight.\n", pinned: "on", expiresAt: "2026-11-20", audience: ["engineering"] }),
        GROUPS,
      ),
    ).toEqual({
      ok: true,
      value: {
        title: "Grafana upgrade",
        body: "Tonight.",
        pinned: true,
        expiresAt: new Date("2026-11-20T23:59:59.999Z"),
        audienceGroups: ["engineering"],
      },
    });
  });

  it("defaults to everyone, not pinned, no end", () => {
    expect(normalizePostInput(form({ title: "Hi", body: "Hello" }), GROUPS)).toMatchObject({
      ok: true,
      value: { pinned: false, expiresAt: null, audienceGroups: [] },
    });
  });

  it.each([
    ["no title", { title: " ", body: "x" }, "title_required"],
    ["no body", { title: "x", body: "" }, "body_required"],
    ["a title too long", { title: "x".repeat(121), body: "x" }, "title_too_long"],
    ["a body too long", { title: "x", body: "x".repeat(10_001) }, "body_too_long"],
    ["a bad date", { title: "x", body: "x", expiresAt: "soon" }, "bad_date"],
    ["a group PocketID doesn't have", { title: "x", body: "x", audience: ["made-up"] }, "unknown_group"],
  ])("refuses %s", (_why, fields, reason) => {
    expect(normalizePostInput(form(fields), GROUPS)).toEqual({ ok: false, reason });
  });
});
