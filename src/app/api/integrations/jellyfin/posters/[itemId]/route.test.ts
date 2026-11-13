import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import { auth } from "@/auth";
import { getIntegration } from "@/lib/integrations/store";
import { createJellyfin } from "@/lib/integrations/jellyfin";
import { listUserCatalogApps } from "@/lib/catalog/apps";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/catalog/apps", () => ({ listUserCatalogApps: vi.fn() }));
vi.mock("@/lib/integrations/store", () => ({ getIntegration: vi.fn() }));
vi.mock("@/lib/integrations/jellyfin", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/jellyfin")>()),
  createJellyfin: vi.fn(),
}));

const ID = "1d6a2b8e0c4f4e7a9b3c2d1e0f9a8b7c";
const poster = vi.fn();
const get = (itemId = ID) =>
  GET(new Request(`https://portal.example.test/api/integrations/jellyfin/posters/${itemId}`), {
    params: Promise.resolve({ itemId }),
  } as never);

// #23: Jellyfin's posters, through the portal: only to people who can open
// Jellyfin, only pictures, served inert.
describe("GET /api/integrations/jellyfin/posters/[itemId]", () => {
  beforeEach(() => {
    vi.stubEnv("JELLYFIN_API_KEY", "k3y");
    vi.mocked(auth).mockReset().mockResolvedValue({ user: { id: "u1", groups: ["media"] } } as never);
    vi.mocked(getIntegration).mockReset().mockResolvedValue({ type: "jellyfin", baseUrl: "https://tv.example.test", linkedClientId: "jf", enabled: true });
    vi.mocked(listUserCatalogApps).mockReset().mockResolvedValue([{ id: "jf", hasAccess: true } as never]);
    poster.mockReset().mockResolvedValue({ contentType: "image/jpeg", bytes: Uint8Array.from([1, 2, 3]) });
    vi.mocked(createJellyfin).mockReset().mockReturnValue({ poster } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("relays the poster, inert, cached privately", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(poster).toHaveBeenCalledWith(ID);
  });

  it.each([
    ["nobody is signed in", () => vi.mocked(auth).mockResolvedValue(null as never)],
    ["they can't open Jellyfin", () => vi.mocked(listUserCatalogApps).mockResolvedValue([{ id: "jf", hasAccess: false } as never])],
    ["Jellyfin isn't set up", () => vi.mocked(getIntegration).mockResolvedValue(null)],
    ["Jellyfin sends no picture", () => poster.mockResolvedValue(null)],
  ])("is a 404 when %s", async (_why, arrange) => {
    arrange();

    expect((await get()).status).toBe(404);
  });

  it("never asks Jellyfin for an id that isn't one", async () => {
    expect((await get("..%2FSystem%2FConfiguration")).status).toBe(404);
    expect(poster).not.toHaveBeenCalled();
  });
});
