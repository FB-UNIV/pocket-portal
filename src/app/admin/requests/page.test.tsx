import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminRequestsPage, { metadata } from "./page";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import {
  listPendingAccessRequests,
  type AccessRequest,
} from "@/lib/requests/access-requests";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/requests/access-requests", () => ({ listPendingAccessRequests: vi.fn() }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/catalog/apps", () => ({ listAdminCatalogApps: vi.fn() }));
vi.mock("./actions", () => ({ decideAccessRequestAction: vi.fn() }));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockListAdminApps = vi.mocked(listAdminCatalogApps);

const APP = {
  id: "client-1",
  name: "Jellyfin",
  description: "",
  launchUrl: "https://jellyfin.example.test",
  iconUrl: null,
  isGroupRestricted: true,
  allowedGroups: [{ id: "g1", name: "media", friendlyName: "Media" }],
  hidden: false,
};
const mockListPending = vi.mocked(listPendingAccessRequests);

function request(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    id: "req-1",
    requesterSubject: "sub-123",
    requesterEmail: "alice@example.test",
    pocketIdClientId: "client-1",
    pocketIdGroupId: "g1",
    pocketIdGroupName: "media",
    message: "I maintain the on-call rotation.",
    status: "pending",
    createdAt: new Date("2026-09-21T10:00:00Z"),
    decidedAt: null,
    ...overrides,
  };
}

describe("AdminRequestsPage", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({} as never);
    mockListPending.mockReset();
    mockListAdminApps.mockReset().mockResolvedValue([APP]);
  });

  it("requires admin (delegates to requireAdmin)", async () => {
    mockListPending.mockResolvedValue([]);

    await AdminRequestsPage();

    expect(mockRequireAdmin).toHaveBeenCalled();
  });

  it("lists a pending request with requester, target group, message, and approve/deny actions", async () => {
    mockListPending.mockResolvedValue([request()]);

    render(await AdminRequestsPage());

    expect(
      screen.getByRole("heading", { level: 2, name: /alice@example.test/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("media")).toBeInTheDocument();
    expect(screen.getByText("I maintain the on-call rotation.")).toBeInTheDocument();
    // SC 4.1.2 / 2.4.4: a queue of rows all offering "Approve"/"Deny" needs
    // each button's accessible name to say whose request it decides — an
    // irreversible PocketID group grant is the worst place to mis-click.
    expect(
      screen.getByRole("button", { name: "Approve alice@example.test for media" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Deny alice@example.test for media" }),
    ).toBeInTheDocument();
  });

  // the approve action refuses these on purpose, so offering Approve
  // would be a button guaranteed to fail.
  it.each([
    ["its app is hidden", [{ ...APP, hidden: true }]],
    ["its group was removed from the app", [{ ...APP, allowedGroups: [] }]],
    ["its app no longer exists", []],
  ])("offers only Deny for a request that can't be granted because %s", async (_why, apps) => {
    mockListAdminApps.mockResolvedValue(apps as never);
    mockListPending.mockResolvedValue([request()]);

    render(await AdminRequestsPage());

    expect(screen.queryByRole("button", { name: /^Approve/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Deny alice@example.test for media" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/can.t be approved/i)).toBeInTheDocument();
  });

  it("falls back to the requester subject when no email is on the request", async () => {
    mockListPending.mockResolvedValue([request({ requesterEmail: null })]);

    render(await AdminRequestsPage());

    expect(screen.getByRole("heading", { level: 2, name: /sub-123/ })).toBeInTheDocument();
  });

  it("shows a muted placeholder when a request carries no message", async () => {
    mockListPending.mockResolvedValue([request({ message: null })]);

    render(await AdminRequestsPage());

    expect(screen.getByText(/No message provided/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no pending requests", async () => {
    mockListPending.mockResolvedValue([]);

    render(await AdminRequestsPage());

    expect(screen.getByText(/No pending access requests/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve/ })).not.toBeInTheDocument();
  });

  // WCAG 2.2 SC 2.4.2 Page Titled.
  it("declares its own page title", () => {
    expect(metadata.title).toBe("Access Requests");
  });

  // SC 2.4.1 Bypass Blocks — target for the header's skip link.
  it("exposes a focusable main landmark for the skip link", async () => {
    mockListPending.mockResolvedValue([]);

    render(await AdminRequestsPage());

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  // An ISO-8601 string is a machine format; SC 3.1.5-adjacent readability
  // (and plain UX) wants a human one, with the machine value kept in
  // <time datetime> so it stays parseable.
  it("renders the request time in a human-readable form, pinned to UTC", async () => {
    mockListPending.mockResolvedValue([request()]);

    render(await AdminRequestsPage());

    const time = screen.getByText(/21 Sep 2026/);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", "2026-09-21T10:00:00.000Z");
    expect(time).toHaveTextContent("21 Sep 2026, 10:00 UTC");
  });

  // the queue stays reachable to drain, and says why nothing new arrives.
  it("explains that new requests are off while still offering the pending ones", async () => {
    vi.stubEnv("FEATURE_ACCESS_REQUESTS", "false");
    mockListPending.mockResolvedValue([request()]);

    render(await AdminRequestsPage());

    expect(screen.getByText(/New requests are switched off/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Approve/ })).toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});
