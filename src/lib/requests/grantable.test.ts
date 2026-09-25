import { describe, it, expect } from "vitest";
import { isGrantable } from "./grantable";
import type { CatalogApp } from "@/lib/catalog/apps";

const APP: CatalogApp = {
  id: "client-1",
  name: "Grafana",
  description: "",
  launchUrl: null,
  iconUrl: null,
  isGroupRestricted: true,
  allowedGroups: [{ id: "group-1", name: "engineering", friendlyName: "Engineering" }],
  hidden: false,
};
const REQUEST = { pocketIdClientId: "client-1", pocketIdGroupId: "group-1" };

describe("isGrantable", () => {
  it("allows a group that is still one of its visible app's allowed groups", () => {
    expect(isGrantable([APP], REQUEST)).toBe(true);
  });

  it.each([
    ["the app is hidden", [{ ...APP, hidden: true }]],
    ["the group was removed from the app", [{ ...APP, allowedGroups: [] }]],
    ["the app is gone", []],
    ["the group belongs to a different app", [{ ...APP, id: "client-2" }]],
  ])("refuses when %s", (_why, apps) => {
    expect(isGrantable(apps, REQUEST)).toBe(false);
  });
});
