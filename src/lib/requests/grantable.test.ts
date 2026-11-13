import { describe, it, expect } from "vitest";
import { isGrantable } from "./grantable";
import type { CatalogApp } from "@/lib/catalog/apps";

const APP: CatalogApp = {
  id: "client-1",
  name: "Grafana",
  description: "",
  launchUrl: null,
  iconUrl: null,
  category: null,
  isGroupRestricted: true,
  allowedGroups: [{ id: "group-1", name: "engineering", friendlyName: "Engineering" }],
  hidden: false,
  requires: [],
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

// ADR-0012: a prerequisite (a VPN) is often hidden, with no page of its
// own; it's still grantable while a visible app needs it.
describe("isGrantable for prerequisites", () => {
  const VPN: CatalogApp = { ...APP, id: "vpn", name: "VPN", hidden: true, allowedGroups: [{ id: "g-vpn", name: "vpn", friendlyName: "VPN" }] };
  const ASK_VPN = { pocketIdClientId: "vpn", pocketIdGroupId: "g-vpn" };

  it("allows a hidden prerequisite's group while a visible app needs it", () => {
    expect(isGrantable([{ ...APP, requires: [{ id: "vpn", name: "VPN" }] }, VPN], ASK_VPN)).toBe(true);
  });

  it("refuses it once no visible app needs it", () => {
    expect(isGrantable([{ ...APP, hidden: true, requires: [{ id: "vpn", name: "VPN" }] }, VPN], ASK_VPN)).toBe(false);
    expect(isGrantable([APP, VPN], ASK_VPN)).toBe(false);
  });

  it("still checks the group is one of the prerequisite's own", () => {
    expect(
      isGrantable([{ ...APP, requires: [{ id: "vpn", name: "VPN" }] }, VPN], { pocketIdClientId: "vpn", pocketIdGroupId: "group-1" }),
    ).toBe(false);
  });
});
