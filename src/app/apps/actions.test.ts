import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestAccessAction } from "./actions";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/db/client";
import { getPocketIdUserGroups } from "@/lib/pocketid/client";
import { listUserCatalogApps } from "@/lib/catalog/apps";
import {
  createAccessRequest,
  listUserAccessRequests,
  reopenAccessRequest,
} from "@/lib/requests/access-requests";
import { countRecentRequestEvents, writeAuditEvent } from "@/lib/audit/log";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { notifyNewAccessRequest } from "@/lib/notifications/access-requests";

vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/pocketid/client", () => ({
  getPocketIdConfig: vi.fn(() => ({})),
  getPocketIdUserGroups: vi.fn(),
}));
vi.mock("@/lib/catalog/apps", () => ({ listUserCatalogApps: vi.fn() }));
vi.mock("@/lib/requests/access-requests", () => ({
  createAccessRequest: vi.fn(),
  listUserAccessRequests: vi.fn(),
  reopenAccessRequest: vi.fn(),
}));
vi.mock("@/lib/audit/log", () => ({
  writeAuditEvent: vi.fn(),
  countRecentRequestEvents: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/notifications/access-requests", () => ({ notifyNewAccessRequest: vi.fn() }));

const mockRequireUser = vi.mocked(requireUser);
const mockGetDb = vi.mocked(getDb);
const mockListUserCatalogApps = vi.mocked(listUserCatalogApps);
const mockGetPocketIdUserGroups = vi.mocked(getPocketIdUserGroups);
const mockCreateAccessRequest = vi.mocked(createAccessRequest);
const mockListUserAccessRequests = vi.mocked(listUserAccessRequests);
const mockReopenAccessRequest = vi.mocked(reopenAccessRequest);
const mockWriteAudit = vi.mocked(writeAuditEvent);
const mockCountRecent = vi.mocked(countRecentRequestEvents);
const mockRevalidatePath = vi.mocked(revalidatePath);
const mockAfter = vi.mocked(after);
const mockNotifyNew = vi.mocked(notifyNewAccessRequest);

// Runs whatever the action handed to after(), as Next would once the
// response is sent.
async function runAfterCallbacks() {
  for (const [callback] of mockAfter.mock.calls) await (callback as () => unknown)();
}

// The reopen path pairs the status change with its audit event in one
// transaction, so the fake db hands its callback a tx handle. Mirrors the
// shape used in src/app/admin/requests/actions.test.ts.
const TX = "fake-tx";
const DB = { transaction: (cb: (tx: unknown) => unknown) => cb(TX) };

const CATALOG_APP = {
  id: "client-1",
  name: "Sonarr",
  description: "",
  launchUrl: "https://sonarr.example.test",
  iconUrl: null,
  hasAccess: false,
  allowedGroups: [{ id: "g1", name: "media", friendlyName: "Media" }],
};

function storedRequest(status: string, decidedAt: Date | null) {
  return {
    id: "req-1",
    requesterSubject: "user-1",
    requesterEmail: null,
    pocketIdClientId: "client-1",
    pocketIdGroupId: "g1",
    pocketIdGroupName: "media",
    message: null,
    status,
    createdAt: new Date(Date.now() - 60_000),
    decidedAt,
  };
}

describe("requestAccessAction", () => {
  beforeEach(() => {
    mockRequireUser.mockReset().mockResolvedValue({
      user: { id: "user-1", email: "user@example.test", groups: [] },
      expires: "",
    } as never);
    mockGetDb.mockReset().mockReturnValue(DB as never);
    mockListUserCatalogApps.mockReset().mockResolvedValue([CATALOG_APP]);
    mockCreateAccessRequest.mockReset().mockResolvedValue({ id: "req-created" } as never);
    mockListUserAccessRequests.mockReset().mockResolvedValue([]);
    mockReopenAccessRequest.mockReset().mockResolvedValue(true);
    mockAfter.mockReset();
    mockCountRecent.mockReset().mockResolvedValue(0);
    mockNotifyNew.mockReset();
    // Default: PocketID agrees the grant really is gone.
    mockGetPocketIdUserGroups.mockReset().mockResolvedValue([]);
    mockWriteAudit.mockReset();
    mockRevalidatePath.mockReset();
  });

  it("requires a signed-in user (delegates to requireUser)", async () => {
    await requestAccessAction("client-1", "g1");

    expect(mockRequireUser).toHaveBeenCalled();
  });

  it("creates the request using the signed-in user's subject and email, deriving the group name server-side", async () => {
    await expect(requestAccessAction("client-1", "g1")).resolves.toEqual({ ok: true });

    expect(mockCreateAccessRequest).toHaveBeenCalledWith(DB, {
      requesterSubject: "user-1",
      requesterEmail: "user@example.test",
      pocketIdClientId: "client-1",
      pocketIdGroupId: "g1",
      pocketIdGroupName: "media",
      message: null,
    });
  });

  it("passes a trimmed optional message from the submitted form", async () => {
    const form = new FormData();
    form.set("message", "  I run the media stack.  ");

    await requestAccessAction("client-1", "g1", null, form);

    expect(mockCreateAccessRequest).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ message: "I run the media stack." }),
    );
  });

  it("treats a blank/whitespace-only message as null", async () => {
    const form = new FormData();
    form.set("message", "   ");

    await requestAccessAction("client-1", "g1", null, form);

    expect(mockCreateAccessRequest).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ message: null }),
    );
  });

  it("rejects a message longer than the allowed maximum (tampered submission)", async () => {
    const form = new FormData();
    form.set("message", "x".repeat(501));

    await expect(requestAccessAction("client-1", "g1", null, form)).resolves.toEqual({
      ok: false,
      reason: "message_too_long",
    });
    expect(mockCreateAccessRequest).not.toHaveBeenCalled();
  });

  it("revalidates the apps page after creating the request", async () => {
    await requestAccessAction("client-1", "g1");

    expect(mockRevalidatePath).toHaveBeenCalledWith("/apps");
  });

  it("audits the request creation", async () => {
    await requestAccessAction("client-1", "g1");

    expect(mockWriteAudit).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({
        actorSubject: "user-1",
        action: "access_request.created",
        targetType: "access_request",
        targetId: "req-created",
      }),
    );
  });

  it("handles a requester with no email — records null on the request, undefined on the audit", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1", email: null, groups: [] },
      expires: "",
    } as never);

    await requestAccessAction("client-1", "g1");

    expect(mockCreateAccessRequest).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ requesterEmail: null }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ actorEmail: undefined }),
    );
  });

  it("rejects a group id that isn't actually allowed for the given client", async () => {
    await expect(requestAccessAction("client-1", "not-a-real-group")).resolves.toEqual({
      ok: false,
      reason: "not_allowed",
    });
    expect(mockCreateAccessRequest).not.toHaveBeenCalled();
  });

  it("rejects a client id that doesn't exist in the user's browsable catalog", async () => {
    await expect(requestAccessAction("not-a-real-client", "g1")).resolves.toEqual({
      ok: false,
      reason: "not_allowed",
    });
    expect(mockCreateAccessRequest).not.toHaveBeenCalled();
  });

  it("rejects a request for a group the user is already a member of", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1", email: "user@example.test", groups: ["media"] },
      expires: "",
    } as never);

    await expect(requestAccessAction("client-1", "g1")).resolves.toEqual({
      ok: false,
      reason: "already_granted",
    });
    expect(mockCreateAccessRequest).not.toHaveBeenCalled();
  });

  it("rejects a request while one is still pending for this requester+client+group", async () => {
    mockListUserAccessRequests.mockResolvedValue([storedRequest("pending", null)]);

    await expect(requestAccessAction("client-1", "g1")).resolves.toEqual({
      ok: false,
      reason: "already_active",
    });
    expect(mockCreateAccessRequest).not.toHaveBeenCalled();
  });

  // The stale-session window: approved moments ago, so the session's groups
  // have not caught up and the "already have access" guard above misses it.
  it("rejects a request for an approval that is still reaching the session", async () => {
    mockListUserAccessRequests.mockResolvedValue([storedRequest("approved", new Date())]);

    await expect(requestAccessAction("client-1", "g1")).resolves.toEqual({
      ok: false,
      reason: "already_active",
    });
    expect(mockCreateAccessRequest).not.toHaveBeenCalled();
  });

  it("reads the requester's own requests, not the whole queue", async () => {
    await requestAccessAction("client-1", "g1");

    expect(mockListUserAccessRequests).toHaveBeenCalledWith(DB, "user-1");
  });

  it("allows a re-request after the prior one was denied", async () => {
    mockListUserAccessRequests.mockResolvedValue([storedRequest("denied", new Date())]);

    await requestAccessAction("client-1", "g1");

    expect(mockCreateAccessRequest).toHaveBeenCalled();
  });

  // approved long ago, group since removed in PocketID. A fresh insert
  // would conflict with the partial unique index and hand back the same stale
  // row, so the existing one is put back in the queue instead.
  it("reopens a revoked approval rather than inserting a second row", async () => {
    mockListUserAccessRequests.mockResolvedValue([
      storedRequest("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);

    await expect(requestAccessAction("client-1", "g1")).resolves.toEqual({ ok: true });

    expect(mockReopenAccessRequest).toHaveBeenCalledWith(TX, "req-1", {
      message: null,
      requesterEmail: "user@example.test",
    });
    expect(mockCreateAccessRequest).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "access_request.reopened", targetId: "req-1" }),
    );
  });

  // The revoked card carries a reason field, so whatever the user just typed
  // has to reach the admin reviewing the reopened request -- not the message
  // from the original one.
  it("carries the requester's new reason onto a reopened request", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1", groups: [], email: "user@example.test" },
      expires: "",
    } as never);
    mockListUserAccessRequests.mockResolvedValue([
      storedRequest("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);
    const form = new FormData();
    form.set("message", "  I need this back for the on-call rotation.  ");

    await requestAccessAction("client-1", "g1", null, form);

    expect(mockReopenAccessRequest).toHaveBeenCalledWith(TX, "req-1", {
      message: "I need this back for the on-call rotation.",
      requesterEmail: "user@example.test",
    });
  });

  // A failed refresh in auth.ts keeps the old groups while still advancing
  // groupsRefreshedAt, so a PocketID outage outlasting GRANT_SETTLE_MS makes
  // a live grant look revoked. Reopening then would put the admin's own
  // decision back in the queue and overwrite its message.
  it("does not reopen when PocketID still grants the group", async () => {
    mockListUserAccessRequests.mockResolvedValue([
      storedRequest("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);
    mockGetPocketIdUserGroups.mockResolvedValue([
      { id: "g1", name: "media", friendlyName: "Media" },
    ] as never);

    await expect(requestAccessAction("client-1", "g1")).resolves.toEqual({
      ok: false,
      reason: "already_granted",
    });
    expect(mockReopenAccessRequest).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  // Expected states come back as values; a genuine fault still throws,
  // so the error boundary -- not an inline message -- reports it.
  it("still throws when the catalog cannot be read from PocketID", async () => {
    mockListUserCatalogApps.mockRejectedValue(new Error("PocketID list OIDC clients failed: 502"));

    await expect(requestAccessAction("client-1", "g1")).rejects.toThrow(/502/);
    expect(mockCreateAccessRequest).not.toHaveBeenCalled();
  });

  it("aborts without touching the request when PocketID cannot be reached", async () => {
    mockListUserAccessRequests.mockResolvedValue([
      storedRequest("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);
    mockGetPocketIdUserGroups.mockRejectedValue(new Error("PocketID unreachable"));

    await expect(requestAccessAction("client-1", "g1")).rejects.toThrow(/unreachable/);
    expect(mockReopenAccessRequest).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  // A request entering the queue -- new or reopened -- makes the admin
  // dashboard's cached render stale.
  it("revalidates the admin queue when a request is filed", async () => {
    await requestAccessAction("client-1", "g1");

    expect(mockRevalidatePath).toHaveBeenCalledWith("/apps");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/requests");
  });

  it("revalidates the admin queue when a revoked request is reopened", async () => {
    mockListUserAccessRequests.mockResolvedValue([
      storedRequest("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);

    await requestAccessAction("client-1", "g1");

    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/requests");
  });

  // Two submissions racing: the second finds the row already pending and
  // changes nothing, so it must not log a transition that never happened.
  it("does not audit a reopen that changed no row", async () => {
    mockListUserAccessRequests.mockResolvedValue([
      storedRequest("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);
    mockReopenAccessRequest.mockResolvedValue(false);

    await requestAccessAction("client-1", "g1");

    expect(mockWriteAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/apps");
  });

  // PocketID does not require an email (requireUserEmail is configurable), so
  // the audit actor can legitimately have none.
  it("audits a reopen for a requester with no email address", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1", groups: [], email: null },
      expires: "",
    } as never);
    mockListUserAccessRequests.mockResolvedValue([
      storedRequest("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);

    await requestAccessAction("client-1", "g1");

    expect(mockWriteAudit).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "access_request.reopened", actorEmail: undefined }),
    );
  });

  // ADR-0009: admins hear about a request once it exists, after the
  // response, so a slow mail server never holds up the requester.
  it("notifies admins after a new request is filed", async () => {
    const formData = new FormData();
    formData.set("message", "on call");

    await requestAccessAction("client-1", "g1", null, formData);

    expect(mockNotifyNew).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(mockNotifyNew).toHaveBeenCalledWith({
      id: "req-created",
      requesterSubject: "user-1",
      requesterEmail: "user@example.test",
      pocketIdGroupName: "media",
      message: "on call",
    });
  });

  it("notifies admins when a revoked request is reopened", async () => {
    mockListUserAccessRequests.mockResolvedValue([
      storedRequest("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);

    await requestAccessAction("client-1", "g1");
    await runAfterCallbacks();

    expect(mockNotifyNew).toHaveBeenCalledWith(expect.objectContaining({ id: "req-1" }));
  });

  // PocketID can be configured not to require an email.
  it("notifies admins about a requester with no email, new or reopened", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1", email: null, groups: [] },
      expires: "",
    } as never);

    await requestAccessAction("client-1", "g1");
    mockListUserAccessRequests.mockResolvedValue([
      storedRequest("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);
    await requestAccessAction("client-1", "g1");
    await runAfterCallbacks();

    expect(mockNotifyNew).toHaveBeenCalledTimes(2);
    for (const [request] of mockNotifyNew.mock.calls) expect(request.requesterEmail).toBeNull();
  });

  it("notifies nobody when a reopen changed no row, or the request was refused", async () => {
    mockListUserAccessRequests.mockResolvedValue([
      storedRequest("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);
    mockReopenAccessRequest.mockResolvedValue(false);
    await requestAccessAction("client-1", "g1");

    mockListUserCatalogApps.mockResolvedValue([]);
    await requestAccessAction("client-1", "g1");

    expect(mockAfter).not.toHaveBeenCalled();
  });

  // switched off, the form isn't rendered, but the action is still a
  // callable endpoint, so it refuses on its own.
  describe("feature flags", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("refuses every request while FEATURE_ACCESS_REQUESTS is off", async () => {
      vi.stubEnv("FEATURE_ACCESS_REQUESTS", "false");

      await expect(requestAccessAction("client-1", "g1")).resolves.toEqual({
        ok: false,
        reason: "requests_disabled",
      });
      expect(mockCreateAccessRequest).not.toHaveBeenCalled();
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it("insists on a reason when ACCESS_REQUEST_REASON is required", async () => {
      vi.stubEnv("ACCESS_REQUEST_REASON", "required");
      const blank = new FormData();
      blank.set("message", "   ");

      await expect(requestAccessAction("client-1", "g1", null, blank)).resolves.toEqual({
        ok: false,
        reason: "reason_required",
      });
      expect(mockCreateAccessRequest).not.toHaveBeenCalled();
    });

    it("drops any submitted reason when ACCESS_REQUEST_REASON is off", async () => {
      vi.stubEnv("ACCESS_REQUEST_REASON", "off");
      const formData = new FormData();
      formData.set("message", "sneaked in");

      await requestAccessAction("client-1", "g1", null, formData);

      expect(mockCreateAccessRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: null }),
      );
    });
  });

  // each request emails every admin, so a user can't file without
  // bound. Counted from the audit trail, which records reopens too.
  describe("rate limit", () => {
    it("refuses the request once the user has filed 5 in the last hour", async () => {
      mockCountRecent.mockResolvedValue(5);

      await expect(requestAccessAction("client-1", "g1")).resolves.toEqual({
        ok: false,
        reason: "rate_limited",
      });
      expect(mockCreateAccessRequest).not.toHaveBeenCalled();
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it("counts this user's requests over the last hour", async () => {
      const before = Date.now();

      await requestAccessAction("client-1", "g1");

      const [, subject, since] = mockCountRecent.mock.calls[0];
      expect(subject).toBe("user-1");
      expect(since.getTime()).toBeGreaterThanOrEqual(before - 60 * 60 * 1000 - 1000);
      expect(since.getTime()).toBeLessThanOrEqual(Date.now() - 60 * 60 * 1000 + 1000);
      expect(mockCreateAccessRequest).toHaveBeenCalled();
    });
  });
});
