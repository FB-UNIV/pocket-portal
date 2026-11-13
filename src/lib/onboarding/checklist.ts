import type { UserCatalogApp } from "@/lib/catalog/apps";

// The welcome checklist (#21): what a new person should do first, computed
// from real state each time, so it can't go stale. Only what the portal
// can't see is ticked by hand: a passkey added in PocketID.

export const SELF_TICKED_ITEMS = ["backup-passkey"] as const;

export interface ChecklistItem {
  // "backup-passkey", "request-app", or "prerequisite:<client id>".
  id: string;
  done: boolean;
  href: string;
  // For a prerequisite: its name, and the person's apps that need it.
  name?: string;
  neededBy?: string[];
}

export interface ChecklistInput {
  apps: UserCatalogApp[];
  requestCount: number;
  ticked: string[];
  requestsEnabled: boolean;
  // PocketID's own account page, where passkeys are added; null when the
  // portal doesn't know PocketID's address.
  accountUrl: string | null;
  tourTaken: boolean;
}

export function buildChecklist({
  apps,
  requestCount,
  ticked,
  requestsEnabled,
  accountUrl,
  tourTaken,
}: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  if (accountUrl) {
    items.push({ id: "backup-passkey", done: ticked.includes("backup-passkey"), href: accountUrl });
  }

  // One item per app that the person's apps need (ADR-0012), only for apps
  // they can open: someone without Grafana needn't hear about the VPN.
  const prerequisites = new Map<string, ChecklistItem & { neededBy: string[] }>();
  for (const app of apps.filter((a) => a.hasAccess)) {
    for (const prerequisite of app.requires) {
      const item = prerequisites.get(prerequisite.id) ?? {
        id: `prerequisite:${prerequisite.id}`,
        done: prerequisite.hasAccess,
        // Asked for from the note under the app that needs it.
        href: "/apps",
        name: prerequisite.name,
        neededBy: [],
      };
      item.neededBy.push(app.name);
      prerequisites.set(prerequisite.id, item);
    }
  }
  items.push(...prerequisites.values());

  if (requestsEnabled) {
    items.push({ id: "request-app", done: requestCount > 0, href: "/apps" });
  }
  // The guided tour, started from the dashboard itself (/?tour=1).
  items.push({ id: "take-tour", done: tourTaken, href: "/?tour=1" });
  return items;
}

// Shown while something's left to do and they haven't hidden it.
export function checklistVisible(items: ChecklistItem[], dismissedAt: Date | null): boolean {
  return dismissedAt === null && items.some((item) => !item.done);
}
