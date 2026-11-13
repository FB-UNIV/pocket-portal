import { and, eq, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { notificationOutbox } from "@/lib/db/schema";
import type { NotificationKind } from "@/lib/observability/metrics";
import type { OutboxRow, OutboxStore, QueuedEmail } from "./outbox";

// The outbox's SQL (ADR-0011). Shared state lives here, in Postgres, so any
// replica can send any row and none keeps anything in memory.

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
export function createOutboxStore(db: Db): OutboxStore & { enqueue(emails: QueuedEmail[]): Promise<void> } {
  const done = (id: string, status: "sent" | "failed", error: string | null) =>
    db
      .update(notificationOutbox)
      .set({ status, lockedUntil: null, lastError: error, updatedAt: sql`now()` })
      .where(eq(notificationOutbox.id, id))
      .then(() => undefined);

  return {
    async enqueue(emails) {
      if (emails.length === 0) return;
      await db.insert(notificationOutbox).values(emails);
    },

    // Pending, due, and not leased by another replica (or its lease ran
    // out: that replica died mid-send). SKIP LOCKED makes concurrent claims
    // from several replicas take disjoint rows instead of waiting on, or
    // double-claiming, each other's. Claiming counts the attempt, so a row
    // that keeps killing its sender still runs out of attempts.
    async claimDue(limit, leaseSeconds) {
      const rows = await db.execute<{
        id: string;
        kind: string;
        request_id: string;
        to_email: string;
        subject: string;
        body: string;
        pocket_id_group_name: string | null;
        attempts: number;
      }>(sql`
        update ${notificationOutbox}
        set attempts = attempts + 1,
            locked_until = now() + make_interval(secs => ${leaseSeconds}),
            updated_at = now()
        where id in (
          select id from ${notificationOutbox}
          where status = 'pending'
            and next_attempt_at <= now()
            and (locked_until is null or locked_until < now())
          order by next_attempt_at
          limit ${limit}
          for update skip locked
        )
        returning id, kind, request_id, to_email, subject, body, pocket_id_group_name, attempts
      `);
      return rows.map(
        (row): OutboxRow => ({
          id: row.id,
          kind: row.kind as NotificationKind,
          requestId: row.request_id,
          toEmail: row.to_email,
          subject: row.subject,
          body: row.body,
          pocketIdGroupName: row.pocket_id_group_name,
          attempts: Number(row.attempts),
        }),
      );
    },

    markSent: (id) => done(id, "sent", null),
    markFailed: (id, error) => done(id, "failed", error),

    async markRetry(id, nextAttemptAt, error) {
      await db
        .update(notificationOutbox)
        .set({ nextAttemptAt, lockedUntil: null, lastError: error, updatedAt: sql`now()` })
        .where(eq(notificationOutbox.id, id));
    },

    // Addresses and request messages, kept no longer than needed: a week
    // for what was sent, a month for what failed (to look into it).
    async prune() {
      await db
        .delete(notificationOutbox)
        .where(
          or(
            and(eq(notificationOutbox.status, "sent"), lt(notificationOutbox.updatedAt, sql`now() - interval '7 days'`)),
            and(eq(notificationOutbox.status, "failed"), lt(notificationOutbox.updatedAt, sql`now() - interval '30 days'`)),
          ),
        );
    },
  };
}
/* v8 ignore stop */
