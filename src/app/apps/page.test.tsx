import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AppsPage, { metadata } from "./page";
import { requireUser } from "@/lib/auth/require-user";
import { listUserCatalogApps } from "@/lib/catalog/apps";
import { listUserAccessRequests } from "@/lib/requests/access-requests";

vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/catalog/apps", () => ({ listUserCatalogApps: vi.fn() }));
vi.mock("@/lib/requests/access-requests", () => ({ listUserAccessRequests: vi.fn() }));
vi.mock("./actions", () => ({ requestAccessAction: vi.fn() }));

const mockRequireUser = vi.mocked(requireUser);
const mockListUserCatalogApps = vi.mocked(listUserCatalogApps);
const mockListUserAccessRequests = vi.mocked(listUserAccessRequests);

describe("AppsPage", () => {
  beforeEach(() => {
    mockRequireUser
      .mockReset()
      .mockResolvedValue({ user: { id: "user-1", groups: [] }, expires: "" } as never);
    mockListUserCatalogApps.mockReset();
    mockListUserAccessRequests.mockReset().mockResolvedValue([]);
  });

  it("requires a signed-in user (delegates to requireUser)", async () => {
    mockListUserCatalogApps.mockResolvedValue([]);

    await AppsPage();

    expect(mockRequireUser).toHaveBeenCalled();
  });

  it("shows an Open link and no request form for an app the user already has access to", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1", groups: ["media"] },
      expires: "",
    } as never);
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Immich",
        description: "Photo library",
        launchUrl: "https://photos.example.test",
        iconUrl: null,
        hasAccess: true,
        allowedGroups: [],
      },
    ]);

    render(await AppsPage());

    // SC 4.1.2 / 2.4.4: one "Open" per app in a list is ambiguous out of
    // context, so the accessible name carries the app it opens.
    expect(screen.getByRole("link", { name: "Open Immich" })).toHaveAttribute(
      "href",
      "https://photos.example.test",
    );
    expect(screen.queryByRole("button", { name: /Request access/ })).not.toBeInTheDocument();
  });

  it("shows a Request access button per allowed group when access is missing", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1", groups: [] }, expires: "" } as never);
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Sonarr",
        description: "",
        launchUrl: "https://sonarr.example.test",
        iconUrl: null,
        hasAccess: false,
        allowedGroups: [
          { id: "g1", name: "media", friendlyName: "Media" },
          { id: "g2", name: "media-admin", friendlyName: "Media Admin" },
        ],
      },
    ]);

    render(await AppsPage());

    expect(screen.getByRole("button", { name: "Request access via Media" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request access via Media Admin" }),
    ).toBeInTheDocument();
  });

  it("offers an optional message field on each request form", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1", groups: [] }, expires: "" } as never);
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Sonarr",
        description: "",
        launchUrl: "https://sonarr.example.test",
        iconUrl: null,
        hasAccess: false,
        allowedGroups: [{ id: "g1", name: "media", friendlyName: "Media" }],
      },
    ]);

    render(await AppsPage());

    const messageField = screen.getByLabelText(/reason for requesting Media/i);
    expect(messageField).toBeInTheDocument();
    expect(messageField).not.toBeRequired();
  });

  it("shows a fallback message when a restricted app has no groups configured to request", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1", groups: [] }, expires: "" } as never);
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Internal Service",
        description: "",
        launchUrl: "https://internal.example.test",
        iconUrl: null,
        hasAccess: false,
        allowedGroups: [],
      },
    ]);

    render(await AppsPage());

    expect(screen.getByText("No group grants access to this app yet.")).toBeInTheDocument();
  });

  it("labels a group as pending instead of showing a button when already requested", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1", groups: [] }, expires: "" } as never);
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Sonarr",
        description: "",
        launchUrl: "https://sonarr.example.test",
        iconUrl: null,
        hasAccess: false,
        allowedGroups: [{ id: "g1", name: "media", friendlyName: "Media" }],
      },
    ]);
    mockListUserAccessRequests.mockResolvedValue([
      {
        id: "req-1",
        requesterSubject: "user-1",
        requesterEmail: null,
        pocketIdClientId: "client-1",
        pocketIdGroupId: "g1",
        pocketIdGroupName: "media",
        message: null,
        status: "pending",
        createdAt: new Date(),
        decidedAt: null,
      },
    ]);

    render(await AppsPage());

    expect(screen.getByText("Pending: Media")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request access via Media" }),
    ).not.toBeInTheDocument();
  });

  // an approval or a denial used to be invisible -- the form simply
  // reappeared, indistinguishable from never having asked.
  describe("request outcomes", () => {
    const RESTRICTED_APP = {
      id: "client-1",
      name: "Grafana",
      description: "",
      launchUrl: "https://grafana.example.test",
      iconUrl: null,
      hasAccess: false,
      allowedGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering" }],
    };

    function requestRow(status: string, decidedAt: Date | null) {
      return {
        id: "req-1",
        requesterSubject: "user-1",
        requesterEmail: null,
        pocketIdClientId: "client-1",
        pocketIdGroupId: "g1",
        pocketIdGroupName: "engineering",
        message: null,
        status,
        createdAt: new Date(Date.now() - 60_000),
        decidedAt,
      };
    }

    it("tells the requester a denial happened, and still lets them ask again", async () => {
      mockListUserCatalogApps.mockResolvedValue([RESTRICTED_APP]);
      mockListUserAccessRequests.mockResolvedValue([requestRow("denied", new Date())]);

      render(await AppsPage());

      expect(screen.getByText("Denied: Engineering")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Request access via Engineering" }),
      ).toBeInTheDocument();
    });

    // The exact case that produced a 500: approved, session groups not caught
    // up, so the card offered a request that could only fail.
    it("reports a fresh approval and withdraws the request form", async () => {
      mockListUserCatalogApps.mockResolvedValue([RESTRICTED_APP]);
      mockListUserAccessRequests.mockResolvedValue([requestRow("approved", new Date())]);

      render(await AppsPage());

      expect(screen.getByText("Approved: Engineering")).toBeInTheDocument();
      expect(screen.getByText(/may take a few minutes/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Request access via Engineering" }),
      ).not.toBeInTheDocument();
    });

    // approved long ago and still not held -- the grant was taken away.
    it("reports a revoked grant as removed, and lets the user ask again", async () => {
      mockListUserCatalogApps.mockResolvedValue([RESTRICTED_APP]);
      mockListUserAccessRequests.mockResolvedValue([
        requestRow("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ]);

      render(await AppsPage());

      expect(screen.getByText("Access removed: Engineering")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Request access via Engineering" }),
      ).toBeInTheDocument();
    });

    it("says nothing about a request whose access the user now actually holds", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1", groups: ["engineering"] },
        expires: "",
      } as never);
      mockListUserCatalogApps.mockResolvedValue([{ ...RESTRICTED_APP, hasAccess: true }]);
      mockListUserAccessRequests.mockResolvedValue([requestRow("approved", new Date())]);

      render(await AppsPage());

      expect(screen.getByRole("link", { name: "Open Grafana" })).toBeInTheDocument();
      expect(screen.queryByText(/Approved: Engineering/)).not.toBeInTheDocument();
    });
  });

  // WCAG 2.2 SC 2.4.2 Page Titled.
  it("declares its own page title", () => {
    expect(metadata.title).toBe("Apps");
  });

  // SC 2.4.1 Bypass Blocks — target for the header's skip link.
  it("exposes a focusable main landmark for the skip link", async () => {
    mockListUserCatalogApps.mockResolvedValue([]);

    render(await AppsPage());

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  // SC 1.3.1: the app list is a list of named things; each card's name should
  // be a heading so screen-reader users can jump between apps.
  it("gives each app a heading under the page title", async () => {
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Immich",
        description: "Photo library",
        launchUrl: "https://photos.example.test",
        iconUrl: null,
        hasAccess: true,
        allowedGroups: [],
      },
    ]);

    render(await AppsPage());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Apps");
    expect(screen.getByRole("heading", { level: 2, name: "Immich" })).toBeInTheDocument();
  });

  it("names the pending badge after the group it is pending for", async () => {
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Sonarr",
        description: "",
        launchUrl: "https://sonarr.example.test",
        iconUrl: null,
        hasAccess: false,
        allowedGroups: [
          { id: "g1", name: "media", friendlyName: "Media" },
          { id: "g2", name: "media-admin", friendlyName: "Media Admin" },
        ],
      },
    ]);
    mockListUserAccessRequests.mockResolvedValue([
      {
        id: "req-1",
        requesterSubject: "user-1",
        requesterEmail: null,
        pocketIdClientId: "client-1",
        pocketIdGroupId: "g1",
        pocketIdGroupName: "media",
        message: null,
        status: "pending",
        createdAt: new Date(),
        decidedAt: null,
      },
    ]);

    render(await AppsPage());

    // Two groups on one app: a bare "Pending" would not say which.
    expect(screen.getByText("Pending: Media")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request access via Media Admin" }),
    ).toBeInTheDocument();
  });

  // with requests off the portal is a pure launcher (ADR-0001).
  describe("with FEATURE_ACCESS_REQUESTS off", () => {
    afterEach(() => vi.unstubAllEnvs());

    const OPEN = {
      id: "client-1",
      name: "Immich",
      description: "",
      launchUrl: "https://photos.example.test",
      iconUrl: null,
      hasAccess: true,
      allowedGroups: [],
    };
    const RESTRICTED = {
      id: "client-2",
      name: "Grafana",
      description: "",
      launchUrl: "https://grafana.example.test",
      iconUrl: null,
      hasAccess: false,
      allowedGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering" }],
    };

    it("lists only the apps the user can open, with no request forms", async () => {
      vi.stubEnv("FEATURE_ACCESS_REQUESTS", "false");
      mockListUserCatalogApps.mockResolvedValue([OPEN, RESTRICTED]);

      render(await AppsPage());

      expect(screen.getByRole("link", { name: "Open Immich" })).toBeInTheDocument();
      expect(screen.queryByText("Grafana")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Request access/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/can be requested/)).not.toBeInTheDocument();
    });

    it("says so when the user can open nothing", async () => {
      vi.stubEnv("FEATURE_ACCESS_REQUESTS", "false");
      mockListUserCatalogApps.mockResolvedValue([RESTRICTED]);

      render(await AppsPage());

      expect(screen.getByText(/don.t have access to any apps yet/)).toBeInTheDocument();
    });
  });

  it("passes the reason mode to each request form", async () => {
    vi.stubEnv("ACCESS_REQUEST_REASON", "required");
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-2",
        name: "Grafana",
        description: "",
        launchUrl: "https://grafana.example.test",
        iconUrl: null,
        hasAccess: false,
        allowedGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering" }],
      },
    ]);

    render(await AppsPage());

    expect(screen.getByLabelText(/\(required\)/)).toBeRequired();
    vi.unstubAllEnvs();
  });
});
