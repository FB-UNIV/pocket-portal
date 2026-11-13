import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AppsPage, { generateMetadata } from "./page";
import { requireUser } from "@/lib/auth/require-user";
import { listUserCatalogApps } from "@/lib/catalog/apps";
import { listUserAccessRequests } from "@/lib/requests/access-requests";
import { setTestLocale } from "@/test/intl";

vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/catalog/apps", () => ({ listUserCatalogApps: vi.fn() }));
vi.mock("@/lib/requests/access-requests", () => ({ listUserAccessRequests: vi.fn() }));
vi.mock("./actions", () => ({ requestAppAccessAction: vi.fn() }));

const mockRequireUser = vi.mocked(requireUser);
const mockListUserCatalogApps = vi.mocked(listUserCatalogApps);
const mockListUserAccessRequests = vi.mocked(listUserAccessRequests);
// /apps?ask=<app id>: the one app whose request form is open.
const asking = (id: string, more: Record<string, string> = {}) => ({
  searchParams: Promise.resolve({ ask: id, ...more }),
});

// An app the user can open is a card in the "Ready to open" section, named
// by its own words: what it's for, then its name. Looked up in that section
// so an "Ask for <app>" link (which also ends with the name) never matches.
const usableSection = () => screen.queryByRole("region", { name: /^(Ready to open|Prêtes à ouvrir)$/ });
const appNamePattern = (app: string) => new RegExp(`(^| )${app}$`);
const openLink = (app: string) =>
  within(usableSection()!).getByRole("link", { name: appNamePattern(app) });
