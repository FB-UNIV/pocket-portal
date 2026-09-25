import type { CatalogApp } from "@/lib/catalog/apps";
import type { AccessRequest } from "./access-requests";

// Whether approving a request may grant its group: the group must still
// be one of its client's allowed groups, and the app must not be hidden. The
// admin catalog lists hidden apps so they can be shown again, which is why
// `hidden` is checked here rather than filtered out upstream.
//
// Shared by the approve action (the real guard) and the admin queue (which
// offers Deny only when this is false), so the two can't disagree.
export function isGrantable(
  apps: CatalogApp[],
  request: Pick<AccessRequest, "pocketIdClientId" | "pocketIdGroupId">,
): boolean {
  const app = apps.find((a) => a.id === request.pocketIdClientId && !a.hidden);
  return app?.allowedGroups.some((g) => g.id === request.pocketIdGroupId) ?? false;
}
