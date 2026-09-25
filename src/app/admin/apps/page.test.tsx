import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminAppsPage, { metadata } from "./page";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listAdminCatalogApps } from "@/lib/catalog/apps";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/catalog/apps", () => ({ listAdminCatalogApps: vi.fn() }));
vi.mock("./actions", () => ({ setAppHiddenAction: vi.fn() }));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockListApps = vi.mocked(listAdminCatalogApps);

describe("AdminAppsPage", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({} as never);
    mockListApps.mockReset();
  });

  it("lists apps with their name, description, and a Hide button when visible", async () => {
    mockListApps.mockResolvedValue([
      {
        id: "client-1",
        name: "Immich",
        description: "Photo library",
        launchUrl: "https://photos.example.test",
        iconUrl: null,
        isGroupRestricted: true,
        allowedGroups: [],
        hidden: false,
      },
    ]);

    render(await AdminAppsPage());

    expect(screen.getByRole("heading", { level: 2, name: "Immich" })).toBeInTheDocument();
    expect(screen.getByText("Photo library")).toBeInTheDocument();
    // SC 4.1.2 / 2.4.4: every row's button reads "Hide" on its own, so the
    // accessible name has to say which app it hides.
    expect(screen.getByRole("button", { name: "Hide Immich" })).toBeInTheDocument();
  });

  it("shows a Show button and no warning for a hidden app with a launch URL", async () => {
    mockListApps.mockResolvedValue([
      {
        id: "client-2",
        name: "Sonarr",
        description: "",
        launchUrl: "https://sonarr.example.test",
        iconUrl: null,
        isGroupRestricted: false,
        allowedGroups: [],
        hidden: true,
      },
    ]);

    render(await AdminAppsPage());

    expect(screen.getByRole("button", { name: "Show Sonarr" })).toBeInTheDocument();
    expect(screen.queryByText(/No http\(s\) launch URL set/)).not.toBeInTheDocument();
  });

  it("warns when a client has no launch URL configured", async () => {
    mockListApps.mockResolvedValue([
      {
        id: "client-3",
        name: "Internal Service",
        description: "",
        launchUrl: null,
        iconUrl: null,
        isGroupRestricted: false,
        allowedGroups: [],
        hidden: false,
      },
    ]);

    render(await AdminAppsPage());

    expect(screen.getByText(/No http\(s\) launch URL set in PocketID/)).toBeInTheDocument();
  });

  // WCAG 2.2 SC 2.4.2 Page Titled.
  it("declares its own page title", () => {
    expect(metadata.title).toBe("App Catalog");
  });

  // SC 2.4.1 Bypass Blocks — target for the header's skip link.
  it("exposes a focusable main landmark for the skip link", async () => {
    mockListApps.mockResolvedValue([]);

    render(await AdminAppsPage());

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});
