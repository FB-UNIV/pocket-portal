import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPostAction, deletePostAction, updatePostAction } from "./actions";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { listPocketIdGroups } from "@/lib/pocketid/client";
import { createPost, deletePost, updatePost } from "@/lib/news/store";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})), listPocketIdGroups: vi.fn() }));
vi.mock("@/lib/news/store", () => ({ createPost: vi.fn(), updatePost: vi.fn(), deletePost: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ADMIN = { subject: "admin-1", email: "admin@example.test" };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

// #22: admins post news; every change is theirs, checked and audited.
describe("news actions", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset().mockResolvedValue({ user: { id: "admin-1", email: "admin@example.test" } } as never);
    vi.mocked(getDb).mockReset().mockReturnValue("fake-db" as never);
    vi.mocked(listPocketIdGroups).mockReset().mockResolvedValue([{ id: "g1", name: "engineering", friendlyName: "Engineering" }]);
    vi.mocked(createPost).mockReset().mockResolvedValue("p-new");
    vi.mocked(updatePost).mockReset();
    vi.mocked(deletePost).mockReset();
    vi.mocked(redirect).mockClear();
    vi.mocked(revalidatePath).mockReset();
  });

  it("creates a post as the admin, then opens it", async () => {
    await expect(createPostAction(form({ title: "Hi", body: "Hello", audience: "engineering" }))).rejects.toThrow("NEXT_REDIRECT");

    expect(createPost).toHaveBeenCalledWith(
      "fake-db",
      { title: "Hi", body: "Hello", pinned: false, expiresAt: null, audienceGroups: ["engineering"] },
      ADMIN,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(redirect).toHaveBeenCalledWith("/admin/news/p-new?saved=1");
  });

  it("comes back saying what's wrong, writing nothing", async () => {
    await expect(createPostAction(form({ title: "", body: "Hello" }))).rejects.toThrow("NEXT_REDIRECT");

    expect(createPost).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/admin/news/new?problem=title_required");
  });

  it("refuses an audience group PocketID doesn't have", async () => {
    await expect(createPostAction(form({ title: "Hi", body: "Hello", audience: "made-up" }))).rejects.toThrow("NEXT_REDIRECT");

    expect(createPost).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/admin/news/new?problem=unknown_group");
  });

  it("updates and deletes as the admin", async () => {
    await expect(updatePostAction("p1", form({ title: "Hi", body: "Hello" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(updatePost).toHaveBeenCalledWith("fake-db", "p1", expect.objectContaining({ title: "Hi" }), ADMIN);

    await expect(deletePostAction("p1")).rejects.toThrow("NEXT_REDIRECT");
    expect(deletePost).toHaveBeenCalledWith("fake-db", "p1", ADMIN);
    expect(redirect).toHaveBeenLastCalledWith("/admin/news");
  });

  it("requires admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(deletePostAction("p1")).rejects.toThrow();
    expect(deletePost).not.toHaveBeenCalled();
  });
});
