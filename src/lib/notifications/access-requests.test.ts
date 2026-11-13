import { describe, it, expect, vi } from "vitest";
import { notifyAccessRequestDecision, notifyNewAccessRequest } from "./access-requests";
import type { QueuedEmail } from "./outbox";

const ENV = {
  SMTP_HOST: "smtp.example.test",
  SMTP_FROM: "portal@example.test",
  AUTH_URL: "https://portal.example.test/",
};

const REQUEST = {
  id: "req-1",
  requesterSubject: "user-sub",
  requesterEmail: "alice@example.test",
  pocketIdGroupName: "engineering",
  message: "On call this week.",
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    env: ENV,
    log: { warn: vi.fn() },
    queue: vi.fn<(emails: QueuedEmail[]) => Promise<void>>().mockResolvedValue(undefined),
    drain: vi.fn().mockResolvedValue(undefined),
    listUsers: vi.fn().mockResolvedValue([
      { id: "1", email: "admin@example.test", isAdmin: true, disabled: false },
      { id: "2", email: "user@example.test", isAdmin: false, disabled: false },
      { id: "3", email: "gone@example.test", isAdmin: true, disabled: true },
      { id: "4", email: null, isAdmin: true, disabled: false },
    ]),
    localeOf: vi.fn().mockResolvedValue("en"),
    record: vi.fn(),
    ...overrides,
  };
}

// Everything queued, in order, across calls.
const queued = (d: ReturnType<typeof deps>) => d.queue.mock.calls.flatMap(([emails]) => emails);

