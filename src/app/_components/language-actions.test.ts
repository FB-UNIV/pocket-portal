import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { readAuthUrl } from "@/lib/config";
import { saveLocale } from "@/lib/preferences/locale";
import { setLanguageAction } from "./language-actions";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/config", () => ({ readAuthUrl: vi.fn() }));
vi.mock("@/lib/preferences/locale", () => ({ saveLocale: vi.fn() }));

const mockAuth = auth as unknown as Mock;
const setCookie = vi.fn();

const form = (locale: string) => {
  const data = new FormData();
  data.set("locale", locale);
  return data;
};

describe("setLanguageAction", () => {
  beforeEach(() => {
    setCookie.mockReset();
    vi.mocked(cookies).mockResolvedValue({ set: setCookie } as never);
    vi.mocked(revalidatePath).mockReset();
    vi.mocked(saveLocale).mockReset();
    vi.mocked(readAuthUrl).mockReset().mockReturnValue("https://portal.example.test");
    mockAuth.mockReset().mockResolvedValue(null);
  });

  it("saves a signed-in person's choice, so it follows them to other devices", async () => {
    mockAuth.mockResolvedValue({ user: { id: "subject-1" } });

    await setLanguageAction(form("fr"));

    expect(saveLocale).toHaveBeenCalledWith({}, "subject-1", "fr");
  });

  it("remembers the choice in a long-lived, server-only cookie", async () => {
    await setLanguageAction(form("fr"));

    expect(setCookie).toHaveBeenCalledWith(
      "portal-locale",
      "fr",
      expect.objectContaining({ path: "/", httpOnly: true, sameSite: "lax", secure: true }),
    );
    expect(setCookie.mock.calls[0][2].maxAge).toBeGreaterThanOrEqual(60 * 60 * 24 * 365);
  });

  it("keeps a signed-out visitor's choice in the cookie only", async () => {
    await setLanguageAction(form("fr"));

    expect(setCookie).toHaveBeenCalled();
    expect(saveLocale).not.toHaveBeenCalled();
  });

  it("doesn't mark the cookie Secure when the portal isn't served over https", async () => {
    vi.mocked(readAuthUrl).mockReturnValue("http://localhost:3000");

    await setLanguageAction(form("en"));

    expect(setCookie.mock.calls[0][2].secure).toBe(false);
  });

  it("re-renders every page in the new language", async () => {
    await setLanguageAction(form("fr"));

    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("ignores a language the portal doesn't speak", async () => {
    mockAuth.mockResolvedValue({ user: { id: "subject-1" } });

    await setLanguageAction(form("de"));

    expect(setCookie).not.toHaveBeenCalled();
    expect(saveLocale).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
