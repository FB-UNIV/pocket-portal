import { listPocketIdUsers, type PocketIdConfig } from "./client";

// PocketID's name for each user, by user id (an OIDC subject), for the admin
// pages that name people. displayName first; PocketID 2.16 can leave it
// empty when only first and last are set (observed), so those come next.
// A nicety: if PocketID can't be asked, callers fall back to emails.
export async function pocketIdDisplayNames(config: PocketIdConfig): Promise<Map<string, string>> {
  try {
    const users = await listPocketIdUsers(config);
    const named = users.map((user) => {
      const full = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
      return [user.id, user.displayName.trim() || full] as const;
    });
    return new Map(named.filter(([, name]) => name));
  } catch {
    return new Map();
  }
}
