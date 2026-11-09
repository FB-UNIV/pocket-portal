import { createTranslator, type NamespaceKeys, type NestedKeyOf } from "use-intl";
import type { Locale } from "./locales";
import { MESSAGES, type Messages } from "./messages";

export type Namespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

// A translator for an explicit language, outside any request: what emails
// use, since they go out in the recipient's language, not the language of
// whoever's action sent them. In a page, use getTranslations
// (@/i18n/server), which works out the request's language itself.
export function translatorFor<N extends Namespace = never>(locale: Locale, namespace?: N) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace });
}
