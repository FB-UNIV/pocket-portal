import { describe, it, expect, vi, beforeEach } from "vitest";
import { setAppCategoryAction, setAppHiddenAction } from "./actions";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { setAppCategory, setAppHidden } from "@/lib/catalog/apps";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/catalog/apps", () => ({ setAppHidden: vi.fn(), setAppCategory: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

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

    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/apps");
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

    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/apps");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/apps");
  });
});
