import type { Db } from "@/lib/db/client";
import { appOverrides } from "@/lib/db/schema";
import {
  listPocketIdOidcClients,
  type PocketIdConfig,
  type PocketIdOidcClient,
  type PocketIdUserGroup,
} from "@/lib/pocketid/client";
import { hasAccessToClient } from "./access";
import { safeLaunchUrl } from "./launch-url";

export interface CatalogApp {
  id: string;
  name: string;
  description: string;
  launchUrl: string | null;
  iconUrl: string | null;
  isGroupRestricted: boolean;
  allowedGroups: PocketIdUserGroup[];
  hidden: boolean;
}

export interface UserCatalogApp {
  id: string;
  name: string;
  description: string;
  launchUrl: string;
  iconUrl: string | null;
  hasAccess: boolean;
  allowedGroups: PocketIdUserGroup[];
}

/* v8 ignore start -- exercised by the integration suite (real PocketID + Postgres), not unit mocks */
async function fetchClientsWithOverrides(
  pocketId: PocketIdConfig,
  db: Db,
): Promise<{ clients: PocketIdOidcClient[]; hiddenIds: Set<string> }> {
  const [clients, overrides] = await Promise.all([
    listPocketIdOidcClients(pocketId),
    db.select().from(appOverrides),
  ]);

  return {
    clients,
    hiddenIds: new Set(overrides.filter((o) => o.hidden).map((o) => o.pocketIdClientId)),
  };
}

// See docs/adr/0007-pocketid-live-catalog.md: the catalog is read live
// from PocketID, joined with the (usually empty) hide/show overrides
// table — never a stored copy of PocketID's own data.
export async function listAdminCatalogApps(
  pocketId: PocketIdConfig,
  db: Db,
): Promise<CatalogApp[]> {
  const { clients, hiddenIds } = await fetchClientsWithOverrides(pocketId, db);

  return clients.map((client) => ({
    id: client.id,
    name: client.name,
    description: client.description,
    launchUrl: safeLaunchUrl(client.launchURL),
    iconUrl: client.hasLogo ? `${pocketId.baseUrl}/api/oidc/clients/${client.id}/logo` : null,
    isGroupRestricted: client.isGroupRestricted,
    allowedGroups: client.allowedUserGroups,
    hidden: hiddenIds.has(client.id),
  }));
}

// User-facing browse view: unlike the admin list, this excludes
// apps an admin has hidden and apps with no usable launch URL (missing, or
// not http(s) — see launch-url.ts; nothing to link to, the same "not
// browsable" rule the admin UI already warns about), and
// annotates each app with whether the signed-in user already has access.
export async function listUserCatalogApps(
  pocketId: PocketIdConfig,
  db: Db,
  userGroups: string[],
): Promise<UserCatalogApp[]> {
  const { clients, hiddenIds } = await fetchClientsWithOverrides(pocketId, db);

  return clients.flatMap((client) => {
    const launchUrl = safeLaunchUrl(client.launchURL);
    if (!launchUrl || hiddenIds.has(client.id)) return [];

    return [
      {
        id: client.id,
        name: client.name,
        description: client.description,
        launchUrl,
        iconUrl: client.hasLogo ? `${pocketId.baseUrl}/api/oidc/clients/${client.id}/logo` : null,
        hasAccess: hasAccessToClient(userGroups, client),
        allowedGroups: client.allowedUserGroups,
      },
    ];
  });
}

export async function setAppHidden(
  db: Db,
  pocketIdClientId: string,
  hidden: boolean,
): Promise<void> {
  await db
    .insert(appOverrides)
    .values({ pocketIdClientId, hidden })
    .onConflictDoUpdate({
      target: appOverrides.pocketIdClientId,
      set: { hidden, updatedAt: new Date() },
    });
}
/* v8 ignore stop */