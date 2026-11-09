// The languages the portal speaks, and how one is picked for a request.
// Adding a language: add it here, add its src/i18n/messages/<code>.json,
// and messages.test.ts checks it has every key English has.

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

// Remembers the choice in the browser: the only place it can live for a
// signed-out visitor, and it makes a switch apply before the database
// round-trip. Signed in, the saved preference wins (it follows the person
// across devices; #64).
export const LOCALE_COOKIE = "portal-locale";

// Each language named in itself, as a language switcher should: someone
// looking for French recognises "Français", not "French".
export const LANGUAGE_NAMES: Record<Locale, string> = {
  en: "English",
  fr: "Français",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

// The best supported language in an Accept-Language header, by its q
// weights, matching on the primary subtag ("fr-CA" counts as "fr").
// Null when nothing in it is supported, or there's no header.
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;

  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter(({ tag, weight }) => tag && weight > 0)
    // Highest weight first; ties keep the order the browser sent.
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  for (const { tag } of ranked) {
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

// Most deliberate choice first: the person's saved preference, then this
// browser's cookie, then what the browser says it prefers, then the
// portal's default (DEFAULT_LOCALE, English unless an admin set it).
export function pickLocale({
  saved,
  cookie,
  acceptLanguage,
  fallback = DEFAULT_LOCALE,
}: {
  saved?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
  fallback?: Locale;
}): Locale {
  if (isLocale(saved)) return saved;
  if (isLocale(cookie)) return cookie;
  return negotiateLocale(acceptLanguage) ?? fallback;
}
