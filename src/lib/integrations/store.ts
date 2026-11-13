import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { integrations } from "@/lib/db/schema";
import { writeAuditEvent } from "@/lib/audit/log";
import type { IntegrationSettings } from "./types";

// What admins set for each integration (#23), in Postgres. Every change is
// audited. Never the API key: that's the environment's.

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
export async function getIntegration(db: Db, type: IntegrationSettings["type"]): Promise<IntegrationSettings | null> {
  const [row] = await db.select().from(integrations).where(eq(integrations.type, type));
  if (!row) return null;
  return { type, baseUrl: row.baseUrl, linkedClientId: row.linkedClientId, enabled: row.enabled };
}

export async function saveIntegration(
  db: Db,
  settings: IntegrationSettings,
  actor: { subject: string; email?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const { type, ...values } = settings;
    await tx
      .insert(integrations)
      .values(settings)
      .onConflictDoUpdate({ target: integrations.type, set: { ...values, updatedAt: sql`now()` } });
    await writeAuditEvent(tx, {
      actorSubject: actor.subject,
      actorEmail: actor.email,
      action: "integration.updated",
      targetType: "integration",
      targetId: type,
      metadata: { ...values },
    });
  });
}
/* v8 ignore stop */
