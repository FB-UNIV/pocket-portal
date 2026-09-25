import type { PocketIdUserGroup } from "@/lib/pocketid/client";

export interface AccessCheckClient {
  isGroupRestricted: boolean;
  allowedUserGroups: PocketIdUserGroup[];
}

// PocketID's OIDC "groups" claim carries each group's `name` (verified
// against its source, backend/internal/oidc/claims_service.go), so
// matching happens on `name`, not `friendlyName` or `id`.
export function hasAccessToClient(userGroups: string[], client: AccessCheckClient): boolean {
  if (!client.isGroupRestricted) {
    return true;
  }

  const allowedNames = new Set(client.allowedUserGroups.map((group) => group.name));
  return userGroups.some((group) => allowedNames.has(group));
}
