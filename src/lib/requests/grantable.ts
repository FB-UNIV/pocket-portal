import type { CatalogApp } from "@/lib/catalog/apps";
import type { AccessRequest } from "./access-requests";

// Whether approving a request may grant its group: the group must still
// be one of its client's allowed groups, and the app must not be hidden. The
// admin catalog lists hidden apps so they can be shown again, which is why
// `hidden` is checked here rather than filtered out upstream.
//
// Shared by the approve action (the real guard) and the admin queue (which
// offers Deny only when this is false), so the two can't disagree.
//
// A prerequisite (ADR-0012) counts as shown while a visible app needs it:
// a VPN is usually hidden, with no page of its own, and is still what makes
// Grafana usable.
export function isGrantable(
  apps: CatalogApp[],
  request: Pick<AccessRequest, "pocketIdClientId" | "pocketIdGroupId">,
): boolean {
  const app = apps.find((a) => a.id === request.pocketIdClientId);
  if (!app) return false;
  const shown = !app.hidden || apps.some((other) => !other.hidden && other.requires.some((r) => r.id === app.id));
  return shown && app.allowedGroups.some((g) => g.id === request.pocketIdGroupId);
}
