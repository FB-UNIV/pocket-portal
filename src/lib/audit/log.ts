import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { accessRequests, auditLog } from "@/lib/db/schema";
import type { Db, DbTx } from "@/lib/db/client";

// See docs/adr/0006-audit-trail-separate-from-logs.md.
export interface AuditEvent {
  actorSubject: string;
  actorEmail?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

// A stored event as the admin audit page shows it.
export interface AuditEntry {
  id: string;
  actorSubject: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
  // For an access-request event, the requester's email from the request row:
  // decision events only record the requester's subject.
  requesterEmail: string | null;
}

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
export async function writeAuditEvent(db: Db | DbTx, event: AuditEvent): Promise<void> {
  await db.insert(auditLog).values(event);
}

// Newest first, keyset-paged on (created_at, id). `before` is the id of the
// last entry of the previous page, and the cursor row's own timestamp is
// looked up in SQL: a JS Date only has milliseconds, Postgres keeps
// microseconds, so a timestamp round-tripped through the client could skip
// or repeat rows. An id that matches nothing yields an empty page.
export async function listAuditEvents(
  db: Db,
  { action, before, limit }: { action?: string; before?: string; limit: number },
): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> {
  const rows = await db
    .select({
      id: auditLog.id,
      actorSubject: auditLog.actorSubject,
      actorEmail: auditLog.actorEmail,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      requesterEmail: accessRequests.requesterEmail,
    })
    .from(auditLog)
    .leftJoin(
      accessRequests,
      and(
        eq(auditLog.targetType, "access_request"),
        eq(auditLog.targetId, sql`${accessRequests.id}::text`),
      ),
    )
    .where(
      and(
        action ? eq(auditLog.action, action) : undefined,
        before
          ? sql`(${auditLog.createdAt}, ${auditLog.id}) < (select created_at, id from audit_log where id = ${before})`
          : undefined,
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    // One extra row says whether there is an older page, without a count.
    .limit(limit + 1);

  const entries = rows.slice(0, limit);
  return {
    entries,
    nextCursor: rows.length > limit ? entries[entries.length - 1].id : null,
  };
}
// A user's own submissions since `since`, new and reopened, for the
// per-user request limit. From the audit trail because it records
// reopens, which leave access_requests.created_at untouched.
export async function countRecentRequestEvents(
  db: Db,
  actorSubject: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actorSubject, actorSubject),
        inArray(auditLog.action, ["access_request.created", "access_request.reopened"]),
        gte(auditLog.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}
/* v8 ignore stop */
