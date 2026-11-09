import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AdminAppsPage, { generateMetadata } from "./page";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listAdminCatalogApps, type CatalogApp } from "@/lib/catalog/apps";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/catalog/apps", () => ({ listAdminCatalogApps: vi.fn() }));
vi.mock("./actions", () => ({ setAppHiddenAction: vi.fn(), setAppCategoryAction: vi.fn() }));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockListApps = vi.mocked(listAdminCatalogApps);

function app(overrides: Partial<CatalogApp>): CatalogApp {
  return {
    id: "client-1",
    name: "Immich",
    description: "Keep your photos",
    launchUrl: "https://photos.example.test",
    iconUrl: null,
    category: null,
    isGroupRestricted: true,
    allowedGroups: [],
    hidden: false,
    ...overrides,
  };
}

const page = (show?: string) =>
  AdminAppsPage({ searchParams: Promise.resolve(show ? { show } : {}) });

function row(name: string): HTMLElement {
  return screen.getByRole("link", { name }).closest("tr") as HTMLElement;
}

function listedNames(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("link")[0].textContent ?? "");
}

describe("AdminAppsPage", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({} as never);
    mockListApps.mockReset();
  });

  it("requires admin", async () => {
    mockListApps.mockResolvedValue([]);

    await page();

    expect(mockRequireAdmin).toHaveBeenCalledWith("/admin/apps");
  });

  it("lists each app with its description, linking to its own page", async () => {
    mockListApps.mockResolvedValue([app({})]);

    render(await page());

    expect(screen.getByRole("link", { name: "Immich" })).toHaveAttribute("href", "/admin/apps/client-1");
    expect(screen.getByText("Keep your photos")).toBeInTheDocument();
  });

  // SC 4.1.2: a column of identical switches needs each one's name to say
  // which app it is for, and its state said, not only drawn.
  it("gives each app a Shown switch that says its state", async () => {
    mockListApps.mockResolvedValue([app({}), app({ id: "client-2", name: "Sonarr", hidden: true })]);

    render(await page());

    expect(screen.getByRole("switch", { name: "Show Immich on the Apps page" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Show Sonarr on the Apps page" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("shows the category, or None", async () => {
    mockListApps.mockResolvedValue([
      app({ category: "Photos" }),
      app({ id: "client-2", name: "Gitea", category: null }),
    ]);

    render(await page());

    expect(within(row("Immich")).getByText("Photos")).toBeInTheDocument();
    expect(within(row("Gitea")).getByText("None")).toBeInTheDocument();
  });

  it("names who can use each app by group, or Everyone", async () => {
    mockListApps.mockResolvedValue([
      app({ allowedGroups: [{ id: "g1", name: "family", friendlyName: "Family" }] }),
      app({ id: "client-2", name: "Wiki", isGroupRestricted: false }),
    ]);

    render(await page());

    expect(within(row("Immich")).getByText("Family")).toBeInTheDocument();
    expect(within(row("Wiki")).getByText("Everyone")).toBeInTheDocument();
  });

  it("marks an app Ready, or says what PocketID is missing", async () => {
    mockListApps.mockResolvedValue([
      app({}),
      app({ id: "client-2", name: "Internal", description: "", launchUrl: null }),
    ]);

    render(await page());

    // Each status is rendered twice, as its column and under the name for
    // narrow screens; CSS shows one or the other, never both.
    expect(within(row("Immich")).getAllByText("Ready")).toHaveLength(2);
    expect(within(row("Internal")).getAllByText("No link")).toHaveLength(2);
    // Plus once more as the description line under the name.
    expect(within(row("Internal")).getAllByText("No description")).toHaveLength(3);
  });

  it("counts apps, shown ones, and those needing a fix", async () => {
    mockListApps.mockResolvedValue([
      app({}),
      app({ id: "c2", name: "B", hidden: true }),
      app({ id: "c3", name: "C", launchUrl: null }),
    ]);

    render(await page());

    expect(screen.getByText("3 apps · 2 shown · 1 needs a fix")).toBeInTheDocument();
  });

  it.each([
    ["shown", ["Immich"]],
    ["hidden", ["Sonarr", "Internal"]],
    ["fix", ["Internal"]],
    // Unknown values are user input, not a filter.
    ["nonsense", ["Immich", "Sonarr", "Internal"]],
  ])("filters with ?show=%s", async (show, expected) => {
    mockListApps.mockResolvedValue([
      app({}),
      app({ id: "c2", name: "Sonarr", hidden: true }),
      app({ id: "c3", name: "Internal", launchUrl: null, hidden: true }),
    ]);

    render(await page(show));

    expect(listedNames()).toEqual(expected);
  });

  it("marks the current filter, and says when nothing matches", async () => {
    mockListApps.mockResolvedValue([app({})]);

    render(await page("hidden"));

    const filters = screen.getByRole("navigation", { name: "Filter apps" });
    expect(within(filters).getByRole("link", { name: "Hidden (0)" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(filters).getByRole("link", { name: "All (1)" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("No apps match this filter.")).toBeInTheDocument();
  });

  // WCAG 2.2 SC 2.4.2 Page Titled.
  it("declares its own page title", async () => {
    expect((await generateMetadata()).title).toBe("App catalog");
  });

  // SC 2.4.1 Bypass Blocks — target for the header's skip link.
  it("exposes a focusable main landmark for the skip link", async () => {
    mockListApps.mockResolvedValue([]);

    render(await page());

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});
