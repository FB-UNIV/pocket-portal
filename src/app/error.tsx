"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "use-intl";

// Before this boundary existed, a throwing server action (a PocketID grant
// that fails; expected refusals now answer inline) rendered Next's default
// error screen: no portal chrome, no way back, nothing announced. `retry`
// is the Next 16 prop name — `reset` no longer re-fetches.
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // In the page's language, from the root layout's IntlProvider.
  const t = useTranslations("Error");

  useEffect(() => {
    // Picked up by the Pino/OTel instrumentation already wired into the app.
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col flex-1 items-center">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pt-8 pb-20"
      >
        {/* role="alert" so the failure is announced rather than silently
            swapped in under a screen reader (SC 4.1.3 Status Messages). */}
        <div role="alert" className="flex flex-col gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-ink">
            {t("title")}
          </h1>
          <p className="text-ink-muted">{t("body")}</p>
          {/* The thrown messages can name another user's groups or requests,
              so only the digest (which an operator can grep the logs for)
              is shown here. */}
          {error.digest && (
            <p className="text-xs text-ink-muted">
              {t("reference")} <code className="font-mono">{error.digest}</code>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="btn btn-primary"
          >
            {t("retry")}
          </button>
          <Link
            href="/"
            className="btn btn-secondary"
          >
            {t("home")}
          </Link>
        </div>
      </main>
    </div>
  );
}
