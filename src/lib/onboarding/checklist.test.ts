import { describe, it, expect } from "vitest";
import { buildChecklist, checklistVisible, SELF_TICKED_ITEMS } from "./checklist";
import type { UserCatalogApp } from "@/lib/catalog/apps";

// #21: a welcome checklist computed from real state, never stored, so it
// can't go stale. Only what the portal can't see (a passkey added in
// PocketID) is ticked by the person themselves.

const VPN = { id: "vpn", name: "VPN", hasAccess: false, allowedGroups: [] };
const app = (overrides: Partial<UserCatalogApp>): UserCatalogApp => ({
  id: "grafana",
  name: "Grafana",
  description: "",
  launchUrl: "https://grafana.example.test",
  iconUrl: null,
  category: null,
  hasAccess: true,
  allowedGroups: [],
  requires: [],
  ...overrides,
});
const base = {
  apps: [] as UserCatalogApp[],
  requestCount: 0,
  ticked: [] as string[],
  requestsEnabled: true,
  accountUrl: "https://id.example.test/settings/account" as string | null,
};

describe("buildChecklist", () => {
  it("starts with a backup passkey, ticked by the person, linking to their PocketID account", () => {
    expect(buildChecklist(base)[0]).toEqual({
      id: "backup-passkey",
      done: false,
      href: "https://id.example.test/settings/account",
    });
    expect(buildChecklist({ ...base, ticked: ["backup-passkey"] })[0].done).toBe(true);
    expect(SELF_TICKED_ITEMS).toEqual(["backup-passkey"]);
  });

  it("leaves the passkey out when the portal doesn't know PocketID's address", () => {
    expect(buildChecklist({ ...base, accountUrl: null }).map((i) => i.id)).not.toContain("backup-passkey");
  });

  // One item per app that apps the person can open need (ADR-0012).
  it("asks for each app the person's apps need, done once they have it", () => {
    const apps = [app({ requires: [VPN] }), app({ id: "prometheus", name: "Prometheus", requires: [VPN] })];

    expect(buildChecklist({ ...base, apps }).filter((i) => i.id.startsWith("prerequisite:"))).toEqual([
      { id: "prerequisite:vpn", done: false, href: "/apps", name: "VPN", neededBy: ["Grafana", "Prometheus"] },
    ]);
    const has = [app({ requires: [{ ...VPN, hasAccess: true }] })];
    expect(buildChecklist({ ...base, apps: has }).find((i) => i.id === "prerequisite:vpn")!.done).toBe(true);
  });

  it("ignores what apps the person can't open yet need", () => {
    const apps = [app({ hasAccess: false, requires: [VPN] })];

    expect(buildChecklist({ ...base, apps }).map((i) => i.id)).not.toContain("prerequisite:vpn");
  });

  it("asks them to ask for an app, done after their first request", () => {
    expect(buildChecklist(base).at(-1)).toEqual({ id: "request-app", done: false, href: "/apps" });
    expect(buildChecklist({ ...base, requestCount: 1 }).at(-1)!.done).toBe(true);
  });

  it("leaves asking out while requests are off", () => {
    expect(buildChecklist({ ...base, requestsEnabled: false }).map((i) => i.id)).not.toContain("request-app");
  });
});

describe("checklistVisible", () => {
  const open = [{ id: "request-app", done: false, href: "/apps" }];
  const done = [{ id: "request-app", done: true, href: "/apps" }];

  it("shows while something is left to do", () => {
    expect(checklistVisible(open, null)).toBe(true);
  });

  it("goes once everything's done, or once dismissed", () => {
    expect(checklistVisible(done, null)).toBe(false);
    expect(checklistVisible(open, new Date())).toBe(false);
    expect(checklistVisible([], null)).toBe(false);
  });
});
