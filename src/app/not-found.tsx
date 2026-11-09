import Link from "next/link";
import { getTranslations } from "@/i18n/server";

// No `metadata` export: Next resolves metadata from layout.js/page.js only,
// so a title set here would be dropped. This page inherits the root layout's
// default title instead.
export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <div className="flex flex-col flex-1 items-center">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pt-8 pb-20"
      >
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-ink">
          {t("title")}
        </h1>
        <p className="text-ink-muted">{t("body")}</p>
        <Link
          href="/"
          className="self-start btn btn-primary"
        >
          {t("home")}
        </Link>
      </main>
    </div>
  );
}
