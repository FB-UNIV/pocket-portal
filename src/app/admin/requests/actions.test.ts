import { describe, it, expect, vi, beforeEach } from "vitest";
import { decideAccessRequestAction } from "./actions";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { addUserToGroup } from "@/lib/pocketid/client";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { writeAuditEvent } from "@/lib/audit/log";
import { getAccessRequestById, setAccessRequestStatus } from "@/lib/requests/access-requests";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { notifyAccessRequestDecision } from "@/lib/notifications/access-requests";
import { recordAccessRequestEvent, recordGrant } from "@/lib/observability/metrics";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})), addUserToGroup: vi.fn() }));
vi.mock("@/lib/catalog/apps", () => ({ listAdminCatalogApps: vi.fn() }));
vi.mock("@/lib/audit/log", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("@/lib/requests/access-requests", () => ({
  getAccessRequestById: vi.fn(),
  setAccessRequestStatus: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/notifications/access-requests", () => ({ notifyAccessRequestDecision: vi.fn() }));
vi.mock("@/lib/observability/metrics", () => ({ recordAccessRequestEvent: vi.fn(), recordGrant: vi.fn() }));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockGetDb = vi.mocked(getDb);
const mockAddUserToGroup = vi.mocked(addUserToGroup);
const mockListAdminApps = vi.mocked(listAdminCatalogApps);
const mockWriteAudit = vi.mocked(writeAuditEvent);
const mockGetById = vi.mocked(getAccessRequestById);
const mockSetStatus = vi.mocked(setAccessRequestStatus);
const mockRevalidate = vi.mocked(revalidatePath);
const mockAfter = vi.mocked(after);
const mockNotifyDecision = vi.mocked(notifyAccessRequestDecision);

// db.transaction(cb) runs cb with this handle; the mocked helpers ignore it,
// but assertions confirm they were called with the transaction, not the pool.
const TX = { tx: true };

const PENDING = {
  id: "req-1",
  requesterSubject: "user-sub-1",
  requesterEmail: "user@example.test",
  pocketIdClientId: "client-1",
  pocketIdGroupId: "group-1",
  pocketIdGroupName: "engineering",
  message: null,
  status: "pending",
  createdAt: new Date(),
  decidedAt: null,
};

const APP_WITH_GROUP = {
  id: "client-1",
  name: "Grafana",
  description: "",
  launchUrl: "https://grafana.example.test",
  iconUrl: null,
  category: null,
  isGroupRestricted: true,
  allowedGroups: [{ id: "group-1", name: "engineering", friendlyName: "Engineering" }],
  hidden: false,
};

describe("decideAccessRequestAction", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.test", groups: [], isAdmin: true },
      expires: "",
    } as never);
    mockGetDb.mockReset().mockReturnValue({ transaction: (cb: (tx: unknown) => unknown) => cb(TX) } as never);
    mockAddUserToGroup.mockReset().mockResolvedValue(undefined);
    mockListAdminApps.mockReset().mockResolvedValue([APP_WITH_GROUP]);
    mockWriteAudit.mockReset();
    mockGetById.mockReset().mockResolvedValue({ ...PENDING });
    mockSetStatus.mockReset();
    mockRevalidate.mockReset();
    mockAfter.mockReset();
    mockNotifyDecision.mockReset();
    vi.mocked(recordAccessRequestEvent).mockReset();
    vi.mocked(recordGrant).mockReset();
  });

  it("requires admin", async () => {
    await decideAccessRequestAction("req-1", "approved");
    expect(mockRequireAdmin).toHaveBeenCalled();
  });

  it("approve grants the PocketID group, then records approved + audits it", async () => {
    await expect(decideAccessRequestAction("req-1", "approved")).resolves.toEqual({ ok: true });

    expect(mockAddUserToGroup).toHaveBeenCalledWith({}, "user-sub-1", "group-1");
    expect(mockSetStatus).toHaveBeenCalledWith(TX, "req-1", "approved");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        actorSubject: "admin-1",
        action: "access_request.approved",
        targetType: "access_request",
        targetId: "req-1",
      }),
    );
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/requests");
  });

  it("does NOT flip status when the PocketID grant fails — audits the failure and rethrows", async () => {
    mockAddUserToGroup.mockRejectedValue(new Error("PocketID 503"));

    await expect(decideAccessRequestAction("req-1", "approved")).rejects.toThrow("PocketID 503");

    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "access_request.grant_failed" }),
    );
  });

  it("refuses to grant a group that is no longer an allowed group of its client (allowlist guard)", async () => {
    mockListAdminApps.mockResolvedValue([{ ...APP_WITH_GROUP, allowedGroups: [] }]);

    // An expected refusal, not a fault: returned so the row can say why,
    // rather than thrown into the error boundary's opaque message.
    await expect(decideAccessRequestAction("req-1", "approved")).resolves.toEqual({
      ok: false,
      reason: "group_not_grantable",
    });

    expect(mockAddUserToGroup).not.toHaveBeenCalled();
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "access_request.grant_rejected" }),
    );
  });

  // a request filed before an admin hid its app must not be approvable
  // into a grant. The admin catalog lists hidden apps (so they can be shown
  // again), which is why the guard has to check `hidden` itself.
  it("refuses to grant a group of an app an admin has hidden", async () => {
    mockListAdminApps.mockResolvedValue([{ ...APP_WITH_GROUP, hidden: true }]);

    // An expected refusal, not a fault: returned so the row can say why,
    // rather than thrown into the error boundary's opaque message.
    await expect(decideAccessRequestAction("req-1", "approved")).resolves.toEqual({
      ok: false,
      reason: "group_not_grantable",
    });

    expect(mockAddUserToGroup).not.toHaveBeenCalled();
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "access_request.grant_rejected" }),
    );
  });

  it("still lets an admin deny a request for a hidden app", async () => {
    mockListAdminApps.mockResolvedValue([{ ...APP_WITH_GROUP, hidden: true }]);

    await decideAccessRequestAction("req-1", "denied");

    expect(mockSetStatus).toHaveBeenCalledWith(TX, "req-1", "denied");
  });

  it("deny records denied + audits, and never grants", async () => {
    await expect(decideAccessRequestAction("req-1", "denied")).resolves.toEqual({ ok: true });

    expect(mockAddUserToGroup).not.toHaveBeenCalled();
    expect(mockListAdminApps).not.toHaveBeenCalled();
    expect(mockSetStatus).toHaveBeenCalledWith(TX, "req-1", "denied");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "access_request.denied" }),
    );
  });

  it("audits with no actor email when the admin has none", async () => {
    mockRequireAdmin.mockResolvedValue({
      user: { id: "admin-1", email: null, groups: [], isAdmin: true },
      expires: "",
    } as never);

    await decideAccessRequestAction("req-1", "denied");

    expect(mockWriteAudit).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "access_request.denied", actorEmail: undefined }),
    );
  });

  it("is a no-op for a request that is missing or already decided", async () => {
    mockGetById.mockResolvedValue({ ...PENDING, status: "approved" });

    // Nothing to explain: the refreshed page shows the row is gone.
    await expect(decideAccessRequestAction("req-1", "approved")).resolves.toEqual({ ok: true });

    expect(mockAddUserToGroup).not.toHaveBeenCalled();
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/requests");
  });

  // ADR-0009: the requester hears the outcome only once it committed,
  // and after the response.
  it.each(["approved", "denied"] as const)("tells the requester once %s is recorded", async (decision) => {
    await decideAccessRequestAction("req-1", decision);

    expect(mockNotifyDecision).not.toHaveBeenCalled();
    for (const [callback] of mockAfter.mock.calls) await (callback as () => unknown)();
    expect(mockNotifyDecision).toHaveBeenCalledWith(expect.objectContaining({ id: "req-1" }), decision);
  });

  it("tells nobody when the grant fails, is refused, or the request was already decided", async () => {
    mockAddUserToGroup.mockRejectedValueOnce(new Error("PocketID 503"));
    await expect(decideAccessRequestAction("req-1", "approved")).rejects.toThrow();

    mockListAdminApps.mockResolvedValueOnce([]);
    await decideAccessRequestAction("req-1", "approved");

    mockGetById.mockResolvedValueOnce({ ...PENDING, status: "denied" });
    await decideAccessRequestAction("req-1", "approved");

    expect(mockAfter).not.toHaveBeenCalled();
  });
});

