import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// The list's rows, by the app's PocketID name (shown under what it's for).
function rows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Apps" })).getAllByRole("listitem", {
    // Only the rows themselves, not the "who can use it" chips inside them.
    name: (_, el) => el.parentElement?.getAttribute("aria-label") === "Apps",
  });
}

function row(name: string): HTMLElement {
  const found = rows().find((r) => within(r).queryByText(new RegExp(`^${name} · `)));
  if (!found) throw new Error(`no row for ${name}`);
  return found;
}

function listedNames(): string[] {
  return rows().map((r) => within(r).getByText(/ · /).textContent!.split(" · ")[0]);
}

describe("AdminAppsPage", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({} as never);
    mockListApps.mockReset();
    vi.stubEnv("POCKETID_BASE_URL", "https://id.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires admin", async () => {
    mockListApps.mockResolvedValue([]);

    await page();

    expect(mockRequireAdmin).toHaveBeenCalledWith("/admin/apps");
  });

  // Admin redesign: like the Apps page, each row leads with what the app is for.
  it("leads each app with what it's for, linking to its own page", async () => {
    mockListApps.mockResolvedValue([app({ category: "Photos" })]);

    render(await page());

    const link = within(row("Immich")).getByRole("link", { name: /^Keep your photos/ });
    expect(link).toHaveAttribute("href", "/admin/apps/client-1");
    expect(link).toHaveTextContent("Immich · Photos");
  });

  it("falls back to the name, and files an app without a category under Other", async () => {
    mockListApps.mockResolvedValue([app({ description: "" })]);

    render(await page());

    expect(within(row("Immich")).getByRole("link", { name: /^Immich/ })).toHaveTextContent(
      "ImmichImmich · Other",
    );
  });

  // SC 4.1.2: a column of identical switches needs each one's name to say
  // which app it is for, and its state said, not only drawn.
  it("gives each app a switch, and says in words where it stands", async () => {
    mockListApps.mockResolvedValue([
      app({}),
      app({ id: "client-2", name: "Sonarr", hidden: true }),
      app({ id: "client-3", name: "Internal", launchUrl: null }),
    ]);

    render(await page());

    expect(screen.getByRole("switch", { name: "Show Immich on the Apps page" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Show Sonarr on the Apps page" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(within(row("Immich")).getByText("On the Apps page")).toBeInTheDocument();
    expect(within(row("Sonarr")).getByText("Hidden")).toBeInTheDocument();
    expect(within(row("Internal")).getByText("On, but has no link yet")).toBeInTheDocument();
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

  // What's broken comes first, in words, with a way to fix it.
  it("lists the apps that need something from PocketID, above the rest", async () => {
    mockListApps.mockResolvedValue([
      app({}),
      app({ id: "c2", name: "Kids", description: "", launchUrl: null }),
      app({ id: "c3", name: "Grafana", description: "" }),
      app({ id: "c4", name: "Wiki", launchUrl: null }),
    ]);

    render(await page());

    const fix = screen.getByRole("region", { name: "3 apps need something from PocketID" });
    expect(fix).toHaveTextContent("Kids has no link to open it and doesn’t say what it’s for.");
    expect(fix).toHaveTextContent("Grafana doesn’t say what it’s for, so people only see its name.");
    expect(fix).toHaveTextContent("Wiki has no link to open it, so it can’t be on the Apps page.");
    expect(within(fix).getByRole("link", { name: "Fix Kids in PocketID" })).toHaveAttribute(
      "href",
      "https://id.example.test/settings/admin/oidc-clients/c2",
    );
    expect(fix.compareDocumentPosition(screen.getByRole("list", { name: "Apps" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("says nothing needs fixing when nothing does", async () => {
    mockListApps.mockResolvedValue([app({})]);

    render(await page());

    expect(screen.queryByRole("region", { name: /need/ })).not.toBeInTheDocument();
  });

  it("counts the apps people actually see on the Apps page", async () => {
    mockListApps.mockResolvedValue([
      app({}),
      app({ id: "c2", name: "B", hidden: true }),
      app({ id: "c3", name: "C", launchUrl: null }),
    ]);

    render(await page());

    expect(screen.getByText("On the Apps page: 1 of 3")).toBeInTheDocument();
  });

  it.each([
    ["shown", ["Immich"]],
    ["hidden", ["Sonarr", "Internal"]],
    // Unknown values are user input, not a filter; "fix" was one once.
    ["fix", ["Immich", "Sonarr", "Internal"]],
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
    expect(within(filters).getByRole("link", { name: "Hidden" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(filters).getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("No apps match this filter.")).toBeInTheDocument();
  });

  it("heads the page Apps, as its tab does", async () => {
    mockListApps.mockResolvedValue([]);

    render(await page());

    expect(screen.getByRole("heading", { level: 1, name: "Apps" })).toBeInTheDocument();
  });

  // WCAG 2.2 SC 2.4.2 Page Titled: distinct from the public Apps page's.
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
