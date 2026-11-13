import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MediaWidget } from "./media";
import { getIntegration } from "@/lib/integrations/store";
import { createJellyfin } from "@/lib/integrations/jellyfin";
import { listUserCatalogApps } from "@/lib/catalog/apps";

vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/catalog/apps", () => ({ listUserCatalogApps: vi.fn() }));
vi.mock("@/lib/integrations/store", () => ({ getIntegration: vi.fn() }));
vi.mock("@/lib/integrations/jellyfin", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/jellyfin")>()),
  createJellyfin: vi.fn(),
}));
vi.mock("@/lib/observability/logger", () => ({ logger: { error: vi.fn() } }));

const JELLYFIN_APP = {
  id: "jf",
  name: "Jellyfin",
  description: "Watch films and series",
  launchUrl: "https://tv.example.test",
  iconUrl: null,
  category: null,
  hasAccess: true,
  allowedGroups: [],
  requires: [],
};
const ITEM = { id: "1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c", title: "Dune", subtitle: "2021", hasPoster: true, serverId: "abc" };
const client = {
  recentlyAdded: vi.fn(),
  itemUrl: vi.fn((item: { id: string }) => `https://tv.example.test/web/#/details?id=${item.id}&serverId=abc`),
};

// #23: "New on Jellyfin" on the dashboard, for people who can open it.
describe("MediaWidget (dashboard section)", () => {
  beforeEach(() => {
    vi.stubEnv("JELLYFIN_API_KEY", "k3y");
    vi.mocked(getIntegration).mockReset().mockResolvedValue({
      type: "jellyfin",
      baseUrl: "https://tv.example.test",
      linkedClientId: "jf",
      enabled: true,
    });
    vi.mocked(listUserCatalogApps).mockReset().mockResolvedValue([JELLYFIN_APP]);
    client.recentlyAdded.mockReset().mockResolvedValue([ITEM]);
    vi.mocked(createJellyfin).mockReset().mockReturnValue(client as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("shows what's new, each linking into Jellyfin, posters through the portal", async () => {
    render((await MediaWidget({ userGroups: ["media"] }))!);

    const region = screen.getByRole("region", { name: "New on Jellyfin" });
    const link = within(region).getByRole("link", { name: /Dune/ });
    expect(link).toHaveAttribute("href", `https://tv.example.test/web/#/details?id=${ITEM.id}&serverId=abc`);
    expect(within(link).getByRole("img", { hidden: true })).toHaveAttribute("src", `/api/integrations/jellyfin/posters/${ITEM.id}`);
  });

  it.each([
    ["the person can't open Jellyfin", () => vi.mocked(listUserCatalogApps).mockResolvedValue([{ ...JELLYFIN_APP, hasAccess: false }])],
    ["it isn't set up", () => vi.mocked(getIntegration).mockResolvedValue(null)],
    ["it's switched off", () => vi.mocked(getIntegration).mockResolvedValue({ type: "jellyfin", baseUrl: "https://tv.example.test", linkedClientId: "jf", enabled: false })],
    ["there's no API key", () => vi.stubEnv("JELLYFIN_API_KEY", "")],
  ])("shows nothing when %s", async (_why, arrange) => {
    arrange();

    expect(await MediaWidget({ userGroups: [] })).toBeNull();
    expect(client.recentlyAdded).not.toHaveBeenCalled();
  });

  // A slow or down integration costs its card, not the dashboard.
  it("says Jellyfin isn't answering when it can't be reached", async () => {
    client.recentlyAdded.mockImplementation(async () => {
      throw new Error("timeout");
    });

    render((await MediaWidget({ userGroups: ["media"] }))!);

    expect(within(screen.getByRole("region", { name: "New on Jellyfin" })).getByText("Jellyfin isn’t answering right now.")).toBeInTheDocument();
  });
});
