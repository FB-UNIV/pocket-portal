import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saveJellyfinAction, testJellyfinAction } from "./actions";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { getIntegration, saveIntegration } from "@/lib/integrations/store";
import { createJellyfin } from "@/lib/integrations/jellyfin";
import { redirect } from "next/navigation";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/catalog/apps", () => ({ listAdminCatalogApps: vi.fn() }));
vi.mock("@/lib/integrations/store", () => ({ getIntegration: vi.fn(), saveIntegration: vi.fn() }));
vi.mock("@/lib/integrations/jellyfin", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/jellyfin")>()),
  createJellyfin: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

// #23: admins point the portal at Jellyfin; the key stays in the
// environment, never in a form or the database.
describe("integration actions", () => {
  beforeEach(() => {
    vi.stubEnv("JELLYFIN_API_KEY", "k3y");
    vi.mocked(requireAdmin).mockReset().mockResolvedValue({ user: { id: "admin-1", email: "admin@example.test" } } as never);
    vi.mocked(getDb).mockReset().mockReturnValue("fake-db" as never);
    vi.mocked(listAdminCatalogApps).mockReset().mockResolvedValue([{ id: "jf", name: "Jellyfin" } as never]);
    vi.mocked(saveIntegration).mockReset();
    vi.mocked(getIntegration).mockReset().mockResolvedValue({ type: "jellyfin", baseUrl: "https://tv.example.test", linkedClientId: "jf", enabled: true });
    vi.mocked(redirect).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("saves Jellyfin's address, linked app and switch, as the admin", async () => {
    await expect(
      saveJellyfinAction(form({ baseUrl: " https://tv.example.test/ ", linkedClientId: "jf", enabled: "on" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(saveIntegration).toHaveBeenCalledWith(
      "fake-db",
      { type: "jellyfin", baseUrl: "https://tv.example.test", linkedClientId: "jf", enabled: true },
      { subject: "admin-1", email: "admin@example.test" },
    );
    expect(redirect).toHaveBeenCalledWith("/admin/integrations?saved=jellyfin");
  });

  it.each([
    ["a non-web address", { baseUrl: "file:///etc/passwd", linkedClientId: "jf" }, "bad_url"],
    ["an address with credentials in it", { baseUrl: "https://user:pass@tv.example.test", linkedClientId: "jf" }, "bad_url"],
    ["no address", { baseUrl: "", linkedClientId: "jf" }, "bad_url"],
    ["an app PocketID doesn't have", { baseUrl: "https://tv.example.test", linkedClientId: "made-up" }, "unknown_app"],
  ])("refuses %s, saving nothing", async (_why, fields, problem) => {
    await expect(saveJellyfinAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");

    expect(saveIntegration).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(`/admin/integrations?problem=${problem}`);
  });

  it("tests the saved connection and says how it went", async () => {
    vi.mocked(createJellyfin).mockReturnValue({ testConnection: async () => ({ ok: true, detail: "Home 10.10.7" }) } as never);

    await expect(testJellyfinAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/admin/integrations?test=ok&detail=Home%2010.10.7");
  });

  it("says when there's no key to test with", async () => {
    vi.stubEnv("JELLYFIN_API_KEY", "");

    await expect(testJellyfinAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/admin/integrations?test=fail&detail=no_key");
  });
});
