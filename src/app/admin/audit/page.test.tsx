import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AdminAuditPage, { metadata } from "./page";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listAuditEvents, type AuditEntry } from "@/lib/audit/log";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/audit/log", () => ({ listAuditEvents: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockList = vi.mocked(listAuditEvents);

const CURSOR = "3f2b8c1e-7a4d-4e5f-9b6a-1c2d3e4f5a6b";

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "ev-1",
    actorSubject: "admin-sub",
    actorEmail: "admin@example.test",
    action: "access_request.approved",
    targetType: "access_request",
    targetId: "req-1",
    metadata: { requesterSubject: "user-sub", pocketIdGroupName: "engineering" },
    createdAt: new Date("2026-09-21T10:00:00Z"),
    requesterEmail: "alice@example.test",
    ...overrides,
  };
}

function renderPage(params: Record<string, string> = {}) {
  return AdminAuditPage({ searchParams: Promise.resolve(params) }).then(render);
}

describe("AdminAuditPage", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({} as never);
    mockList.mockReset().mockResolvedValue({ entries: [], nextCursor: null });
  });

  // the table is still written; only the page goes away.
  it("is a 404 while FEATURE_AUDIT_LOG_PAGE is off", async () => {
    vi.stubEnv("FEATURE_AUDIT_LOG_PAGE", "false");

    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
    expect(mockList).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("requires admin", async () => {
    await renderPage();
    expect(mockRequireAdmin).toHaveBeenCalled();
  });

  it("shows an event's time, what happened, who did it, and to whom", async () => {
    mockList.mockResolvedValue({ entries: [entry()], nextCursor: null });

    await renderPage();

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("21 Sep 2026, 10:00 UTC").tagName).toBe("TIME");
    expect(within(row).getByText("Approved")).toBeInTheDocument();
    expect(within(row).getByText("admin@example.test")).toBeInTheDocument();
    expect(within(row).getByText(/engineering/)).toBeInTheDocument();
    expect(within(row).getByText(/alice@example.test/)).toBeInTheDocument();
  });

  it("falls back to subjects when no email is known", async () => {
    mockList.mockResolvedValue({
      entries: [entry({ actorEmail: null, requesterEmail: null })],
      nextCursor: null,
    });

    await renderPage();

    expect(screen.getByText("admin-sub")).toBeInTheDocument();
    expect(screen.getByText(/user-sub/)).toBeInTheDocument();
  });

  // The requester is the actor for their own request; naming them twice is noise.
  it("doesn't repeat the requester on an event they performed", async () => {
    mockList.mockResolvedValue({
      entries: [
        entry({
          action: "access_request.created",
          actorSubject: "user-sub",
          actorEmail: "alice@example.test",
          metadata: { pocketIdGroupName: "engineering" },
        }),
      ],
      nextCursor: null,
    });

    await renderPage();

    expect(screen.getAllByText(/alice@example.test/)).toHaveLength(1);
  });

  it("shows why a grant failed", async () => {
    mockList.mockResolvedValue({
      entries: [entry({ action: "access_request.grant_failed", metadata: { error: "PocketID 503" } })],
      nextCursor: null,
    });

    await renderPage();

    const table = screen.getByRole("table");
    expect(within(table).getByText("Grant failed")).toBeInTheDocument();
    expect(within(table).getByText(/PocketID 503/)).toBeInTheDocument();
  });

  it("renders an event with no metadata", async () => {
    mockList.mockResolvedValue({ entries: [entry({ metadata: null })], nextCursor: null });

    await renderPage();

    expect(within(screen.getByRole("table")).getByText("Approved")).toBeInTheDocument();
  });

  it("shows an unknown action by its raw name", async () => {
    mockList.mockResolvedValue({ entries: [entry({ action: "something.new" })], nextCursor: null });

    await renderPage();

    expect(screen.getByText("something.new")).toBeInTheDocument();
  });

  it("filters by a known action and keeps it selected", async () => {
    await renderPage({ action: "access_request.denied" });

    expect(mockList).toHaveBeenCalledWith(expect.anything(), {
      action: "access_request.denied",
      before: undefined,
      limit: 50,
    });
    expect(screen.getByLabelText("Action")).toHaveValue("access_request.denied");
  });

  // Query params are user input: an arbitrary action is harmless but
  // pointless, and a malformed cursor would reach Postgres as a bad uuid.
  it("ignores an unknown action and a malformed cursor", async () => {
    await renderPage({ action: "nope", before: "not-a-uuid" });

    expect(mockList).toHaveBeenCalledWith(expect.anything(), {
      action: undefined,
      before: undefined,
      limit: 50,
    });
  });

  it("links to older events, keeping the filter", async () => {
    mockList.mockResolvedValue({ entries: [entry()], nextCursor: CURSOR });

    await renderPage({ action: "access_request.approved" });

    expect(screen.getByRole("link", { name: "Older events" })).toHaveAttribute(
      "href",
      `/admin/audit?action=access_request.approved&before=${CURSOR}`,
    );
  });

  it("links back to the newest events once paged", async () => {
    await renderPage({ before: CURSOR });

    expect(mockList).toHaveBeenCalledWith(expect.anything(), {
      action: undefined,
      before: CURSOR,
      limit: 50,
    });
    expect(screen.getByRole("link", { name: "Newest events" })).toHaveAttribute(
      "href",
      "/admin/audit",
    );
  });

  it("shows an empty state", async () => {
    await renderPage();

    expect(screen.getByText(/No audit events/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // WCAG 2.2 SC 2.4.2 Page Titled.
  it("declares its own page title", () => {
    expect(metadata.title).toBe("Audit Log");
  });

  // SC 2.4.1 Bypass Blocks — target for the header's skip link.
  it("exposes a focusable main landmark for the skip link", async () => {
    await renderPage();

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});
