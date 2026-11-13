import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { auth } from "@/auth";
import { getImage } from "@/lib/news/image-store";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/news/image-store", () => ({ getImage: vi.fn() }));

const ID = "0b1f6a2e-1c1e-4b0a-9d3c-2f6e8c9a1b2c";
const POST = {
  publishedAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: null,
  audienceGroups: ["engineering"],
};
const get = (id = ID) => GET(new Request(`https://portal.example.test/api/news/images/${id}`), {
  params: Promise.resolve({ id }),
} as never);

// #22: a post's pictures, to the people who may read the post. Served as
// stored (type sniffed, metadata stripped at upload), never sniffed by the
// browser, never run.
describe("GET /api/news/images/[id]", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset().mockResolvedValue({ user: { id: "u1", groups: ["engineering"], isAdmin: false } } as never);
    vi.mocked(getImage).mockReset().mockResolvedValue({
      contentType: "image/png",
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      post: POST,
    });
  });

  it("serves the picture, inert and cacheable for its viewer", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    // Behind sign-in: a browser may keep it, a shared cache may not.
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("is a 404 for someone who isn't signed in", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    expect((await get()).status).toBe(404);
  });

  // Not shown to this person, so neither are its pictures.
  it("is a 404 when the post isn't for this person", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u2", groups: ["media"], isAdmin: false } } as never);

    expect((await get()).status).toBe(404);
  });

  it("serves admins every post's pictures, for the editor", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "a1", groups: [], isAdmin: true } } as never);

    expect((await get()).status).toBe(200);
  });

  it("is a 404 for a picture that isn't there, or an id that isn't one", async () => {
    vi.mocked(getImage).mockResolvedValue(null);
    expect((await get()).status).toBe(404);

    expect((await get("../etc/passwd")).status).toBe(404);
    expect(getImage).toHaveBeenCalledTimes(1);
  });
});
