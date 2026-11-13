import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AdminAuditPage, { generateMetadata } from "./page";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listAuditEvents, type AuditEntry } from "@/lib/audit/log";
import { listPocketIdUsers } from "@/lib/pocketid/client";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/audit/log", () => ({ listAuditEvents: vi.fn() }));
vi.mock("@/lib/pocketid/client", () => ({
  getPocketIdConfig: vi.fn(() => ({})),
  listPocketIdUsers: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockList = vi.mocked(listAuditEvents);
const mockUsers = vi.mocked(listPocketIdUsers);

const user = (id: string, displayName: string) => ({
  id,
  username: id,
  email: null,
  displayName,
  isAdmin: false,
  disabled: false,
});

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
    mockUsers.mockReset().mockResolvedValue([user("admin-sub", "Ada Admin"), user("user-sub", "Alice Martin")]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  // The events, day by day (each day is a labelled section).
  const events = () =>
    screen.getAllByRole("region").flatMap((day) => within(day).getAllByRole("listitem"));

  // the table is still written; only the page goes away.
  it("is a 404 while FEATURE_AUDIT_LOG_PAGE is off", async () => {
    vi.stubEnv("FEATURE_AUDIT_LOG_PAGE", "false");

    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
    expect(mockList).not.toHaveBeenCalled();
  });

  it("requires admin", async () => {
    await renderPage();
    expect(mockRequireAdmin).toHaveBeenCalled();
  });

  // Admin redesign: each event is a sentence, people by name.
  it("tells each event as a sentence, people by the name PocketID knows them by", async () => {
    mockList.mockResolvedValue({ entries: [entry()], nextCursor: null });

    await renderPage();

    expect(events()[0]).toHaveTextContent("Ada Admin let Alice Martin into engineering");
    const time = within(events()[0]).getByText("10:00");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", "2026-09-21T10:00:00.000Z");
  });

  it("falls back to emails, then subjects, when PocketID has no name", async () => {
    mockUsers.mockRejectedValue(new Error("down"));
    mockList.mockResolvedValue({
      entries: [entry(), entry({ id: "ev-2", actorEmail: null, requesterEmail: null })],
      nextCursor: null,
    });

    await renderPage();

    expect(events()[0]).toHaveTextContent("admin@example.test let alice@example.test into engineering");
    expect(events()[1]).toHaveTextContent("admin-sub let user-sub into engineering");
  });

  it.each([
    ["access_request.created", "Alice Martin asked to join engineering"],
    ["access_request.reopened", "Alice Martin asked again to join engineering"],
  ])("tells a request (%s) with the requester as the one asking", async (action, text) => {
    mockList.mockResolvedValue({
      entries: [entry({ action, actorSubject: "user-sub", metadata: { pocketIdGroupName: "engineering" } })],
      nextCursor: null,
    });

    await renderPage();

    expect(events()[0]).toHaveTextContent(text);
  });

  it("tells a decline", async () => {
    mockList.mockResolvedValue({ entries: [entry({ action: "access_request.denied" })], nextCursor: null });

    await renderPage();

    expect(events()[0]).toHaveTextContent("Ada Admin declined Alice Martin for engineering");
  });

  it.each([
    ["access_request.grant_failed", "Ada Admin tried to add Alice Martin to engineering, but it failed."],
    ["access_request.grant_rejected", "Ada Admin tried to add Alice Martin to engineering, but PocketID refused."],
  ])("says when a grant didn't happen (%s), and why", async (action, text) => {
    mockList.mockResolvedValue({
      entries: [
        entry({
          action,
          metadata: { requesterSubject: "user-sub", pocketIdGroupName: "engineering", error: "PocketID 503" },
        }),
      ],
      nextCursor: null,
    });

    await renderPage();

    expect(events()[0]).toHaveTextContent(text);
    expect(within(events()[0]).getByText("PocketID 503")).toBeInTheDocument();
  });

  // ADR-0011: an email the outbox gave up on is a problem an admin should
  // see, with whom it was for and why it failed.
  it("says when an email couldn't be sent, to whom, and why", async () => {
    mockList.mockResolvedValue({
      entries: [
        entry({
          actorSubject: "system",
          actorEmail: null,
          action: "notification.failed",
          metadata: {
            kind: "new_request",
            recipientEmail: "ops@example.test",
            pocketIdGroupName: "engineering",
            attempts: 6,
            error: "550 no such user",
          },
        }),
      ],
      nextCursor: null,
    });

    await renderPage();

    expect(events()[0]).toHaveTextContent("The email to ops@example.test about engineering couldn’t be sent.");
    expect(within(events()[0]).getByText("550 no such user")).toBeInTheDocument();
  });

  // ADR-0012: links between apps, by the names they had then.
  it.each([
    ["app_dependency.added", "Ada Admin said Grafana needs VPN"],
    ["app_dependency.removed", "Ada Admin said Grafana no longer needs VPN"],
  ])("tells %s", async (action, text) => {
    mockList.mockResolvedValue({
      entries: [entry({ action, metadata: { requiresPocketIdClientId: "vpn", appName: "Grafana", requiresName: "VPN" } })],
      nextCursor: null,
    });

    await renderPage();

    expect(events()[0]).toHaveTextContent(text);
  });

  it("still tells an event with no metadata", async () => {
    mockList.mockResolvedValue({ entries: [entry({ metadata: null })], nextCursor: null });

    await renderPage();

    expect(events()[0]).toHaveTextContent("Ada Admin let someone into a group");
  });

  it("shows an unknown action by its raw name", async () => {
    mockList.mockResolvedValue({ entries: [entry({ action: "something.new" })], nextCursor: null });

    await renderPage();

    expect(events()[0]).toHaveTextContent("Ada Admin: something.new");
  });

  it("groups events by UTC day: today, yesterday, then the date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T09:00:00Z"));
    mockList.mockResolvedValue({
      entries: [
        entry({ id: "a", createdAt: new Date("2026-09-23T08:15:00Z") }),
        entry({ id: "b", createdAt: new Date("2026-09-22T18:42:00Z") }),
        entry({ id: "c", createdAt: new Date("2026-09-22T10:05:00Z") }),
        entry({ id: "d", createdAt: new Date("2026-09-21T10:00:00Z") }),
      ],
      nextCursor: null,
    });

    await renderPage();

    const days = screen.getAllByRole("heading", { level: 2 });
    expect(days.map((h) => h.textContent)).toEqual(["Today", "Yesterday", "21 Sep 2026"]);
    expect(within(days[1].closest("section")!).getAllByRole("listitem")).toHaveLength(2);
  });

  it.each([
    ["requests", ["access_request.created", "access_request.reopened"]],
    ["approved", ["access_request.approved"]],
    ["declined", ["access_request.denied"]],
    ["problems", ["access_request.grant_rejected", "access_request.grant_failed", "notification.failed"]],
  ])("filters with ?show=%s", async (show, actions) => {
    await renderPage({ show });

    expect(mockList).toHaveBeenCalledWith(expect.anything(), { actions, before: undefined, limit: 50 });
    const filters = screen.getByRole("navigation", { name: "Show" });
    expect(within(filters).getByRole("link", { current: "page" })).toHaveAttribute(
      "href",
      `/admin/audit?show=${show}`,
    );
  });

  // Query params are user input: an arbitrary filter is harmless but
  // pointless, and a malformed cursor would reach Postgres as a bad uuid.
  it("ignores an unknown filter and a malformed cursor", async () => {
    await renderPage({ show: "nope", before: "not-a-uuid" });

    expect(mockList).toHaveBeenCalledWith(expect.anything(), {
      actions: undefined,
      before: undefined,
      limit: 50,
    });
    expect(screen.getByRole("link", { name: "Everything" })).toHaveAttribute("aria-current", "page");
  });

  it("links to older events, keeping the filter", async () => {
    mockList.mockResolvedValue({ entries: [entry()], nextCursor: CURSOR });

    await renderPage({ show: "approved" });

    expect(screen.getByRole("link", { name: "Show older" })).toHaveAttribute(
      "href",
      `/admin/audit?show=approved&before=${CURSOR}`,
    );
  });

  it("links back to the newest events once paged", async () => {
    await renderPage({ before: CURSOR });

    expect(mockList).toHaveBeenCalledWith(expect.anything(), {
      actions: undefined,
      before: CURSOR,
      limit: 50,
    });
    expect(screen.getByRole("link", { name: "Back to the newest" })).toHaveAttribute(
      "href",
      "/admin/audit",
    );
  });

  it("says when there's nothing yet, or nothing matching", async () => {
    const { unmount } = await renderPage();
    expect(screen.getByText("Nothing has happened yet.")).toBeInTheDocument();
    expect(mockUsers).not.toHaveBeenCalled();
    unmount();

    await renderPage({ show: "problems" });
    expect(screen.getByText("Nothing like that in the history yet.")).toBeInTheDocument();
  });

  // WCAG 2.2 SC 2.4.2 Page Titled.
  it("declares its own page title", async () => {
    expect((await generateMetadata()).title).toBe("History");
  });

  // SC 2.4.1 Bypass Blocks — target for the header's skip link.
  it("exposes a focusable main landmark for the skip link", async () => {
    await renderPage();

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});
