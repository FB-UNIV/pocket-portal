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
import { withSpan } from "@/lib/observability/tracing";
import { listDependencies, prerequisitesOf, type DependencyLink, type Prerequisite } from "./dependencies";

export interface CatalogApp {
  id: string;
  name: string;
  description: string;
  launchUrl: string | null;
  iconUrl: string | null;
  isGroupRestricted: boolean;
  allowedGroups: PocketIdUserGroup[];
  hidden: boolean;
  category: string | null;
  // The apps this one needs to be usable (ADR-0012), named from PocketID.
  requires: { id: string; name: string }[];
}

export interface UserCatalogApp {
  id: string;
  name: string;
  description: string;
  launchUrl: string;
  iconUrl: string | null;
  hasAccess: boolean;
  allowedGroups: PocketIdUserGroup[];
  category: string | null;
  // The apps this one needs (ADR-0012), and whether the user has each.
  // Prerequisites can be hidden or have no link (a VPN): they count anyway.
  requires: Prerequisite[];
}

/* v8 ignore start -- exercised by the integration suite (real PocketID + Postgres), not unit mocks */
// One span per catalog build (#16): PocketID's client list and the
// overrides are read in parallel under it, so a slow page shows which.
function fetchClientsWithOverrides(
  pocketId: PocketIdConfig,
  db: Db,
  view: "admin" | "user",
): Promise<{
  clients: PocketIdOidcClient[];
  hiddenIds: Set<string>;
  categories: Map<string, string>;
  links: DependencyLink[];
}> {
  return withSpan("catalog.build", { "portal.catalog.view": view }, async (span) => {
    const [clients, overrides, links] = await Promise.all([
      listPocketIdOidcClients(pocketId),
      db.select().from(appOverrides),
      listDependencies(db),
    ]);
    span.setAttribute("portal.catalog.clients", clients.length);

    return {
      clients,
      links,
      hiddenIds: new Set(overrides.filter((o) => o.hidden).map((o) => o.pocketIdClientId)),
      categories: new Map(
        overrides.flatMap((o) => (o.category ? [[o.pocketIdClientId, o.category] as const] : [])),
      ),
    };
  });
}

// See docs/adr/0007-pocketid-live-catalog.md: the catalog is read live
// from PocketID, joined with the (usually empty) hide/show overrides
// table — never a stored copy of PocketID's own data.
export async function listAdminCatalogApps(
  pocketId: PocketIdConfig,
  db: Db,
): Promise<CatalogApp[]> {
  const { clients, hiddenIds, categories, links } = await fetchClientsWithOverrides(pocketId, db, "admin");

  return clients.map((client) => ({
    id: client.id,
    name: client.name,
    description: client.description,
    launchUrl: safeLaunchUrl(client.launchURL),
    iconUrl: client.hasLogo ? `${pocketId.baseUrl}/api/oidc/clients/${client.id}/logo` : null,
    isGroupRestricted: client.isGroupRestricted,
    allowedGroups: client.allowedUserGroups,
    hidden: hiddenIds.has(client.id),
    category: categories.get(client.id) ?? null,
    requires: prerequisitesOf(links, clients, client.id, []).map(({ id, name }) => ({ id, name })),
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
  const { clients, hiddenIds, categories, links } = await fetchClientsWithOverrides(pocketId, db, "user");

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
        category: categories.get(client.id) ?? null,
        requires: prerequisitesOf(links, clients, client.id, userGroups),
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

// `category` is stored as given: callers pass it through normalizeCategory
// (./browse) first. Null clears it. A row that ends up neither hidden nor
// categorised is left in place, harmless, rather than deleted.
export async function setAppCategory(
  db: Db,
  pocketIdClientId: string,
  category: string | null,
): Promise<void> {
  await db
    .insert(appOverrides)
    .values({ pocketIdClientId, category })
    .onConflictDoUpdate({
      target: appOverrides.pocketIdClientId,
      set: { category, updatedAt: new Date() },
    });
}
/* v8 ignore stop */
