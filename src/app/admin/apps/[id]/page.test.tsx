import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
vi.mock("../actions", () => ({ setAppHiddenAction: vi.fn(), setAppCategoryAction: vi.fn() }));

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
};

const page = (id = "client-1") =>
  AdminAppPage({ params: Promise.resolve({ id }) } as Parameters<typeof AdminAppPage>[0]);

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

  it("offers what the portal sets: the Shown switch and the category", async () => {
    render(await page());

    expect(screen.getByRole("heading", { level: 1, name: "Immich" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show Immich on the Apps page" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("combobox", { name: "Filed under" })).toHaveValue("Photos");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  // ADR-0007: PocketID owns these, so they are shown, not editable, with
  // a way to the client's own page there.
  it("shows what PocketID owns read-only, linking to the client there", async () => {
    render(await page());

    expect(screen.getByText("Keep your photos")).toBeInTheDocument();
    expect(screen.getByText("https://photos.example.test")).toBeInTheDocument();
    expect(screen.getByText("Family")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change in PocketID" })).toHaveAttribute(
      "href",
      "https://id.example.test/settings/admin/oidc-clients/client-1",
    );
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("explains a missing description and link, and how to write one", async () => {
    mockListApps.mockResolvedValue([{ ...IMMICH, description: "", launchUrl: null }]);

    render(await page());

    expect(screen.getByText(/No description, so people only see the name/)).toBeInTheDocument();
    expect(screen.getByText(/No http\(s\) launch link/)).toBeInTheDocument();
  });
});