const queryOpenLink = (app: string) => {
  const section = usableSection();
  return section ? within(section).queryByRole("link", { name: appNamePattern(app) }) : null;
};

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
        category: null,
        hasAccess: true,
        requires: [],
        allowedGroups: [],
      },
    ]);

    render(await AppsPage());

    // SC 2.4.4 / 2.5.3: the card's own words name the link, so the name
    // says which app it opens and contains everything the card shows.
    expect(openLink("Immich")).toHaveAttribute(
      "href",
      "https://photos.example.test",
    );
    expect(screen.queryByRole("link", { name: /^Ask/ })).not.toBeInTheDocument();
  });

  // The redesign: the request form stays closed until asked for, as a plain
  // link (works without JavaScript), so the section is a short list.
  it("lists an app to ask for with an Ask link, and no form until it's pressed", async () => {
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Sonarr",
        description: "Find new episodes",
        launchUrl: "https://sonarr.example.test",
        iconUrl: null,
        category: null,
        hasAccess: false,
        requires: [],
        allowedGroups: [{ id: "g1", name: "media", friendlyName: "Media" }],
      },
    ]);

    render(await AppsPage({ searchParams: Promise.resolve({ q: "episodes" }) }));

    expect(screen.getByRole("heading", { level: 2, name: "Ask for more" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask for Sonarr" })).toHaveAttribute(
      "href",
      "/apps?q=episodes&ask=client-1",
    );
    expect(screen.queryByRole("button", { name: /Send request/ })).not.toBeInTheDocument();
  });

  it("opens that one app's form, with a Cancel that keeps the search", async () => {
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Sonarr",
        description: "Find new episodes",
        launchUrl: "https://sonarr.example.test",
        iconUrl: null,
        category: null,
        hasAccess: false,
        requires: [],
        allowedGroups: [{ id: "g1", name: "media", friendlyName: "Media" }],
      },
    ]);

    render(await AppsPage(asking("client-1", { q: "episodes" })));

    expect(screen.getByRole("button", { name: "Send request for Sonarr" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ask for Sonarr" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/apps?q=episodes");
  });

  it("ignores an ask for an app that can't be asked for", async () => {
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Immich",
        description: "",
        launchUrl: "https://photos.example.test",
        iconUrl: null,
        category: null,
        hasAccess: true,
        requires: [],
        allowedGroups: [],
      },
    ]);

    render(await AppsPage(asking("client-1")));

    expect(screen.queryByRole("button", { name: /Send request/ })).not.toBeInTheDocument();
  });

  it("keeps the page to its title, search and two sections: no intro, no tip", async () => {
    mockListUserCatalogApps.mockResolvedValue([]);

    render(await AppsPage());

    expect(screen.queryByText(/New here\?/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Everything you can open/)).not.toBeInTheDocument();
  });

  it("leads each app card with what the app is for, then its name", async () => {
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Immich",
        description: "Your photos, backed up",
        launchUrl: "https://photos.example.test",
        iconUrl: null,
        category: null,
        hasAccess: true,
        requires: [],
        allowedGroups: [],
      },
    ]);

    render(await AppsPage());

    // What it's for, then its name; the "I" letter mark is decorative and
    // stays out of the name.
    expect(screen.getByRole("link", { name: "Your photos, backed up Immich" })).toBeInTheDocument();
  });

  it("offers one request per app, with a role picker starting on the everyday role", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1", groups: [] }, expires: "" } as never);
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Sonarr",
        description: "",
        launchUrl: "https://sonarr.example.test",
        iconUrl: null,
        category: null,
        hasAccess: false,
        requires: [],
        allowedGroups: [
          { id: "g1", name: "media", friendlyName: "Media" },
          { id: "g2", name: "media-admin", friendlyName: "Media Admin" },
        ],
      },
    ]);

    render(await AppsPage(asking("client-1")));

    expect(screen.getAllByRole("button", { name: /Send request/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Send request for Sonarr" })).toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: "Role" });
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Media",
      "Media Admin",
    ]);
    expect(picker).toHaveValue("g1");
  });

  it("preselects the users role even when PocketID lists the admin one first", async () => {
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Jellyfin",
        description: "",
        launchUrl: "https://jellyfin.example.test",
        iconUrl: null,
        category: null,
        hasAccess: false,
        requires: [],
        allowedGroups: [
          { id: "g-admins", name: "jellyfin-admins", friendlyName: "Jellyfin admins" },
          { id: "g-users", name: "jellyfin-users", friendlyName: "Jellyfin users" },
        ],
      },
    ]);

    render(await AppsPage(asking("client-1")));

    expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue("g-users");
  });

  it("offers an optional reason field, and no picker for a single role", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1", groups: [] }, expires: "" } as never);
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Sonarr",
        description: "",
        launchUrl: "https://sonarr.example.test",
        iconUrl: null,
        category: null,
        hasAccess: false,
        requires: [],
        allowedGroups: [{ id: "g1", name: "media", friendlyName: "Media" }],
      },
    ]);

    render(await AppsPage(asking("client-1")));

    const messageField = screen.getByLabelText(/Why\? \(optional\)/);
    expect(messageField).toBeInTheDocument();
    expect(messageField).not.toBeRequired();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
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
        category: null,
        hasAccess: false,
        requires: [],
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
        category: null,
        hasAccess: false,
        requires: [],
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

    // One role: the status needs no group name.
    expect(screen.getByText("Waiting for an admin")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Ask/ })).not.toBeInTheDocument();
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
      category: null,
      hasAccess: false,
      requires: [],
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

      expect(screen.getByText("Not approved")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Ask again for Grafana" })).toBeInTheDocument();
    });

    // The exact case that produced a 500: approved, session groups not caught
    // up, so the card offered a request that could only fail.
    it("reports a fresh approval and withdraws the request form", async () => {
      mockListUserCatalogApps.mockResolvedValue([RESTRICTED_APP]);
      mockListUserAccessRequests.mockResolvedValue([requestRow("approved", new Date())]);

      render(await AppsPage());

      expect(screen.getByText("Approved — ready in a few minutes")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Ask/ })).not.toBeInTheDocument();
    });

    // approved long ago and still not held -- the grant was taken away.
    it("reports a revoked grant as removed, and lets the user ask again", async () => {
      mockListUserCatalogApps.mockResolvedValue([RESTRICTED_APP]);
      mockListUserAccessRequests.mockResolvedValue([
        requestRow("approved", new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ]);

      render(await AppsPage());

      expect(screen.getByText("Access removed")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Ask again for Grafana" })).toBeInTheDocument();
    });

    it("says nothing about a request whose access the user now actually holds", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "user-1", groups: ["engineering"] },
        expires: "",
      } as never);
      mockListUserCatalogApps.mockResolvedValue([{ ...RESTRICTED_APP, hasAccess: true }]);
      mockListUserAccessRequests.mockResolvedValue([requestRow("approved", new Date())]);

      render(await AppsPage());

      expect(openLink("Grafana")).toBeInTheDocument();
      expect(screen.queryByText(/Approved/)).not.toBeInTheDocument();
    });
  });

  // WCAG 2.2 SC 2.4.2 Page Titled.
  it("declares its own page title", async () => {
    expect((await generateMetadata()).title).toBe("Apps");
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
  // be a heading (under its section's) so screen-reader users can jump
  // between apps.
  it("gives each app a heading under the page title", async () => {
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Immich",
        description: "Photo library",
        launchUrl: "https://photos.example.test",
        iconUrl: null,
        category: null,
        hasAccess: true,
        requires: [],
        allowedGroups: [],
      },
    ]);

    render(await AppsPage());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Apps");
    expect(screen.getByRole("heading", { level: 2, name: "Ready to open" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Immich" })).toBeInTheDocument();
  });

  it("names the pending role, and leaves only the other roles to pick from", async () => {
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Sonarr",
        description: "",
        launchUrl: "https://sonarr.example.test",
        iconUrl: null,
        category: null,
        hasAccess: false,
        requires: [],
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

    render(await AppsPage(asking("client-1")));

    // Two groups on one app: a bare "Waiting" would not say which.
    expect(screen.getByText("Media: waiting for an admin")).toBeInTheDocument();
    // One role left, so no picker: the form asks for Media Admin.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const form = screen.getByRole("button", { name: "Send request for Sonarr" }).closest("form")!;
    expect(new FormData(form).get("group")).toBe("g2");
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
      category: null,
      hasAccess: true,
      requires: [],
      allowedGroups: [],
    };
    const RESTRICTED = {
      id: "client-2",
      name: "Grafana",
      description: "",
      launchUrl: "https://grafana.example.test",
      iconUrl: null,
      category: null,
      hasAccess: false,
      requires: [],
      allowedGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering" }],
    };

    it("lists only the apps the user can open, with no request forms", async () => {
      vi.stubEnv("FEATURE_ACCESS_REQUESTS", "false");
      mockListUserCatalogApps.mockResolvedValue([OPEN, RESTRICTED]);

      render(await AppsPage());

      expect(openLink("Immich")).toBeInTheDocument();
      expect(screen.queryByText("Grafana")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Ask/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Ask for more" })).not.toBeInTheDocument();
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
        category: null,
        hasAccess: false,
        requires: [],
        allowedGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering" }],
      },
    ]);

    render(await AppsPage(asking("client-2")));

    expect(screen.getByLabelText(/\(required\)/)).toBeRequired();
    vi.unstubAllEnvs();
  });

  describe("finding an app", () => {
    const app = (id: string, name: string, description: string, category: string | null, hasAccess = true) => ({
      id,
      name,
      description,
      launchUrl: `https://${id}.example.test`,
      iconUrl: null,
      category,
      hasAccess,
      allowedGroups: hasAccess ? [] : [{ id: "g1", name: "family", friendlyName: "Family" }],
      requires: [],
    });
    const catalog = [
      app("jf", "Jellyfin", "Watch films and series", "Watch & listen"),
      app("nc", "Nextcloud", "Keep and share your files", "Files"),
      app("im", "Immich", "See the family photos", "Files", false),
    ];
    const params = (p: Record<string, string>) => ({ searchParams: Promise.resolve(p) });

    beforeEach(() => {
      mockListUserCatalogApps.mockResolvedValue(catalog);
    });

    it("offers a search box and one link per category, plus Everything", async () => {
      render(await AppsPage());

      expect(screen.getByRole("searchbox", { name: "Search apps" })).toBeInTheDocument();
      const nav = screen.getByRole("navigation", { name: "Categories" });
      const links = within(nav).getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual(["Everything", "Files", "Watch & listen"]);
      expect(within(nav).getByRole("link", { name: "Everything" })).toHaveAttribute("aria-current", "page");
      expect(within(nav).getByRole("link", { name: "Files" })).toHaveAttribute("href", "/apps?category=Files");
    });

    it("hides the category links while no app has a category", async () => {
      mockListUserCatalogApps.mockResolvedValue(catalog.map((a) => ({ ...a, category: null })));

      render(await AppsPage());

      expect(screen.queryByRole("navigation", { name: "Categories" })).not.toBeInTheDocument();
    });

    it("filters both sections by the search, and says how many matched", async () => {
      render(await AppsPage(params({ q: "photos" })));

      expect(queryOpenLink("Jellyfin")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 3, name: "Immich" })).toBeInTheDocument();
      expect(screen.getByText(/1 app found\./)).toBeInTheDocument();
      expect(screen.getByRole("searchbox", { name: "Search apps" })).toHaveValue("photos");
      // Nothing usable matched, so that section steps aside.
      expect(screen.queryByRole("heading", { name: "Ready to open" })).not.toBeInTheDocument();
    });

    it("filters by category, marks it current, and keeps it when searching again", async () => {
      const { container } = render(await AppsPage(params({ category: "Files" })));

      expect(openLink("Nextcloud")).toBeInTheDocument();
      expect(queryOpenLink("Jellyfin")).not.toBeInTheDocument();
      const nav = screen.getByRole("navigation", { name: "Categories" });
      expect(within(nav).getByRole("link", { name: "Files" })).toHaveAttribute("aria-current", "page");
      expect(container.querySelector('form[role="search"] input[name="category"]')).toHaveValue("Files");
    });

    it("ignores a category no app has, rather than showing nothing", async () => {
      render(await AppsPage(params({ category: "Games" })));

      expect(openLink("Jellyfin")).toBeInTheDocument();
      expect(screen.queryByText(/found|Nothing matches/)).not.toBeInTheDocument();
    });

    it("says when nothing matches, with a way back", async () => {
      render(await AppsPage(params({ q: "spreadsheets" })));

      expect(screen.getByText(/Nothing matches “spreadsheets”\./)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Show everything" })).toHaveAttribute("href", "/apps");
    });
  });

  it("speaks French when the page is in French, down to the request form", async () => {
    setTestLocale("fr");
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Immich",
        description: "Vos photos",
        launchUrl: "https://photos.example.test",
        iconUrl: null,
        category: null,
        hasAccess: true,
        requires: [],
        allowedGroups: [],
      },
      {
        id: "client-2",
        name: "Sonarr",
        description: "",
        launchUrl: "https://sonarr.example.test",
        iconUrl: null,
        category: null,
        hasAccess: false,
        requires: [],
        allowedGroups: [
          { id: "g1", name: "media", friendlyName: "Media" },
          { id: "g2", name: "media-admin", friendlyName: "Media Admin" },
        ],
      },
    ]);

    const { unmount } = render(await AppsPage());
    expect(screen.getByRole("link", { name: "Demander l’accès à Sonarr" })).toBeInTheDocument();
    unmount();

    render(await AppsPage(asking("client-2")));

    expect(screen.getByRole("heading", { level: 1, name: "Applications" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Prêtes à ouvrir" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "En demander d’autres" })).toBeInTheDocument();
    expect(openLink("Immich")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Envoyer la demande pour Sonarr" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Annuler" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rôle" })).toBeInTheDocument();
    expect((await generateMetadata()).title).toBe("Applications");
  });

  it("counts search results in French", async () => {
    setTestLocale("fr");
    mockListUserCatalogApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Immich",
        description: "Vos photos",
        launchUrl: "https://photos.example.test",
        iconUrl: null,
        category: null,
        hasAccess: true,
        requires: [],
        allowedGroups: [],
      },
    ]);

    render(await AppsPage({ searchParams: Promise.resolve({ q: "photos" }) }));

    expect(screen.getByText(/1 application trouvée\./)).toBeInTheDocument();
  });
});

