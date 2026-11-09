import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from "use-intl";
import { auth } from "@/auth";
import { getDb } from "@/lib/db/client";
import { logger } from "@/lib/observability/logger";
import { getSavedLocale } from "@/lib/preferences/locale";
import { LOCALE_COOKIE, pickLocale, type Locale } from "./locales";
import { MESSAGES, type Messages } from "./messages";

// The glue use-intl leaves to the framework (next-intl would do this, but
// pulls in a compiler toolchain for features we don't use; #64).

// This request's language. Worked out once per request (React's cache is
// request-scoped on the server), and nothing is kept between requests.
export const getLocale = cache(async (): Promise<Locale> => {
  const [session, cookieStore, headerList] = await Promise.all([auth(), cookies(), headers()]);

  let saved: string | null = null;
  const subject = session?.user?.id;
  if (subject) {
    try {
      saved = await getSavedLocale(getDb(), subject);
    } catch (err) {
      // A language preference isn't worth an error page: fall back to the
      // cookie and the browser's language.
      logger.warn({ err }, "Couldn't read the saved language; using the browser's");
    }
  }

  return pickLocale({
    saved,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerList.get("accept-language"),
  });
});

type Namespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

// A translator for server components, in this request's language:
//   const t = await getTranslations("YourApps");  t("heading")
export async function getTranslations<N extends Namespace = never>(namespace?: N) {
  const locale = await getLocale();
  return createTranslator({ locale, messages: MESSAGES[locale], namespace });
}
