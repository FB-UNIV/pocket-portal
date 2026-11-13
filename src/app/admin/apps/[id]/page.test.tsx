import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { notFound } from "next/navigation";
import AdminAppPage from "./page";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listAdminCatalogApps, type CatalogApp } from "@/lib/catalog/apps";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/catalog/apps", () => ({ listAdminCatalogApps: vi.fn() }));
vi.mock("../actions", () => ({
  setAppHiddenAction: vi.fn(),
  setAppCategoryAction: vi.fn(),
  addAppDependencyAction: vi.fn(),
  removeAppDependencyAction: vi.fn(),
}));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockListApps = vi.mocked(listAdminCatalogApps);

const IMMICH: CatalogApp = {
  id: "client-1",
  name: "Immich",
  description: "Keep your photos",
  launchUrl: "https://photos.example.test",
  iconUrl: null,
  category: "Photos",
  isGroupRestricted: true,
  allowedGroups: [{ id: "g1", name: "family", friendlyName: "Family" }],
  hidden: false,
  requires: [],
};

const page = (id = "client-1", searchParams: Record<string, string> = {}) =>
  AdminAppPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(searchParams),
  } as Parameters<typeof AdminAppPage>[0]);

describe("AdminAppPage", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({} as never);
    mockListApps.mockReset().mockResolvedValue([IMMICH]);
    vi.stubEnv("POCKETID_BASE_URL", "https://id.example.test/");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires admin, returning to this app's page", async () => {
    await page();

    expect(mockRequireAdmin).toHaveBeenCalledWith("/admin/apps/client-1");
  });

  it("is a 404 for an app PocketID doesn't list", async () => {
    await expect(page("gone")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  // Admin redesign: what the portal sets, said in words.
  it("offers what the portal sets: the switch, saying where the app stands, and its heading", async () => {
    render(await page());

    expect(screen.getByRole("heading", { level: 1, name: "Immich" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show Immich on the Apps page" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("Shown. Everyone signed in sees it, and can ask for it.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Heading it sits under" })).toHaveValue("Photos");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it.each([
    [{ hidden: true }, "Hidden. Nobody sees it, and nobody can ask for it."],
    [{ launchUrl: null }, "On, but it has no link yet, so it isn’t shown."],
  ])("says where an app stands when it isn't shown (%o)", async (overrides, text) => {
    mockListApps.mockResolvedValue([{ ...IMMICH, ...overrides }]);

    render(await page());

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  // One click files the app under a heading already in use, so "Files"
  // doesn't become "files" on the next app. Each is a plain form: no JS.
  it("files the app under a heading already in use in one click", async () => {
    mockListApps.mockResolvedValue([
      IMMICH,
      { ...IMMICH, id: "client-2", name: "Jellyfin", category: "Watch & listen" },
    ]);

    render(await page());

    const picks = screen.getByRole("group", { name: "Headings already in use" });
    const current = within(picks).getByRole("button", { name: "Photos" });
    const other = within(picks).getByRole("button", { name: "Watch & listen" });
    expect(current).toHaveAttribute("aria-pressed", "true");
    expect(other).toHaveAttribute("aria-pressed", "false");
    expect(other.closest("form")?.querySelector('input[name="category"]')).toHaveValue("Watch & listen");
  });

  it("previews the card people see on the Apps page, and under which heading", async () => {
    render(await page());

    const preview = screen.getByRole("complementary", { name: "What people see" });
    expect(preview).toHaveTextContent("Keep your photos");
    expect(preview).toHaveTextContent("Immich");
    expect(preview).toHaveTextContent("Under “Photos” on the Apps page.");
  });

  it("says the card isn't on the Apps page while it's hidden", async () => {
    mockListApps.mockResolvedValue([{ ...IMMICH, hidden: true, category: null }]);

    render(await page());

    expect(screen.getByRole("complementary", { name: "What people see" })).toHaveTextContent(
      "Not on the Apps page right now.",
    );
  });

  // ADR-0007: PocketID owns these, so they are shown, not editable, with
  // a way to the client's own page there.
  it("lists what PocketID owns read-only, linking to the client there", async () => {
    render(await page());

    const pocketId = screen.getByRole("region", { name: "Set in PocketID" });
    expect(pocketId).toHaveTextContent("What it’s for“Keep your photos”");
    expect(pocketId).toHaveTextContent("Where it openshttps://photos.example.test");
    expect(within(pocketId).getByText("Family")).toBeInTheDocument();
    expect(within(pocketId).getByRole("link", { name: "Open in PocketID" })).toHaveAttribute(
      "href",
      "https://id.example.test/settings/admin/oidc-clients/client-1",
    );
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("says what's missing in PocketID, and how to write it", async () => {
    mockListApps.mockResolvedValue([{ ...IMMICH, description: "", launchUrl: null }]);

    render(await page());

    expect(screen.getByText(/^Missing\. Add a description in PocketID that says what it’s for/)).toBeInTheDocument();
    expect(screen.getByText(/^Missing\. Add a launch link \(http or https\)/)).toBeInTheDocument();
  });
});

// ADR-0012: an app can need other apps (Grafana needs the VPN), one level
// deep. Edited here, next to the app's other settings.
describe("AdminAppPage: apps it needs", () => {
  const VPN: CatalogApp = { ...IMMICH, id: "vpn", name: "VPN", description: "", launchUrl: null, hidden: true };
  const GRAFANA: CatalogApp = { ...IMMICH, id: "grafana", name: "Grafana", requires: [{ id: "vpn", name: "VPN" }] };
  const WIKI: CatalogApp = { ...IMMICH, id: "wiki", name: "Wiki" };
  const needs = () => screen.getByRole("region", { name: "Needs another app" });

  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({} as never);
    vi.stubEnv("POCKETID_BASE_URL", "https://id.example.test/");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("lists what the app needs, each with a way to remove it", async () => {
    mockListApps.mockReset().mockResolvedValue([GRAFANA, VPN, WIKI]);

    render(await page("grafana"));

    expect(within(needs()).getByText("VPN")).toBeInTheDocument();
    expect(within(needs()).getByRole("button", { name: "Remove VPN" })).toBeInTheDocument();
  });

  // Hidden and link-less apps count: a VPN usually has neither a page nor
  // a reason to be listed. Itself, what it already needs, and apps that
  // need another app (no chains) aren't offered.
  it("offers only the apps it could need", async () => {
    const DASHBOARDS: CatalogApp = { ...IMMICH, id: "dash", name: "Dashboards", requires: [{ id: "wiki", name: "Wiki" }] };
    mockListApps.mockReset().mockResolvedValue([GRAFANA, VPN, WIKI, DASHBOARDS]);

    render(await page("grafana"));

    const select = within(needs()).getByRole("combobox", { name: "Add an app it needs" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Wiki"]);
    expect(within(needs()).getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("says when it needs nothing else", async () => {
    mockListApps.mockReset().mockResolvedValue([WIKI, VPN]);

    render(await page("wiki"));

    expect(within(needs()).getByText("Nothing else. It works on its own.")).toBeInTheDocument();
  });

  it("explains that an app other apps need can't need one itself", async () => {
    mockListApps.mockReset().mockResolvedValue([GRAFANA, VPN, WIKI]);

    render(await page("vpn"));

    expect(within(needs()).getByText("Grafana needs this app, so it can’t need another one itself.")).toBeInTheDocument();
    expect(within(needs()).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("says why a link was refused", async () => {
    mockListApps.mockReset().mockResolvedValue([WIKI, VPN]);

    render(await page("wiki", { refused: "prerequisite_needs_another" }));

    expect(within(needs()).getByRole("alert")).toHaveTextContent(
      "That app needs another one itself, so it can’t be needed here.",
    );
  });

  it("ignores a refusal reason it doesn't know", async () => {
    mockListApps.mockReset().mockResolvedValue([WIKI, VPN]);

    render(await page("wiki", { refused: "<script>" }));

    expect(within(needs()).queryByRole("alert")).not.toBeInTheDocument();
  });
});