// ADR-0012: an app that only works with another one says so. The portal
// doesn't enforce it: Open still works.
describe("AppsPage: apps that need another app", () => {
  const base = {
    description: "",
    iconUrl: null,
    category: null,
    allowedGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering" }],
  };

  beforeEach(() => {
    mockRequireUser.mockReset().mockResolvedValue({ user: { id: "user-1", groups: ["engineering"] }, expires: "" } as never);
    mockListUserAccessRequests.mockReset().mockResolvedValue([]);
  });

  it("says on the card when an app needs one the user doesn't have yet", async () => {
    mockListUserCatalogApps.mockReset().mockResolvedValue([
      { ...base, id: "grafana", name: "Grafana", launchUrl: "https://grafana.example.test", hasAccess: true, requires: [{ id: "vpn", name: "VPN", hasAccess: false }] },
    ]);

    render(await AppsPage());

    expect(openLink("Grafana")).toHaveAttribute("href", "https://grafana.example.test");
    expect(within(usableSection()!).getByText("Needs VPN to work, which you don’t have yet.")).toBeInTheDocument();
  });

  it("says nothing once the user has it", async () => {
    mockListUserCatalogApps.mockReset().mockResolvedValue([
      { ...base, id: "grafana", name: "Grafana", launchUrl: "https://grafana.example.test", hasAccess: true, requires: [{ id: "vpn", name: "VPN", hasAccess: true }] },
    ]);

    render(await AppsPage());

    expect(screen.queryByText(/Needs VPN/)).not.toBeInTheDocument();
  });

  it("tells someone asking for an app what else it needs", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "user-1", groups: [] }, expires: "" } as never);
    mockListUserCatalogApps.mockReset().mockResolvedValue([
      { ...base, id: "grafana", name: "Grafana", launchUrl: "https://grafana.example.test", hasAccess: false, requires: [{ id: "vpn", name: "VPN", hasAccess: false }] },
    ]);

    render(await AppsPage());

    expect(screen.getByText("Also needs VPN to work.")).toBeInTheDocument();
  });
});

