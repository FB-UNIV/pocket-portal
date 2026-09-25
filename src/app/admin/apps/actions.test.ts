import { describe, it, expect, vi, beforeEach } from "vitest";
import { setAppHiddenAction } from "./actions";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { setAppHidden } from "@/lib/catalog/apps";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/catalog/apps", () => ({ setAppHidden: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockGetDb = vi.mocked(getDb);
const mockSetAppHidden = vi.mocked(setAppHidden);
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
