import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { auth } from "@/auth";
import { cookies, headers } from "next/headers";
import { getSavedLocale } from "@/lib/preferences/locale";
import { logger } from "@/lib/observability/logger";
import { getLocale, getTranslations } from "./server";

// vitest.setup.ts swaps this module for a fake everywhere else.
vi.unmock("@/i18n/server");
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/preferences/locale", () => ({ getSavedLocale: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ logger: { warn: vi.fn() } }));

// See src/app/page.test.tsx: auth() is overloaded, so cast to a plain Mock.
const mockAuth = auth as unknown as Mock;
const mockSaved = vi.mocked(getSavedLocale);

function request({ cookie, acceptLanguage }: { cookie?: string; acceptLanguage?: string }) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === "portal-locale" && cookie ? { name, value: cookie } : undefined),
  } as never);
  vi.mocked(headers).mockResolvedValue(
    new Headers(acceptLanguage ? { "accept-language": acceptLanguage } : {}) as never,
  );
}

describe("getLocale", () => {
  beforeEach(() => {
    mockAuth.mockReset().mockResolvedValue(null);
    mockSaved.mockReset().mockResolvedValue(null);
    vi.mocked(logger.warn).mockReset();
    request({});
  });

  it("uses the signed-in person's saved language", async () => {
    mockAuth.mockResolvedValue({ user: { id: "subject-1" } });
    mockSaved.mockResolvedValue("fr");
    request({ cookie: "en", acceptLanguage: "en" });

    expect(await getLocale()).toBe("fr");
    expect(mockSaved).toHaveBeenCalledWith({}, "subject-1");
  });

  it("never reads the database for a signed-out visitor", async () => {
    request({ cookie: "fr" });

    expect(await getLocale()).toBe("fr");
    expect(mockSaved).not.toHaveBeenCalled();
  });

  it("falls back to the browser's language without a saved one or a cookie", async () => {
    mockAuth.mockResolvedValue({ user: { id: "subject-1" } });
    request({ acceptLanguage: "fr-FR,fr;q=0.9" });

    expect(await getLocale()).toBe("fr");
  });

  it("is English with nothing to go on", async () => {
    expect(await getLocale()).toBe("en");
  });

  // A language preference isn't worth an error page.
  it("falls back, and logs, when the saved language can't be read", async () => {
    mockAuth.mockResolvedValue({ user: { id: "subject-1" } });
    const err = new Error("database down");
    mockSaved.mockRejectedValue(err);
    request({ acceptLanguage: "fr" });

    expect(await getLocale()).toBe("fr");
    expect(logger.warn).toHaveBeenCalledWith({ err }, expect.any(String));
  });
});

describe("getTranslations", () => {
  beforeEach(() => {
    mockAuth.mockReset().mockResolvedValue(null);
  });

  it("translates into the request's language", async () => {
    request({ cookie: "fr" });

    const t = await getTranslations("YourApps");

    expect(t("heading")).toBe("Vos applications");
    expect(t("seeAll")).toBe("Voir toutes les applications");
  });

  it("translates into English by default", async () => {
    request({});

    const t = await getTranslations("Header");

    expect(t("signOut")).toBe("Sign out");
  });
});