// #19: the note under a card offers to ask for what's missing, and says
// once it's been asked for.
describe("AppsPage: asking for what an app needs", () => {
  const VPN = { id: "vpn", name: "VPN", hasAccess: false, allowedGroups: [{ id: "g-vpn", name: "vpn", friendlyName: "VPN" }] };
  const GRAFANA = {
    id: "grafana",
    name: "Grafana",
    description: "",
    iconUrl: null,
    category: null,
    launchUrl: "https://grafana.example.test",
    hasAccess: true,
    allowedGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering" }],
    requires: [VPN],
  };

  beforeEach(() => {
    mockRequireUser.mockReset().mockResolvedValue({ user: { id: "user-1", groups: ["engineering"] }, expires: "" } as never);
    mockListUserCatalogApps.mockReset().mockResolvedValue([GRAFANA]);
    mockListUserAccessRequests.mockReset().mockResolvedValue([]);
  });

  it("offers to ask for the missing app right there", async () => {
    render(await AppsPage());

    expect(within(usableSection()!).getByRole("button", { name: "Ask for VPN" })).toBeInTheDocument();
  });

  it("says it's been asked for once it has", async () => {
    mockListUserAccessRequests.mockResolvedValue([
      {
        id: "req-vpn",
        requesterSubject: "user-1",
        requesterEmail: null,
        pocketIdClientId: "vpn",
        pocketIdGroupId: "g-vpn",
        pocketIdGroupName: "vpn",
        message: null,
        status: "pending",
        createdAt: new Date(),
        decidedAt: null,
        parentRequestId: null,
      },
    ]);

    render(await AppsPage());

    expect(within(usableSection()!).getByText("You’ve asked for VPN.")).toBeInTheDocument();
    expect(within(usableSection()!).queryByRole("button", { name: "Ask for VPN" })).not.toBeInTheDocument();
  });

  // A required reason can't be given with one click: say who to ask instead.
  it("points to an admin when a reason is required", async () => {
    vi.stubEnv("ACCESS_REQUEST_REASON", "required");
    try {
      render(await AppsPage());

      expect(within(usableSection()!).queryByRole("button", { name: "Ask for VPN" })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
