import { configSource, readEmailNotificationsEnabled, type ConfigSource } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/audit/log";
import { logger } from "@/lib/observability/logger";
import { recordNotification } from "@/lib/observability/metrics";
import { readMailConfig, sendMail, type MailConfig } from "./mail";
import { processOutbox } from "./outbox";
import { createOutboxStore } from "./outbox-store";

// Wiring for the outbox (ADR-0011): the real database, SMTP, metrics and
// audit trail behind processOutbox, and the sender loop each replica runs.

/* v8 ignore start -- wiring only; processOutbox and the store are tested */
// No way to send: paused, SMTP unset, or SMTP misconfigured (which
// validateConfig already reports at startup). Rows wait until there is.
function mailOrNull(env: ConfigSource): MailConfig | null {
  if (!readEmailNotificationsEnabled(env)) return null;
  try {
    return readMailConfig(env);
  } catch {
    return null;
  }
}

export function drainOutbox(env: ConfigSource = configSource()): Promise<void> {
  const db = getDb();
  return processOutbox({
    store: createOutboxStore(db),
    mail: mailOrNull(env),
    send: sendMail,
    record: recordNotification,
    audit: (event) => writeAuditEvent(db, event),
    log: logger,
    now: () => new Date(),
  });
}

const INTERVAL_MS = 30_000;

// Every replica sends what's due every 30 s: retries, and anything queued
// by a replica that stopped before it could send. Replicas never step on
// each other (SKIP LOCKED), so there's no leader to elect. Started once per
// process from instrumentation.ts; unref'd, so it never keeps a stopping
// process alive. A first pass after a random delay, so replicas started
// together don't all poll at once.
export function startOutboxSender(): void {
  let running = false;
  const pass = async () => {
    // A slow SMTP server can make a pass outlast the interval: never two at
    // once in one process.
    if (running) return;
    running = true;
    try {
      await drainOutbox();
    } catch (err) {
      logger.warn({ err }, "Notification outbox pass failed; trying again shortly");
    } finally {
      running = false;
    }
  };
  setTimeout(() => {
    void pass();
    setInterval(() => void pass(), INTERVAL_MS).unref();
  }, Math.random() * INTERVAL_MS).unref();
}
/* v8 ignore stop */
