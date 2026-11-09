import { createTranslator } from "use-intl";
import { MESSAGES } from "@/i18n/messages";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

// Stands in for @/i18n/server in unit tests (vitest.setup.ts mocks it with
// this): same translator, real messages, but no request, session or
// database. English unless a test calls setTestLocale; reset after each.

let current: Locale = DEFAULT_LOCALE;

export function setTestLocale(locale: Locale) {
  current = locale;
}

export function resetTestLocale() {
  current = DEFAULT_LOCALE;
}

export const fakeIntlServer = {
  getLocale: async () => current,
  getTranslations: async (namespace?: string) =>
    createTranslator({ locale: current, messages: MESSAGES[current], namespace: namespace as never }),
};
