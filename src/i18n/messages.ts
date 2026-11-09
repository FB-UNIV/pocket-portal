import type { Locale } from "./locales";
import en from "./messages/en.json";
import fr from "./messages/fr.json";

// English is the reference: its shape is the Messages type (see
// use-intl.d.ts), so a key used in code but missing here fails tsc, and
// messages.test.ts fails if another language is missing one.
export type Messages = typeof en;

// Both bundled statically: they're small, and a static import can't fail at
// request time the way a dynamic one can.
export const MESSAGES: Record<Locale, Messages> = { en, fr };
