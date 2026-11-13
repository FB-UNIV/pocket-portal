import type { MailConfig, MailMessage } from "./mail";
import type { AuditEvent } from "@/lib/audit/log";
import type { NotificationKind, NotificationOutcome } from "@/lib/observability/metrics";

// The notification outbox (ADR-0011): emails are queued as rows, then sent
// from here, straight after queueing and by a sender loop on every
// replica, with retries. This file is the sending logic; the SQL is in
// ./outbox-store.ts.

export interface QueuedEmail {
  kind: NotificationKind;
  requestId: string;
  toEmail: string;
  subject: string;
  body: string;
  pocketIdGroupName: string | null;
}

export interface OutboxRow extends QueuedEmail {
  id: string;
  // Claims so far, this one included.
  attempts: number;
}

export interface OutboxStore {
  /** Up to `limit` due rows, each leased for `leaseSeconds` and its attempts counted. */
  claimDue(limit: number, leaseSeconds: number): Promise<OutboxRow[]>;
  markSent(id: string): Promise<void>;
  markRetry(id: string, nextAttemptAt: Date, error: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** Deletes sent rows after 7 days and failed ones after 30. */
  prune(): Promise<void>;
}

// After the first attempt: 1 min, 5 min, 30 min, 2 h, 6 h. Six attempts
// in all over about nine hours, which rides out a mail server restart or
// a provider's short outage without retrying forever.
const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600];
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

export function retryDelaySeconds(attempts: number): number {
  return RETRY_DELAYS_SECONDS[Math.min(attempts, RETRY_DELAYS_SECONDS.length) - 1];
}

// Long enough for a slow SMTP handshake; short enough that a replica that
// died mid-send gives its rows back within minutes.
const LEASE_SECONDS = 120;
const BATCH = 20;

export interface ProcessDeps {
  store: OutboxStore;
  /** null while there's no way to send (SMTP unset, or notifications paused). */
  mail: MailConfig | null;
  send: (config: MailConfig, message: MailMessage) => Promise<void>;
  record: (kind: NotificationKind, outcome: NotificationOutcome) => void;
  audit: (event: AuditEvent) => Promise<void>;
  log: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  now: () => Date;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Sends everything that's due, a batch at a time, until nothing is.
export async function processOutbox(deps: ProcessDeps): Promise<void> {
  await deps.store.prune();
  const mail = deps.mail;
  // Rows wait, rather than fail, until there's a way to send again.
  if (!mail) return;

  for (;;) {
    const rows = await deps.store.claimDue(BATCH, LEASE_SECONDS);
    if (rows.length === 0) return;
    for (const row of rows) await sendOne(deps, mail, row);
  }
}

async function sendOne(deps: ProcessDeps, mail: MailConfig, row: OutboxRow): Promise<void> {
  try {
    await deps.send(mail, { to: [row.toEmail], subject: row.subject, text: row.body });
  } catch (err) {
    const error = message(err);
    if (row.attempts >= MAX_ATTEMPTS) {
      await deps.store.markFailed(row.id, error);
      deps.record(row.kind, "failed");
      deps.log.error({ requestId: row.requestId, attempts: row.attempts, error }, "Notification email given up on");
      await deps.audit({
        actorSubject: "system",
        action: "notification.failed",
        targetType: "access_request",
        targetId: row.requestId,
        metadata: {
          kind: row.kind,
          recipientEmail: row.toEmail,
          pocketIdGroupName: row.pocketIdGroupName,
          attempts: row.attempts,
          error,
        },
      });
    } else {
      const next = new Date(deps.now().getTime() + retryDelaySeconds(row.attempts) * 1000);
      await deps.store.markRetry(row.id, next, error);
      deps.record(row.kind, "retried");
      deps.log.warn({ requestId: row.requestId, attempts: row.attempts, error }, "Notification email will be retried");
    }
    return;
  }
  await deps.store.markSent(row.id);
  deps.record(row.kind, "sent");
}