// Metrics (#16): decisions and grants are counted once they're final, so a
// spike in grants, or grants failing, can be alerted on (#4).
describe("decideAccessRequestAction metrics", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.test", groups: [], isAdmin: true },
      expires: "",
    } as never);
    mockGetDb.mockReset().mockReturnValue({ transaction: (cb: (tx: unknown) => unknown) => cb(TX) } as never);
    mockAddUserToGroup.mockReset().mockResolvedValue(undefined);
    mockListAdminApps.mockReset().mockResolvedValue([APP_WITH_GROUP]);
    mockGetById.mockReset().mockResolvedValue({ ...PENDING });
    vi.mocked(recordAccessRequestEvent).mockReset();
    vi.mocked(recordGrant).mockReset();
  });

  it("counts an approval and its grant", async () => {
    await decideAccessRequestAction("req-1", "approved");

    expect(recordGrant).toHaveBeenCalledWith("granted");
    expect(recordAccessRequestEvent).toHaveBeenCalledWith("approved");
  });

  it("counts a denial, and no grant", async () => {
    await decideAccessRequestAction("req-1", "denied");

    expect(recordAccessRequestEvent).toHaveBeenCalledWith("denied");
    expect(recordGrant).not.toHaveBeenCalled();
  });

  it("counts a failed grant, and no approval", async () => {
    mockAddUserToGroup.mockRejectedValue(new Error("PocketID 503"));

    await expect(decideAccessRequestAction("req-1", "approved")).rejects.toThrow();

    expect(recordGrant).toHaveBeenCalledWith("failed");
    expect(recordAccessRequestEvent).not.toHaveBeenCalled();
  });

  it("counts a refused grant, and no approval", async () => {
    mockListAdminApps.mockResolvedValue([{ ...APP_WITH_GROUP, allowedGroups: [] }]);

    await decideAccessRequestAction("req-1", "approved");

    expect(recordGrant).toHaveBeenCalledWith("refused");
    expect(recordAccessRequestEvent).not.toHaveBeenCalled();
  });

  it("counts nothing for a stale click", async () => {
    mockGetById.mockResolvedValue({ ...PENDING, status: "approved" });

    await decideAccessRequestAction("req-1", "approved");

    expect(recordGrant).not.toHaveBeenCalled();
    expect(recordAccessRequestEvent).not.toHaveBeenCalled();
  });
});
