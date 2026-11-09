"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/lib/db/client";
import { readAuthUrl } from "@/lib/config";
import { saveLocale } from "@/lib/preferences/locale";
import { isLocale, LOCALE_COOKIE } from "@/i18n/locales";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// The header's language switch. Signed in, the choice is saved to the
// person (it follows them to other devices, and lets emails use it later;
// #64). Either way it goes in a cookie too: the only place a signed-out
// visitor's choice can live.
export async function setLanguageAction(formData: FormData) {
  const locale = formData.get("locale");
  // Anything else is a forged or stale form: ignore it rather than error.
  if (!isLocale(locale)) return;

  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    // Only server code reads it.
    httpOnly: true,
    secure: readAuthUrl()?.startsWith("https:") ?? false,
  });

  const session = await auth();
  if (session?.user?.id) {
    await saveLocale(getDb(), session.user.id, locale);
  }

  // Every page renders text, so all of them are stale now.
  revalidatePath("/", "layout");
}
