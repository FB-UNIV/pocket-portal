import { describe, it, expect } from "vitest";
import { dependencyProblem, prerequisitesOf, type DependencyLink } from "./dependencies";

// ADR-0012: an app can need other apps (Grafana needs the VPN), one level
// deep: no self-links, no chains, so no cycles.
const links: DependencyLink[] = [
  { clientId: "grafana", requiresId: "vpn" },
  { clientId: "prometheus", requiresId: "vpn" },
];

describe("dependencyProblem", () => {
  it("allows a new app to need an existing prerequisite", () => {
    expect(dependencyProblem(links, "kibana", "vpn")).toBeNull();
  });

  it("allows an app that already needs one to need another", () => {
    expect(dependencyProblem(links, "grafana", "sso-proxy")).toBeNull();
  });

  it("refuses an app needing itself", () => {
    expect(dependencyProblem(links, "vpn", "vpn")).toBe("self");
  });

  it("refuses a prerequisite that needs something itself (no chains)", () => {
    expect(dependencyProblem(links, "dashboards", "grafana")).toBe("prerequisite_needs_another");
  });

  it("refuses making a prerequisite need something (no chains the other way)", () => {
    expect(dependencyProblem(links, "vpn", "wifi")).toBe("app_is_a_prerequisite");
  });

  it("treats a link that's already there as fine (adding it again changes nothing)", () => {
    expect(dependencyProblem(links, "grafana", "vpn")).toBeNull();
  });
});

describe("prerequisitesOf", () => {
  const clients = [
    { id: "grafana", name: "Grafana", isGroupRestricted: true, allowedUserGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering" }] },
    { id: "vpn", name: "VPN", isGroupRestricted: true, allowedUserGroups: [{ id: "g2", name: "vpn", friendlyName: "VPN" }] },
    { id: "wiki", name: "Wiki", isGroupRestricted: false, allowedUserGroups: [] },
  ];

  it("names each prerequisite and says whether the user has it", () => {
    expect(prerequisitesOf(links, clients, "grafana", ["engineering"])).toEqual([
      { id: "vpn", name: "VPN", hasAccess: false },
    ]);
    expect(prerequisitesOf(links, clients, "grafana", ["engineering", "vpn"])).toEqual([
      { id: "vpn", name: "VPN", hasAccess: true },
    ]);
  });

  it("is empty for an app that needs nothing", () => {
    expect(prerequisitesOf(links, clients, "wiki", [])).toEqual([]);
  });

  // Like an app_overrides row for a deleted client: ignored when read.
  it("ignores a link to a client PocketID no longer has", () => {
    expect(prerequisitesOf([{ clientId: "wiki", requiresId: "gone" }], clients, "wiki", [])).toEqual([]);
  });
});
