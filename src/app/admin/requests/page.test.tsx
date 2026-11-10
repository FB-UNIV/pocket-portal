import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminRequestsPage, { generateMetadata } from "./page";
import { setTestLocale } from "@/test/intl";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { listPocketIdUsers } from "@/lib/pocketid/client";
import {
  listPendingAccessRequests,
  type AccessRequest,
} from "@/lib/requests/access-requests";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/requests/access-requests", () => ({ listPendingAccessRequests: vi.fn() }));
vi.mock("@/lib/pocketid/client", () => ({
  getPocketIdConfig: vi.fn(() => ({})),
  listPocketIdUsers: vi.fn(),
}));
vi.mock("@/lib/catalog/apps", () => ({ listAdminCatalogApps: vi.fn() }));
vi.mock("./actions", () => ({ decideAccessRequestAction: vi.fn() }));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockListAdminApps = vi.mocked(listAdminCatalogApps);
const mockListUsers = vi.mocked(listPocketIdUsers);

const ALICE = {
  id: "sub-123",
  username: "alice",
  email: "alice@example.test",
  displayName: "Alice Martin",
  isAdmin: false,
  disabled: false,
};

const APP = {
  id: "client-1",
  name: "Jellyfin",
  description: "",
  launchUrl: "https://jellyfin.example.test",
  iconUrl: null,
  category: null,
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
    mockListUsers.mockReset().mockResolvedValue([ALICE]);
  });

  it("requires admin (delegates to requireAdmin)", async () => {
    mockListPending.mockResolvedValue([]);

    await AdminRequestsPage();

    expect(mockRequireAdmin).toHaveBeenCalled();
  });

  // Admin redesign: people by the name PocketID knows them by, not an email.
  it("reads each request as a sentence, with the note and approve/decline actions", async () => {
    mockListPending.mockResolvedValue([request()]);

    render(await AdminRequestsPage());

    expect(
      screen.getByRole("heading", { level: 2, name: "Alice Martin wants Jellyfin" }),
    ).toBeInTheDocument();
    expect(screen.getByText("“I maintain the on-call rotation.”")).toBeInTheDocument();
    // SC 4.1.2 / 2.4.4: a queue of rows all offering "Approve"/"Decline" needs
    // each button's accessible name to say whose request it decides — an
    // irreversible PocketID group grant is the worst place to mis-click.
    expect(
      screen.getByRole("button", { name: "Approve Alice Martin for media" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Decline Alice Martin for media" }),
    ).toBeInTheDocument();
  });

  // Names are a nicety: the queue still works on the request's own email.
  it.each([
    ["PocketID can't be asked", () => mockListUsers.mockRejectedValue(new Error("down"))],
    ["PocketID has no such user any more", () => mockListUsers.mockResolvedValue([])],
    ["the user has no display name", () => mockListUsers.mockResolvedValue([{ ...ALICE, displayName: " " }])],
  ])("names the requester by email when %s", async (_why, arrange) => {
    arrange();
    mockListPending.mockResolvedValue([request()]);

    render(await AdminRequestsPage());

    expect(
      screen.getByRole("heading", { level: 2, name: "alice@example.test wants Jellyfin" }),
    ).toBeInTheDocument();
  });

  it("puts what the app is for under the sentence", async () => {
    mockListAdminApps.mockResolvedValue([{ ...APP, description: "Watch films and series" }]);
    mockListPending.mockResolvedValue([request()]);

    render(await AdminRequestsPage());

    expect(screen.getByRole("listitem")).toHaveTextContent("Watch films and series");
  });

  // What approving hands out, in the group's PocketID friendly name: one
  // group often opens more than the app that was asked for.
  it("says which group approving adds them to, and every app it opens", async () => {
    const sonarr = { ...APP, id: "client-2", name: "Sonarr" };
    mockListAdminApps.mockResolvedValue([sonarr, APP]);
    mockListPending.mockResolvedValue([request()]);

    render(await AdminRequestsPage());

    expect(
      screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Joins Media, which opens Jellyfin and Sonarr"),
    ).toBeInTheDocument();
  });

  it("names only the group when it opens just the app asked for", async () => {
    mockListPending.mockResolvedValue([request()]);

    render(await AdminRequestsPage());

    expect(
      screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Joins Media"),
    ).toBeInTheDocument();
  });

  it("counts the people waiting in the heading", async () => {
    mockListPending.mockResolvedValue([request(), request({ id: "req-2" })]);

    render(await AdminRequestsPage());

    expect(screen.getByRole("heading", { level: 1, name: "2 people are waiting" })).toBeInTheDocument();
  });

  // the approve action refuses these on purpose, so offering Approve
  // would be a button guaranteed to fail.
  it.each([
    ["its app is hidden", [{ ...APP, hidden: true }]],
    ["its group was removed from the app", [{ ...APP, allowedGroups: [] }]],
    ["its app no longer exists", []],
  ])("offers only Decline for a request that can't be granted because %s", async (_why, apps) => {
    mockListAdminApps.mockResolvedValue(apps as never);
    mockListPending.mockResolvedValue([request()]);

    render(await AdminRequestsPage());

    expect(screen.queryByRole("button", { name: /^Approve/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Decline Alice Martin for media" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/can.t be approved/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Joins/)).not.toBeInTheDocument();
  });

  it("falls back to the requester subject when there's neither a name nor an email", async () => {
    mockListUsers.mockResolvedValue([]);
    mockListPending.mockResolvedValue([request({ requesterEmail: null })]);

    render(await AdminRequestsPage());

    expect(screen.getByRole("heading", { level: 2, name: /sub-123/ })).toBeInTheDocument();
  });

  it("shows nothing in place of a note the requester didn't write", async () => {
    mockListPending.mockResolvedValue([request({ message: null })]);

    render(await AdminRequestsPage());

    expect(screen.queryByText("No note.")).not.toBeInTheDocument();
    expect(screen.queryByRole("blockquote")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no pending requests", async () => {
    mockListPending.mockResolvedValue([]);

    render(await AdminRequestsPage());

    expect(screen.getByRole("heading", { level: 1, name: "You’re all caught up" })).toBeInTheDocument();
    expect(mockListUsers).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Approve/ })).not.toBeInTheDocument();
  });

  // WCAG 2.2 SC 2.4.2 Page Titled.
  it("declares its own page title", async () => {
    expect((await generateMetadata()).title).toBe("Requests");
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
    expect(time).toHaveTextContent("asked 21 Sep 2026, 10:00 UTC");
  });

  it("says today or yesterday for a recent request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T09:00:00Z"));
    mockListPending.mockResolvedValue([
      request({ createdAt: new Date("2026-09-22T08:15:00Z") }),
      request({ id: "req-2", createdAt: new Date("2026-09-21T18:42:00Z") }),
    ]);

    render(await AdminRequestsPage());
    vi.useRealTimers();

    expect(screen.getByText("asked today, 08:15 UTC").tagName).toBe("TIME");
    expect(screen.getByText("asked yesterday, 18:42 UTC")).toBeInTheDocument();
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

  it("speaks French when the page is in French, dates included", async () => {
    setTestLocale("fr");
    mockListPending.mockResolvedValue([request(), request({ id: "req-2" })]);

    render(await AdminRequestsPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "2 personnes attendent" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("demandé le 21 sept. 2026 à 10:00 UTC")).toHaveLength(2);
    expect(
      screen.getAllByRole("heading", { level: 2, name: "Alice Martin veut Jellyfin" }),
    ).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Refuser / })).toHaveLength(2);
  });
});
