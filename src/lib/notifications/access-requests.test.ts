import { describe, it, expect, vi } from "vitest";
import { notifyAccessRequestDecision, notifyNewAccessRequest } from "./access-requests";

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
    send: vi.fn().mockResolvedValue(undefined),
    listUsers: vi.fn().mockResolvedValue([
      { id: "1", email: "admin@example.test", isAdmin: true, disabled: false },
      { id: "2", email: "user@example.test", isAdmin: false, disabled: false },
      { id: "3", email: "gone@example.test", isAdmin: true, disabled: true },
      { id: "4", email: null, isAdmin: true, disabled: false },
    ]),
    ...overrides,
  };
}

describe("notifyNewAccessRequest", () => {
  it("emails every enabled PocketID admin with an address, with the reason and a link", async () => {
    const d = deps();

    await notifyNewAccessRequest(REQUEST, d);

    expect(d.send).toHaveBeenCalledTimes(1);
    const [config, message] = d.send.mock.calls[0];
    expect(config).toMatchObject({ host: "smtp.example.test" });
    expect(message.to).toEqual(["admin@example.test"]);
    expect(message.subject).toBe("Access request for engineering");
    expect(message.text).toContain("alice@example.test asked for access to engineering.");
    expect(message.text).toContain("On call this week.");
    expect(message.text).toContain("https://portal.example.test/admin/requests");
  });

  it("names the requester by subject and leaves out the link when unknown", async () => {
    const d = deps({ env: { SMTP_HOST: "mail", SMTP_FROM: "a@b.test" } });

    await notifyNewAccessRequest({ ...REQUEST, requesterEmail: null, message: null }, d);

    const [, message] = d.send.mock.calls[0];
    expect(message.text).toContain("user-sub asked for access");
    expect(message.text).not.toContain("http");
    expect(message.text).not.toContain("Their reason");
  });

  // PocketID names are admin-set; a newline in a subject is a header.
  it("keeps line breaks out of the subject", async () => {
    const d = deps();

    await notifyNewAccessRequest({ ...REQUEST, pocketIdGroupName: "eng\r\nBcc: x@evil.test" }, d);

    expect(d.send.mock.calls[0][1].subject).toBe("Access request for eng Bcc: x@evil.test");
  });

  // a pause switch that keeps the SMTP settings in place.
  it("sends nothing while FEATURE_EMAIL_NOTIFICATIONS is off, SMTP or not", async () => {
    const d = deps({ env: { ...ENV, FEATURE_EMAIL_NOTIFICATIONS: "false" } });

    await notifyNewAccessRequest(REQUEST, d);
    await notifyAccessRequestDecision(REQUEST, "approved", d);

    expect(d.listUsers).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("does nothing, and asks PocketID for nothing, when SMTP is off", async () => {
    const d = deps({ env: {} });

    await notifyNewAccessRequest(REQUEST, d);

    expect(d.listUsers).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  // One email each: a shared To: header would show every admin who else is
  // an admin, and one bad address shouldn't sink the rest.
  it("sends each admin their own email, and keeps going past a failed one", async () => {
    const d = deps({
      listUsers: vi.fn().mockResolvedValue([
        { email: "a@example.test", isAdmin: true, disabled: false },
        { email: "b@example.test", isAdmin: true, disabled: false },
      ]),
      send: vi.fn().mockRejectedValueOnce(new Error("550 no such user")).mockResolvedValue(undefined),
    });

    await notifyNewAccessRequest(REQUEST, d);

    expect(d.send.mock.calls.map(([, message]) => message.to)).toEqual([
      ["a@example.test"],
      ["b@example.test"],
    ]);
    expect(d.log.warn).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when no admin has an address", async () => {
    const d = deps({ listUsers: vi.fn().mockResolvedValue([]) });

    await notifyNewAccessRequest(REQUEST, d);

    expect(d.send).not.toHaveBeenCalled();
  });

  // Best-effort (ADR-0009): the request already exists, so a failure here
  // is logged, never thrown.
  it.each([
    ["the send fails", { send: vi.fn().mockRejectedValue(new Error("535 auth failed")) }],
    ["PocketID can't list admins", { listUsers: vi.fn().mockRejectedValue(new Error("503")) }],
    ["SMTP is misconfigured", { env: { SMTP_HOST: "mail" } }],
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

    const [, message] = d.send.mock.calls[0];
    expect(message.to).toEqual(["alice@example.test"]);
    expect(message.subject).toBe("Access to engineering approved");
    expect(message.text).toContain("https://portal.example.test/apps");
    expect(d.listUsers).not.toHaveBeenCalled();
  });

  it("tells the requester they were denied", async () => {
    const d = deps();

    await notifyAccessRequestDecision(REQUEST, "denied", d);

    const [, message] = d.send.mock.calls[0];
    expect(message.subject).toBe("Access to engineering denied");
    expect(message.text).toContain("request it again");
  });

  it("skips a requester with no email", async () => {
    const d = deps();

    await notifyAccessRequestDecision({ ...REQUEST, requesterEmail: null }, "approved", d);

    expect(d.send).not.toHaveBeenCalled();
  });

  it("logs and swallows a failed send", async () => {
    const d = deps({ send: vi.fn().mockRejectedValue(new Error("timeout")) });

    await expect(notifyAccessRequestDecision(REQUEST, "denied", d)).resolves.toBeUndefined();

    expect(d.log.warn).toHaveBeenCalled();
  });
});
