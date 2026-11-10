import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { auth } from "@/auth";
import { readAccessRequestsEnabled, readAuditLogPageEnabled } from "@/lib/config";
import { listPendingAccessRequests, type AccessRequest } from "@/lib/requests/access-requests";
import { AdminNav } from "./admin-nav";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/config", () => ({
  readAccessRequestsEnabled: vi.fn(),
  readAuditLogPageEnabled: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/requests/access-requests", () => ({ listPendingAccessRequests: vi.fn() }));

const mockAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const mockPathname = vi.mocked(usePathname);
const mockRequestsOn = vi.mocked(readAccessRequestsEnabled);
const mockAuditOn = vi.mocked(readAuditLogPageEnabled);
const mockPending = vi.mocked(listPendingAccessRequests);

const pending = (n: number) => Array.from({ length: n }, () => ({}) as AccessRequest);

describe("AdminNav", () => {
  beforeEach(() => {
    mockAuth.mockReset().mockResolvedValue({ user: { isAdmin: true } });
    mockPathname.mockReset().mockReturnValue("/admin/apps");
    mockRequestsOn.mockReset().mockReturnValue(true);
    mockAuditOn.mockReset().mockReturnValue(true);
    mockPending.mockReset().mockResolvedValue([]);
  });

  it("renders nothing, and never reads the queue, for a non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { isAdmin: false } });

    expect(await AdminNav()).toBeNull();
    expect(mockPending).not.toHaveBeenCalled();
  });

  it("links the three admin pages", async () => {
    render(await AdminNav());

    const nav = screen.getByRole("navigation", { name: "Admin" });
    expect(within(nav).getByRole("link", { name: "Requests" })).toHaveAttribute("href", "/admin/requests");
    expect(within(nav).getByRole("link", { name: "Apps" })).toHaveAttribute("href", "/admin/apps");
    expect(within(nav).getByRole("link", { name: "History" })).toHaveAttribute("href", "/admin/audit");
  });

  it("counts the requests waiting, in the link's name", async () => {
    mockPending.mockResolvedValue(pending(3));

    render(await AdminNav());

    expect(screen.getByRole("link", { name: "Requests, 3 waiting" })).toBeInTheDocument();
  });

  // SC 1.4.1: the current page is said, not only shown in ink.
  it("marks the current page, including a page under it", async () => {
    mockPathname.mockReturnValue("/admin/apps/client-1");

    render(await AdminNav());

    expect(screen.getByRole("link", { name: "Apps" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Requests" })).not.toHaveAttribute("aria-current");
  });

  it("drops History while the audit page is switched off", async () => {
    mockAuditOn.mockReturnValue(false);

    render(await AdminNav());

    expect(screen.queryByRole("link", { name: "History" })).not.toBeInTheDocument();
  });

  it("drops Requests once they're switched off and nothing is left", async () => {
    mockRequestsOn.mockReturnValue(false);

    render(await AdminNav());

    expect(screen.queryByRole("link", { name: /^Requests/ })).not.toBeInTheDocument();
  });

  it("keeps Requests while switched off, if some still wait", async () => {
    mockRequestsOn.mockReturnValue(false);
    mockPending.mockResolvedValue(pending(1));

    render(await AdminNav());

    expect(screen.getByRole("link", { name: "Requests, 1 waiting" })).toBeInTheDocument();
  });

  it("still renders, without a count, when the queue can't be read", async () => {
    mockPending.mockRejectedValue(new Error("db down"));

    render(await AdminNav());

    expect(screen.getByRole("link", { name: "Requests" })).toBeInTheDocument();
  });
});
