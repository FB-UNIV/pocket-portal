import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { appDependencies } from "@/lib/db/schema";
import { writeAuditEvent } from "@/lib/audit/log";
import { hasAccessToClient, type AccessCheckClient } from "./access";

// App dependencies (ADR-0012): an app can need other apps to be usable
// (Grafana needs the VPN). Portal-side links between PocketID OIDC
// clients, one level deep: an app that needs another can't be needed, and
// one that's needed can't need another. No self-links, so no cycles.

export interface DependencyLink {
  clientId: string;
  requiresId: string;
}

export type DependencyProblem = "self" | "prerequisite_needs_another" | "app_is_a_prerequisite";

// Why `clientId` can't need `requiresId`, or null if it can. A link that's
// already there is fine: adding it again changes nothing.
export function dependencyProblem(
  links: DependencyLink[],
  clientId: string,
  requiresId: string,
): DependencyProblem | null {
  if (clientId === requiresId) return "self";
  if (links.some((l) => l.clientId === clientId && l.requiresId === requiresId)) return null;
  if (links.some((l) => l.clientId === requiresId)) return "prerequisite_needs_another";
  if (links.some((l) => l.requiresId === clientId)) return "app_is_a_prerequisite";
  return null;
}

export interface Prerequisite {
  id: string;
  name: string;
  hasAccess: boolean;
}

// The apps `clientId` needs, named as PocketID names them, and whether the
// user has each. A link to a client PocketID no longer has is ignored, the
// way an app_overrides row for a deleted client is.
export function prerequisitesOf(
  links: DependencyLink[],
  clients: (AccessCheckClient & { id: string; name: string })[],
  clientId: string,
  userGroups: string[],
): Prerequisite[] {
  const byId = new Map(clients.map((client) => [client.id, client]));
  return links
    .filter((link) => link.clientId === clientId)
    .flatMap((link) => {
      const client = byId.get(link.requiresId);
      return client ? [{ id: client.id, name: client.name, hasAccess: hasAccessToClient(userGroups, client) }] : [];
    });
}

export interface Actor {
  subject: string;
  email?: string;
}

// Names recorded with the audit event, so History can say "Grafana needs
// VPN" even after either is renamed or deleted in PocketID.
export interface LinkNames {
  appName?: string;
  requiresName?: string;
}

export type AddDependencyResult = { ok: true } | { ok: false; reason: DependencyProblem };

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
export async function listDependencies(db: Db): Promise<DependencyLink[]> {
  const rows = await db.select().from(appDependencies);
  return rows.map((row) => ({ clientId: row.pocketIdClientId, requiresId: row.requiresPocketIdClientId }));
}

// Checks and inserts under a table lock, in one transaction with the audit
// event: two admins adding links at once could each pass the one-level
// check alone and together build a chain. SHARE ROW EXCLUSIVE conflicts
// with itself, so concurrent adds take turns, while reads go on.
export async function addDependency(
  db: Db,
  clientId: string,
  requiresId: string,
  actor: Actor,
  names: LinkNames = {},
): Promise<AddDependencyResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${appDependencies} in share row exclusive mode`);
    const rows = await tx.select().from(appDependencies);
    const links = rows.map((row) => ({ clientId: row.pocketIdClientId, requiresId: row.requiresPocketIdClientId }));

    const problem = dependencyProblem(links, clientId, requiresId);
    if (problem) return { ok: false, reason: problem };

    const inserted = await tx
      .insert(appDependencies)
      .values({ pocketIdClientId: clientId, requiresPocketIdClientId: requiresId })
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) {
      await writeAuditEvent(tx, {
        actorSubject: actor.subject,
        actorEmail: actor.email,
        action: "app_dependency.added",
        targetType: "app",
        targetId: clientId,
        metadata: { requiresPocketIdClientId: requiresId, ...names },
      });
    }
    return { ok: true };
  });
}

export async function removeDependency(
  db: Db,
  clientId: string,
  requiresId: string,
  actor: Actor,
  names: LinkNames = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(appDependencies)
      .where(
        and(eq(appDependencies.pocketIdClientId, clientId), eq(appDependencies.requiresPocketIdClientId, requiresId)),
      )
      .returning();
    if (removed.length > 0) {
      await writeAuditEvent(tx, {
        actorSubject: actor.subject,
        actorEmail: actor.email,
        action: "app_dependency.removed",
        targetType: "app",
        targetId: clientId,
        metadata: { requiresPocketIdClientId: requiresId, ...names },
      });
    }
  });
}
/* v8 ignore stop */
