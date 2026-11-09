import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AuthError");
  return { title: t("title") };
}

// Auth.js sends sign-in failures here (pages.error in src/auth.ts) instead
// of its own unstyled page. The error code only selects a message: it's
// never rendered, so the query string can't put text on the page.
const KNOWN_ERRORS = ["Configuration", "AccessDenied", "Verification"] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];
const isKnownError = (code: unknown): code is KnownError =>
  typeof code === "string" && (KNOWN_ERRORS as readonly string[]).includes(code);

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const [{ error }, t] = await Promise.all([searchParams, getTranslations("AuthError")]);
  const message = isKnownError(error) ? t(error) : t("fallback");

  return (
    <div className="flex flex-col flex-1 items-center">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pt-8 pb-20"
      >
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-ink">
          {t("heading")}
        </h1>
        <p className="text-ink-muted">{message}</p>
        <Link
          href="/"
          className="self-start btn btn-primary"
        >
          {t("back")}
        </Link>
      </main>
    </div>
  );
}
