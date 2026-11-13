import { describe, it, expect } from "vitest";
import type { CatalogApp } from "@/lib/catalog/apps";
import { requestContext } from "./request-context";

function app(overrides: Partial<CatalogApp>): CatalogApp {
  return {
    id: "x",
    name: "X",
    description: "",
    launchUrl: "https://x.example.test",
    iconUrl: null,
    isGroupRestricted: true,
    allowedGroups: [],
    hidden: false,
    requires: [],
    category: null,
    ...overrides,
  };
}

const MEDIA = { id: "g1", name: "media", friendlyName: "Media" };
const REQUEST = { pocketIdClientId: "jf", pocketIdGroupId: "g1", pocketIdGroupName: "media" };

describe("requestContext", () => {
  it("finds the app and names the group by PocketID's friendly name", () => {
    const jellyfin = app({ id: "jf", name: "Jellyfin", allowedGroups: [MEDIA] });

    const context = requestContext([jellyfin], REQUEST);

    expect(context.app).toBe(jellyfin);
    expect(context.groupLabel).toBe("Media");
  });

  it("lists every shown app the group opens, the one asked for first", () => {
    const apps = [
      app({ id: "sn", name: "Sonarr", allowedGroups: [MEDIA] }),
      app({ id: "jf", name: "Jellyfin", allowedGroups: [MEDIA] }),
      app({ id: "hd", name: "Hidden one", allowedGroups: [MEDIA], hidden: true }),
      app({ id: "im", name: "Immich", allowedGroups: [{ id: "g2", name: "photos", friendlyName: "" }] }),
    ];

    expect(requestContext(apps, REQUEST).opens).toEqual(["Jellyfin", "Sonarr"]);
  });

  it("falls back to the stored group name once PocketID no longer lists it", () => {
    const context = requestContext([], REQUEST);

    expect(context.app).toBeNull();
    expect(context.groupLabel).toBe("media");
    expect(context.opens).toEqual([]);
  });

  it("uses the group's name when it has no friendly name", () => {
    const jellyfin = app({ id: "jf", allowedGroups: [{ ...MEDIA, friendlyName: "" }] });

    expect(requestContext([jellyfin], REQUEST).groupLabel).toBe("media");
  });
});
