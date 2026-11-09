import type { CatalogApp } from "@/lib/catalog/apps";
import type { AccessRequest } from "./access-requests";

export interface RequestContext {
  // The app asked for, while PocketID still lists it.
  app: CatalogApp | null;
  // The group as an admin knows it: PocketID's friendly name, else the name
  // stored with the request.
  groupLabel: string;
  // Every shown app that group opens, the one asked for first: what
  // approving actually hands out, which is often more than one app.
  opens: string[];
}

// What a queued request is about, worked out from the catalog the admin
// page already loads; no extra PocketID calls.
export function requestContext(
  apps: CatalogApp[],
  request: Pick<AccessRequest, "pocketIdClientId" | "pocketIdGroupId" | "pocketIdGroupName">,
): RequestContext {
  const app = apps.find((a) => a.id === request.pocketIdClientId) ?? null;
  const group = apps
    .flatMap((a) => a.allowedGroups)
    .find((g) => g.id === request.pocketIdGroupId);
  const groupLabel = group?.friendlyName || group?.name || request.pocketIdGroupName;

  const opens = apps
    .filter((a) => !a.hidden && a.allowedGroups.some((g) => g.id === request.pocketIdGroupId))
    .sort((a, b) =>
      a.id === request.pocketIdClientId ? -1 : b.id === request.pocketIdClientId ? 1 : 0,
    )
    .map((a) => a.name);

  return { app, groupLabel, opens };
}
