import { describe, it, expect } from "vitest";
import { DEFAULT_LOCALE, isLocale, LANGUAGE_NAMES, LOCALES, negotiateLocale, pickLocale } from "./locales";

describe("isLocale", () => {
  it("accepts the supported languages only", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale("FR")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("negotiateLocale (Accept-Language)", () => {
  it("matches a regional variant on its language", () => {
    expect(negotiateLocale("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(negotiateLocale("fr-CA")).toBe("fr");
    expect(negotiateLocale("en-GB")).toBe("en");
  });

  it("follows the q weights, not the order", () => {
    expect(negotiateLocale("en;q=0.5, fr;q=0.9")).toBe("fr");
  });

  it("keeps the browser's order between equal weights", () => {
    expect(negotiateLocale("fr, en")).toBe("fr");
    expect(negotiateLocale("en, fr")).toBe("en");
  });

  it("skips languages the portal doesn't speak", () => {
    expect(negotiateLocale("de-DE, fr;q=0.7")).toBe("fr");
  });

  it("ignores languages weighted zero, or with a broken weight", () => {
    expect(negotiateLocale("fr;q=0, en;q=0.1")).toBe("en");
    expect(negotiateLocale("fr;q=abc, en;q=0.1")).toBe("en");
  });

  it("is case-insensitive", () => {
    expect(negotiateLocale("FR-fr")).toBe("fr");
  });

  it("returns null when nothing matches or there's no header", () => {
    expect(negotiateLocale("de, es;q=0.8")).toBeNull();
    expect(negotiateLocale("*")).toBeNull();
    expect(negotiateLocale("")).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
    expect(negotiateLocale(undefined)).toBeNull();
  });
});

describe("pickLocale", () => {
  it("prefers the person's saved language over everything", () => {
    expect(pickLocale({ saved: "fr", cookie: "en", acceptLanguage: "en" })).toBe("fr");
  });

  it("then this browser's cookie", () => {
    expect(pickLocale({ saved: null, cookie: "fr", acceptLanguage: "en" })).toBe("fr");
  });

  it("then the browser's languages", () => {
    expect(pickLocale({ acceptLanguage: "fr-BE,en;q=0.5" })).toBe("fr");
  });

  it("falls back to English", () => {
    expect(pickLocale({})).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  // A language dropped from the portal, or a tampered cookie, falls through
  // to the next choice instead of breaking the page.
  it("skips a saved language or cookie the portal doesn't speak", () => {
    expect(pickLocale({ saved: "de", cookie: "xx", acceptLanguage: "fr" })).toBe("fr");
  });
});

describe("LANGUAGE_NAMES", () => {
  it("names every language, in itself", () => {
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual([...LOCALES].sort());
    expect(LANGUAGE_NAMES.fr).toBe("Français");
  });
});