// ADR-0011: emails are queued in the outbox (one row per recipient), then
// sent from there, now and on retry.
describe("notifyNewAccessRequest", () => {
  it("queues an email for every enabled PocketID admin with an address, with the reason and a link", async () => {
    const d = deps();

    await notifyNewAccessRequest(REQUEST, d);

    expect(queued(d)).toEqual([
      {
        kind: "new_request",
        requestId: "req-1",
        toEmail: "admin@example.test",
        subject: "Access request for engineering",
        body: expect.stringContaining("alice@example.test asked for access to engineering."),
        pocketIdGroupName: "engineering",
      },
    ]);
    const [email] = queued(d);
    expect(email.body).toContain("On call this week.");
    expect(email.body).toContain("https://portal.example.test/admin/requests");
  });

  it("sends what it queued straight away", async () => {
    const d = deps();

    await notifyNewAccessRequest(REQUEST, d);

    expect(d.drain).toHaveBeenCalledTimes(1);
    expect(d.queue.mock.invocationCallOrder[0]).toBeLessThan(d.drain.mock.invocationCallOrder[0]);
  });

  it("names the requester by subject and leaves out the link when unknown", async () => {
    const d = deps({ env: { SMTP_HOST: "mail", SMTP_FROM: "a@b.test" } });

    await notifyNewAccessRequest({ ...REQUEST, requesterEmail: null, message: null }, d);

    const [email] = queued(d);
    expect(email.body).toContain("user-sub asked for access");
    expect(email.body).not.toContain("http");
    expect(email.body).not.toContain("Their reason");
  });

  // PocketID names are admin-set; a newline in a subject is a header.
  it("keeps line breaks out of the subject", async () => {
    const d = deps();

    await notifyNewAccessRequest({ ...REQUEST, pocketIdGroupName: "eng\r\nBcc: x@evil.test" }, d);

    expect(queued(d)[0].subject).toBe("Access request for eng Bcc: x@evil.test");
  });

  // NOTIFY_ADMIN_EMAILS: a fixed list instead of reading PocketID's users
  // on every request.
  it("writes to NOTIFY_ADMIN_EMAILS instead of PocketID's admins when it's set", async () => {
    const d = deps({ env: { ...ENV, NOTIFY_ADMIN_EMAILS: "ops@example.test, lead@example.test" } });

    await notifyNewAccessRequest(REQUEST, d);

    expect(d.listUsers).not.toHaveBeenCalled();
    expect(queued(d).map((email) => email.toEmail)).toEqual(["ops@example.test", "lead@example.test"]);
    // No PocketID subject, so no saved language: the portal's default.
    expect(d.localeOf).toHaveBeenCalledWith(undefined);
  });

  // a pause switch that keeps the SMTP settings in place.
  it("queues nothing while FEATURE_EMAIL_NOTIFICATIONS is off, SMTP or not", async () => {
    const d = deps({ env: { ...ENV, FEATURE_EMAIL_NOTIFICATIONS: "false" } });

    await notifyNewAccessRequest(REQUEST, d);
    await notifyAccessRequestDecision(REQUEST, "approved", d);

    expect(d.listUsers).not.toHaveBeenCalled();
    expect(d.queue).not.toHaveBeenCalled();
  });

  it("does nothing, and asks PocketID for nothing, when SMTP is off", async () => {
    const d = deps({ env: {} });

    await notifyNewAccessRequest(REQUEST, d);

    expect(d.listUsers).not.toHaveBeenCalled();
    expect(d.queue).not.toHaveBeenCalled();
  });

  // One email each: a shared To: header would show every admin who else is
  // an admin, and one bad address shouldn't sink the rest.
  it("queues each admin their own email", async () => {
    const d = deps({
      listUsers: vi.fn().mockResolvedValue([
        { id: "a", email: "a@example.test", isAdmin: true, disabled: false },
        { id: "b", email: "b@example.test", isAdmin: true, disabled: false },
      ]),
    });

    await notifyNewAccessRequest(REQUEST, d);

    expect(queued(d).map((email) => email.toEmail)).toEqual(["a@example.test", "b@example.test"]);
  });

  it("queues nothing when no admin has an address", async () => {
    const d = deps({ listUsers: vi.fn().mockResolvedValue([]) });

    await notifyNewAccessRequest(REQUEST, d);

    expect(d.queue).not.toHaveBeenCalled();
  });

  // The request already exists, so a failure here is logged, never thrown.
  it.each([
    ["the outbox can't be written", { queue: vi.fn().mockRejectedValue(new Error("db down")) }],
    ["PocketID can't list admins", { listUsers: vi.fn().mockRejectedValue(new Error("503")) }],
    ["SMTP is misconfigured", { env: { SMTP_HOST: "mail" } }],
    ["sending right away fails", { drain: vi.fn().mockRejectedValue(new Error("smtp down")) }],
  ])("logs and swallows it when %s", async (_why, overrides) => {
    const d = deps(overrides);

    await expect(notifyNewAccessRequest(REQUEST, d)).resolves.toBeUndefined();

    expect(d.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req-1", error: expect.any(Error) }),
      expect.stringMatching(/notification/i),
    );
  });
});

describe("notifyAccessRequestDecision", () => {
  it("tells the requester they were approved", async () => {
    const d = deps();

    await notifyAccessRequestDecision(REQUEST, "approved", d);

    const [email] = queued(d);
    expect(email).toMatchObject({ kind: "decision", toEmail: "alice@example.test", subject: "Access to engineering approved" });
    expect(email.body).toContain("https://portal.example.test/apps");
    expect(d.listUsers).not.toHaveBeenCalled();
  });

  it("tells the requester they were denied", async () => {
    const d = deps();

    await notifyAccessRequestDecision(REQUEST, "denied", d);

    const [email] = queued(d);
    expect(email.subject).toBe("Access to engineering denied");
    expect(email.body).toContain("request it again");
  });

  it("skips a requester with no email", async () => {
    const d = deps();

    await notifyAccessRequestDecision({ ...REQUEST, requesterEmail: null }, "approved", d);

    expect(d.queue).not.toHaveBeenCalled();
  });

  it("logs and swallows a failure to queue", async () => {
    const d = deps({ queue: vi.fn().mockRejectedValue(new Error("timeout")) });

    await expect(notifyAccessRequestDecision(REQUEST, "denied", d)).resolves.toBeUndefined();

    expect(d.log.warn).toHaveBeenCalled();
  });
});

