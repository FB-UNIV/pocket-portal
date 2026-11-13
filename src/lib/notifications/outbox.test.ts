import { describe, it, expect, vi } from "vitest";
import { processOutbox, retryDelaySeconds, MAX_ATTEMPTS, type OutboxRow, type OutboxStore } from "./outbox";

const MAIL = { host: "smtp.example.test", port: 587, tls: "starttls" as const, auth: undefined, from: "portal@example.test" };
const NOW = new Date("2026-11-13T10:00:00Z");

const row = (overrides: Partial<OutboxRow> = {}): OutboxRow => ({
  id: "row-1",
  kind: "new_request",
  requestId: "req-1",
  toEmail: "admin@example.test",
  subject: "New request",
  body: "Body\n",
  pocketIdGroupName: "engineering",
  // Already claimed: claiming counts the attempt.
  attempts: 1,
  ...overrides,
});

function store(rows: OutboxRow[]): OutboxStore & Record<string, ReturnType<typeof vi.fn>> {
  return {
    claimDue: vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]),
    markSent: vi.fn().mockResolvedValue(undefined),
    markRetry: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    prune: vi.fn().mockResolvedValue(undefined),
  };
}

function deps(rows: OutboxRow[], overrides: Record<string, unknown> = {}) {
  return {
    store: store(rows),
    mail: MAIL as typeof MAIL | null,
    send: vi.fn().mockResolvedValue(undefined),
    record: vi.fn(),
    audit: vi.fn().mockResolvedValue(undefined),
    log: { warn: vi.fn(), error: vi.fn() },
    now: () => NOW,
    ...overrides,
  };
}

describe("processOutbox", () => {
  it("sends each claimed email to its one recipient and marks it sent", async () => {
    const d = deps([row(), row({ id: "row-2", toEmail: "other@example.test", kind: "decision" })]);

    await processOutbox(d);

    expect(d.send.mock.calls).toEqual([
      [MAIL, { to: ["admin@example.test"], subject: "New request", text: "Body\n" }],
      [MAIL, { to: ["other@example.test"], subject: "New request", text: "Body\n" }],
    ]);
    expect(d.store.markSent.mock.calls).toEqual([["row-1"], ["row-2"]]);
    expect(d.record.mock.calls).toEqual([
      ["new_request", "sent"],
      ["decision", "sent"],
    ]);
  });

  it("claims with a lease, in batches, until nothing is due", async () => {
    const d = deps([row()]);

    await processOutbox(d);

    expect(d.store.claimDue).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    expect(d.store.claimDue).toHaveBeenCalledTimes(2);
  });

  // A transient SMTP failure (timeout, 4xx) is retried later, not dropped.
  it("schedules a failed send for a retry, with backoff", async () => {
    const d = deps([row({ attempts: 2 })], { send: vi.fn().mockRejectedValue(new Error("421 try later")) });

    await processOutbox(d);

    expect(d.store.markRetry).toHaveBeenCalledWith(
      "row-1",
      new Date(NOW.getTime() + retryDelaySeconds(2) * 1000),
      "421 try later",
    );
    expect(d.store.markSent).not.toHaveBeenCalled();
    expect(d.record).toHaveBeenCalledWith("new_request", "retried");
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("gives up after the last attempt: failed, counted, and in the audit trail", async () => {
    const d = deps([row({ attempts: MAX_ATTEMPTS })], {
      send: vi.fn().mockRejectedValue(new Error("550 no such user")),
    });

    await processOutbox(d);

    expect(d.store.markFailed).toHaveBeenCalledWith("row-1", "550 no such user");
    expect(d.record).toHaveBeenCalledWith("new_request", "failed");
    expect(d.audit).toHaveBeenCalledWith({
      actorSubject: "system",
      action: "notification.failed",
      targetType: "access_request",
      targetId: "req-1",
      metadata: {
        kind: "new_request",
        recipientEmail: "admin@example.test",
        pocketIdGroupName: "engineering",
        attempts: MAX_ATTEMPTS,
        error: "550 no such user",
      },
    });
  });

  it("keeps going past a failed email", async () => {
    const d = deps([row(), row({ id: "row-2" })], {
      send: vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue(undefined),
    });

    await processOutbox(d);

    expect(d.store.markRetry).toHaveBeenCalledTimes(1);
    expect(d.store.markSent).toHaveBeenCalledWith("row-2");
  });

  // Paused, or SMTP unset since the email was queued: leave rows waiting.
  it("claims nothing while there's no way to send", async () => {
    const d = deps([row()], { mail: null });

    await processOutbox(d);

    expect(d.store.claimDue).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("prunes old rows on each pass", async () => {
    const d = deps([]);

    await processOutbox(d);

    expect(d.store.prune).toHaveBeenCalled();
  });
});

describe("retryDelaySeconds", () => {
  it("backs off: 1 min, 5 min, 30 min, 2 h, 6 h", () => {
    expect([1, 2, 3, 4, 5].map(retryDelaySeconds)).toEqual([60, 300, 1800, 7200, 21600]);
  });

  it("gives up after six attempts in all", () => {
    expect(MAX_ATTEMPTS).toBe(6);
  });
});
