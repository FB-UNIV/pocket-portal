import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  addAppDependencyAction,
  removeAppDependencyAction,
  setAppCategoryAction,
  setAppHiddenAction,
} from "./actions";
import { addDependency, removeDependency } from "@/lib/catalog/dependencies";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { listAdminCatalogApps, setAppCategory, setAppHidden } from "@/lib/catalog/apps";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/catalog/apps", () => ({ setAppHidden: vi.fn(), setAppCategory: vi.fn(), listAdminCatalogApps: vi.fn() }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/catalog/dependencies", () => ({ addDependency: vi.fn(), removeDependency: vi.fn() }));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockGetDb = vi.mocked(getDb);
const mockSetAppHidden = vi.mocked(setAppHidden);
const mockSetAppCategory = vi.mocked(setAppCategory);
const mockRevalidatePath = vi.mocked(revalidatePath);

describe("setAppHiddenAction", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({} as never);
    mockGetDb.mockReset().mockReturnValue("fake-db" as never);
    mockSetAppHidden.mockReset();
    mockRevalidatePath.mockReset();
  });

  it("requires admin before persisting the override", async () => {
    await setAppHiddenAction("client-1", true);

    expect(mockRequireAdmin).toHaveBeenCalled();
    expect(mockSetAppHidden).toHaveBeenCalledWith("fake-db", "client-1", true);
  });

  it("revalidates the admin apps page after updating", async () => {
    await setAppHiddenAction("client-1", false);

    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/apps", "layout");
  });
});

describe("setAppCategoryAction", () => {
  const form = (category?: string) => {
    const data = new FormData();
    if (category !== undefined) data.set("category", category);
    return data;
  };

  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({} as never);
    mockGetDb.mockReset().mockReturnValue("fake-db" as never);
    mockSetAppCategory.mockReset();
    mockRevalidatePath.mockReset();
  });

  it("requires admin, then stores the normalised category", async () => {
    await setAppCategoryAction("client-1", form("  Watch   & listen "));

    expect(mockRequireAdmin).toHaveBeenCalled();
    expect(mockSetAppCategory).toHaveBeenCalledWith("fake-db", "client-1", "Watch & listen");
  });

  it("clears the category when the field is blank or missing", async () => {
    await setAppCategoryAction("client-1", form("   "));
    await setAppCategoryAction("client-1", form());

    expect(mockSetAppCategory).toHaveBeenNthCalledWith(1, "fake-db", "client-1", null);
    expect(mockSetAppCategory).toHaveBeenNthCalledWith(2, "fake-db", "client-1", null);
  });

  it("stores nothing when the caller isn't an admin", async () => {
    mockRequireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(setAppCategoryAction("client-1", form("Files"))).rejects.toThrow();
    expect(mockSetAppCategory).not.toHaveBeenCalled();
  });

  // Both pages show categories: the admin list and the user-facing chips.
  it("revalidates the admin list and the apps page", async () => {
    await setAppCategoryAction("client-1", form("Files"));

    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/apps", "layout");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/apps");
  });
});

// ADR-0012: links between apps, as the admin who made them (audited).
describe("addAppDependencyAction / removeAppDependencyAction", () => {
  const form = (requires?: string) => {
    const data = new FormData();
    if (requires !== undefined) data.set("requires", requires);
    return data;
  };

  beforeEach(() => {
    mockRequireAdmin.mockReset().mockResolvedValue({ user: { id: "admin-1", email: "admin@example.test" } } as never);
    mockGetDb.mockReset().mockReturnValue("fake-db" as never);
    vi.mocked(addDependency).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(removeDependency).mockReset();
    vi.mocked(redirect).mockReset().mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    vi.mocked(listAdminCatalogApps).mockReset().mockResolvedValue([
      { id: "grafana", name: "Grafana" },
      { id: "vpn", name: "VPN" },
      { id: "wifi", name: "Wifi" },
    ] as never);
    mockRevalidatePath.mockReset();
  });

  it("links the app to the one it needs, as the admin, naming both, and refreshes both pages", async () => {
    await addAppDependencyAction("grafana", form("vpn"));

    expect(addDependency).toHaveBeenCalledWith(
      "fake-db",
      "grafana",
      "vpn",
      { subject: "admin-1", email: "admin@example.test" },
      { appName: "Grafana", requiresName: "VPN" },
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/apps", "layout");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/apps");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("comes back to the app's page saying why, when the link is refused", async () => {
    vi.mocked(addDependency).mockResolvedValue({ ok: false, reason: "app_is_a_prerequisite" });

    await expect(addAppDependencyAction("vpn", form("wifi"))).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/admin/apps/vpn?refused=app_is_a_prerequisite");
  });

  // A form is user input: only PocketID's own clients can be linked.
  it("refuses an app PocketID doesn't have, writing nothing", async () => {
    await expect(addAppDependencyAction("grafana", form("made-up"))).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/admin/apps/grafana?refused=unknown_app");
    expect(addDependency).not.toHaveBeenCalled();
  });

  it("does nothing without an app to link to", async () => {
    await addAppDependencyAction("grafana", form());
    await addAppDependencyAction("grafana", form(""));

    expect(addDependency).not.toHaveBeenCalled();
  });

  it("removes a link, as the admin", async () => {
    await removeAppDependencyAction("grafana", "vpn");

    expect(mockRequireAdmin).toHaveBeenCalled();
    expect(removeDependency).toHaveBeenCalledWith(
      "fake-db",
      "grafana",
      "vpn",
      { subject: "admin-1", email: "admin@example.test" },
      { appName: "Grafana", requiresName: "VPN" },
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/apps");
  });
});