// #64: each email is written in its recipient's language (their saved one,
// else the portal default), not the language of whoever triggered it.
describe("email language", () => {
  it("writes to each admin in their own language", async () => {
    const d = deps({
      listUsers: vi.fn().mockResolvedValue([
        { id: "admin-en", email: "en@example.test", isAdmin: true, disabled: false },
        { id: "admin-fr", email: "fr@example.test", isAdmin: true, disabled: false },
      ]),
      localeOf: vi.fn(async (subject: string) => (subject === "admin-fr" ? "fr" : "en")),
    });

    await notifyNewAccessRequest(REQUEST, d);

    const [en, fr] = queued(d);
    expect(en.subject).toBe("Access request for engineering");
    expect(fr.toEmail).toBe("fr@example.test");
    expect(fr.subject).toBe("Demande d’accès pour engineering");
    expect(fr.body).toContain("alice@example.test a demandé l’accès à engineering.");
    expect(fr.body).toContain("On call this week.");
    expect(fr.body).toContain("https://portal.example.test/admin/requests");
  });

  it("tells the requester the decision in their language, looked up by their subject", async () => {
    const d = deps({ localeOf: vi.fn().mockResolvedValue("fr") });

    await notifyAccessRequestDecision(REQUEST, "approved", d);
    await notifyAccessRequestDecision(REQUEST, "denied", d);

    expect(d.localeOf).toHaveBeenCalledWith("user-sub");
    const [approved, denied] = queued(d);
    expect(approved.subject).toBe("Accès à engineering accordé");
    expect(approved.body).toContain("Votre demande pour engineering a été approuvée.");
    expect(denied.subject).toBe("Accès à engineering refusé");
  });
});

// portal_notifications_total: queued here; sent, retried and failed are
// counted by the outbox (outbox.test.ts).
describe("notification metrics", () => {
  it("counts each email queued", async () => {
    const d = deps({
      listUsers: vi.fn().mockResolvedValue([
        { id: "a", email: "a@example.test", isAdmin: true, disabled: false },
        { id: "b", email: "b@example.test", isAdmin: true, disabled: false },
      ]),
    });

    await notifyNewAccessRequest(REQUEST, d);

    expect(d.record.mock.calls).toEqual([
      ["new_request", "queued"],
      ["new_request", "queued"],
    ]);
  });

  it("counts a failure when the recipients can't be read", async () => {
    const d = deps({ listUsers: vi.fn().mockRejectedValue(new Error("503")) });

    await notifyNewAccessRequest(REQUEST, d);

    expect(d.record.mock.calls).toEqual([["new_request", "failed"]]);
  });

  it("counts each email that couldn't be queued as failed", async () => {
    const d = deps({ queue: vi.fn().mockRejectedValue(new Error("db down")) });

    await notifyAccessRequestDecision(REQUEST, "approved", d);

    expect(d.record.mock.calls).toEqual([["decision", "failed"]]);
  });

  it("counts nothing while notifications are off", async () => {
    const d = deps({ env: { ...ENV, SMTP_HOST: "" } });

    await notifyNewAccessRequest(REQUEST, d);

    expect(d.record).not.toHaveBeenCalled();
  });
});

// #19: one email for an app and what it needs, not one each.
describe("linked requests in the email", () => {
  it("says what else was asked for with the app", async () => {
    const d = deps();

    await notifyNewAccessRequest(REQUEST, d, { alsoAsks: ["VPN"] });

    expect(queued(d)[0].body).toContain("They also asked for VPN, which it needs.");
  });

  it("writes it in the admin's language", async () => {
    const d = deps({ localeOf: vi.fn().mockResolvedValue("fr") });

    await notifyNewAccessRequest(REQUEST, d, { alsoAsks: ["VPN"] });

    expect(queued(d)[0].body).toContain("Cette personne a aussi demandé VPN, dont l’application a besoin.");
  });
});
