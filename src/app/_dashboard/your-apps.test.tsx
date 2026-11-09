import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { YourApps, YourAppsLoading } from "./your-apps";
import { listUserCatalogApps, type UserCatalogApp } from "@/lib/catalog/apps";
import { readAccessRequestsEnabled } from "@/lib/config";
import { logger } from "@/lib/observability/logger";

vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/catalog/apps", () => ({ listUserCatalogApps: vi.fn() }));
vi.mock("@/lib/config", () => ({ readAccessRequestsEnabled: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ logger: { error: vi.fn() } }));

const mockList = vi.mocked(listUserCatalogApps);
const mockRequestsEnabled = vi.mocked(readAccessRequestsEnabled);

const app = (overrides: Partial<UserCatalogApp> = {}): UserCatalogApp => ({
  id: "client-1",
  name: "Immich",
  description: "Your photos and videos",
  launchUrl: "https://photos.example.test",
  iconUrl: null,
  hasAccess: true,
  allowedGroups: [],
  category: null,
  ...overrides,
});

describe("YourApps (dashboard section)", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockRequestsEnabled.mockReset().mockReturnValue(true);
    vi.mocked(logger.error).mockReset();
  });

  it("loads the catalog for the signed-in user's groups", async () => {
    mockList.mockResolvedValue([]);

    await YourApps({ userGroups: ["media"] });

    expect(mockList).toHaveBeenCalledWith({}, {}, ["media"]);
  });

  it("is a labelled region headed 'Your apps'", async () => {
    mockList.mockResolvedValue([app()]);

    render(await YourApps({ userGroups: [] }));

    expect(screen.getByRole("region", { name: "Your apps" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your apps" })).toBeInTheDocument();
  });

  it("launches each app the user can open, by name and purpose", async () => {
    mockList.mockResolvedValue([
      app(),
      app({ id: "client-2", name: "Jellyfin", description: "", launchUrl: "https://tv.example.test" }),
    ]);

    render(await YourApps({ userGroups: [] }));

    const open = screen.getByRole("link", { name: "Open Immich" });
    expect(open).toHaveAttribute("href", "https://photos.example.test");
    expect(within(open).getByText("Your photos and videos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Jellyfin" })).toHaveAttribute(
      "href",
      "https://tv.example.test",
    );
  });

  it("leaves out apps the user can only ask for", async () => {
    mockList.mockResolvedValue([app(), app({ id: "client-2", name: "Grafana", hasAccess: false })]);

    render(await YourApps({ userGroups: [] }));

    expect(screen.queryByText("Grafana")).not.toBeInTheDocument();
  });

  it("links on to the full Apps page, where more can be asked for", async () => {
    mockList.mockResolvedValue([app()]);

    render(await YourApps({ userGroups: [] }));

    expect(screen.getByRole("link", { name: "See all apps, or ask for more" })).toHaveAttribute(
      "href",
      "/apps",
    );
  });

  it("doesn't mention asking when access requests are turned off", async () => {
    mockRequestsEnabled.mockReturnValue(false);
    mockList.mockResolvedValue([app()]);

    render(await YourApps({ userGroups: [] }));

    expect(screen.getByRole("link", { name: "See all apps" })).toHaveAttribute("href", "/apps");
    expect(screen.queryByText(/ask for/i)).not.toBeInTheDocument();
  });

  it("points someone with no apps yet to where they can ask", async () => {
    mockList.mockResolvedValue([app({ hasAccess: false })]);

    render(await YourApps({ userGroups: [] }));

    expect(screen.getByText(/You don’t have any apps yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask for an app" })).toHaveAttribute("href", "/apps");
    expect(screen.queryByRole("link", { name: /^Open / })).not.toBeInTheDocument();
  });

  it("says to ask an administrator when there are no apps and requests are off", async () => {
    mockRequestsEnabled.mockReturnValue(false);
    mockList.mockResolvedValue([]);

    render(await YourApps({ userGroups: [] }));

    expect(screen.getByText(/Ask an administrator/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ask for an app" })).not.toBeInTheDocument();
  });

  // #20: one section failing (e.g. PocketID slow or down) shows an error
  // card for that section, not the error page for the whole dashboard.
  it("shows an error card in place of the section when the catalog fails to load", async () => {
    const error = new Error("PocketID timed out");
    mockList.mockRejectedValue(error);

    render(await YourApps({ userGroups: [] }));

    const region = screen.getByRole("region", { name: "Your apps" });
    expect(within(region).getByText(/couldn’t load your apps/i)).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/");
    expect(logger.error).toHaveBeenCalledWith(
      { err: error },
      expect.stringContaining("Dashboard"),
    );
  });

  it("has a loading state that keeps the section's heading and says what's coming", () => {
    render(<YourAppsLoading />);

    const region = screen.getByRole("region", { name: "Your apps" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(within(region).getByText("Loading your apps…")).toBeInTheDocument();
  });
});
