import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { userPreferences } from "@/lib/db/schema";
import type { Locale } from "@/i18n/locales";

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
// The language this person picked, or null if they never did. Returned as
// stored: the caller validates it (pickLocale), so a language removed from
// the portal later just falls through to the next choice.
export async function getSavedLocale(db: Db, subject: string): Promise<string | null> {
  const [row] = await db
    .select({ locale: userPreferences.locale })
    .from(userPreferences)
    .where(eq(userPreferences.subject, subject));
  return row?.locale ?? null;
}

export async function saveLocale(db: Db, subject: string, locale: Locale): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ subject, locale })
    .onConflictDoUpdate({
      target: userPreferences.subject,
      set: { locale, updatedAt: new Date() },
    });
}
/* v8 ignore stop */
