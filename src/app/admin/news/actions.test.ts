import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createPostAction,
  deleteImageAction,
  deletePostAction,
  setCoverAction,
  updatePostAction,
  uploadImageAction,
} from "./actions";
import { addImage, deleteImage, setCover } from "@/lib/news/image-store";
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
vi.mock("@/lib/news/image-store", () => ({ addImage: vi.fn(), deleteImage: vi.fn(), setCover: vi.fn() }));
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

// #22: pictures, checked on the server whatever the browser said.
describe("picture actions", () => {
  const POST = "0b1f6a2e-1c1e-4b0a-9d3c-2f6e8c9a1b2c";
  const upload = (contents: Uint8Array, name = "photo.png", type = "image/png") => {
    const data = new FormData();
    data.set("picture", new File([contents as BlobPart], name, { type }));
    return data;
  };
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset().mockResolvedValue({ user: { id: "admin-1", email: "admin@example.test" } } as never);
    vi.mocked(getDb).mockReset().mockReturnValue("fake-db" as never);
    vi.mocked(addImage).mockReset().mockResolvedValue("img-1");
    vi.mocked(deleteImage).mockReset();
    vi.mocked(setCover).mockReset();
    vi.mocked(redirect).mockClear();
  });

  it("stores a picture with the type its bytes say", async () => {
    await expect(uploadImageAction(POST, upload(PNG, "holiday.jpg", "image/jpeg"))).rejects.toThrow("NEXT_REDIRECT");

    expect(addImage).toHaveBeenCalledWith("fake-db", POST, "image/png", expect.any(Uint8Array));
    expect(redirect).toHaveBeenCalledWith(`/admin/news/${POST}?picture=added`);
  });

  it.each([
    ["an SVG, whatever its name", upload(new TextEncoder().encode("<svg onload=alert(1)>"), "x.png"), "not_an_image"],
    ["nothing", new FormData(), "no_picture"],
  ])("refuses %s", async (_why, form, reason) => {
    await expect(uploadImageAction(POST, form)).rejects.toThrow("NEXT_REDIRECT");

    expect(addImage).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(`/admin/news/${POST}?problem=${reason}`);
  });

  it("sets and clears the cover, and deletes a picture, as an admin", async () => {
    await setCoverAction(POST, "img-1");
    await setCoverAction(POST, null);
    await deleteImageAction(POST, "img-1");

    expect(vi.mocked(setCover).mock.calls).toEqual([
      ["fake-db", POST, "img-1"],
      ["fake-db", POST, null],
    ]);
    expect(deleteImage).toHaveBeenCalledWith("fake-db", POST, "img-1");
    expect(requireAdmin).toHaveBeenCalledTimes(3);
  });
});
