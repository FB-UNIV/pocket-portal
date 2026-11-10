import { describe, it, expect } from "vitest";
import { browseHref, categoriesOf, filterApps, normalizeCategory, readBrowseParams } from "./browse";

const app = (name: string, description = "", category: string | null = null) => ({
  name,
  description,
  category,
});

describe("normalizeCategory", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeCategory("  Watch   &  listen ")).toBe("Watch & listen");
  });

  it("treats blank as no category", () => {
    expect(normalizeCategory("")).toBeNull();
    expect(normalizeCategory("   ")).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
  });

  // A chip label, not a sentence: anything longer is cut, not rejected.
  it("keeps at most 40 characters", () => {
    expect(normalizeCategory("x".repeat(60))).toHaveLength(40);
  });
});

describe("categoriesOf", () => {
  it("lists each category once, alphabetically, ignoring apps without one", () => {
    const apps = [app("A", "", "Files"), app("B"), app("C", "", "Around the house"), app("D", "", "Files")];

    expect(categoriesOf(apps)).toEqual(["Around the house", "Files"]);
  });
});

describe("filterApps", () => {
  const apps = [
    app("Jellyfin", "Watch films and series", "Watch & listen"),
    app("Nextcloud", "Keep and share your files", "Files"),
    app("Immich", "See the family photos", "Files"),
  ];

  it("returns everything with no query or category", () => {
    expect(filterApps(apps, {})).toEqual(apps);
  });

  it("matches the query against name, description and category, ignoring case", () => {
    expect(filterApps(apps, { q: "jelly" }).map((a) => a.name)).toEqual(["Jellyfin"]);
    expect(filterApps(apps, { q: "PHOTOS" }).map((a) => a.name)).toEqual(["Immich"]);
    expect(filterApps(apps, { q: "files" }).map((a) => a.name)).toEqual(["Nextcloud", "Immich"]);
  });

  it("keeps only the chosen category", () => {
    expect(filterApps(apps, { category: "Files" }).map((a) => a.name)).toEqual([
      "Nextcloud",
      "Immich",
    ]);
  });

  it("combines both", () => {
    expect(filterApps(apps, { q: "photo", category: "Files" }).map((a) => a.name)).toEqual([
      "Immich",
    ]);
  });
});

describe("readBrowseParams", () => {
  it("takes the first value of each, trimmed", () => {
    expect(readBrowseParams({ q: [" films ", "x"], category: "Files" })).toEqual({
      q: "films",
      category: "Files",
    });
  });

  it("drops empty values and caps the query's length", () => {
    expect(readBrowseParams({ q: "  ", category: "" })).toEqual({});
    expect(readBrowseParams({ q: "y".repeat(500) }).q).toHaveLength(100);
  });

  it("copes with no params at all", () => {
    expect(readBrowseParams(undefined)).toEqual({});
  });

  // ?ask=<app id>: which app's request form is open on /apps.
  it("reads the app being asked for", () => {
    expect(readBrowseParams({ ask: " client-1 " })).toEqual({ ask: "client-1" });
  });
});

describe("browseHref", () => {
  it("is plain /apps with nothing to filter by", () => {
    expect(browseHref({})).toBe("/apps");
  });

  it("encodes the query and the category", () => {
    expect(browseHref({ q: "films & tv", category: "Watch & listen" })).toBe(
      "/apps?q=films+%26+tv&category=Watch+%26+listen",
    );
  });

  it("adds the app being asked for after the filters", () => {
    expect(browseHref({ q: "films", ask: "client 1" })).toBe("/apps?q=films&ask=client+1");
  });
});
