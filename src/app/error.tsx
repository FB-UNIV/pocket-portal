"use client";

import { useEffect } from "react";
import Link from "next/link";

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
  useEffect(() => {
    // Picked up by the Pino/OTel instrumentation already wired into the app.
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black">
      <main
        id="main-content"
        tabIndex={-1}
        className="flex w-full max-w-3xl flex-col gap-6 py-16 px-6 sm:px-16 bg-white dark:bg-black"
      >
        {/* role="alert" so the failure is announced rather than silently
            swapped in under a screen reader (SC 4.1.3 Status Messages). */}
        <div role="alert" className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Something went wrong
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            That action didn&rsquo;t complete. Nothing was changed if it failed
            partway — you can try again, or head back and start over.
          </p>
          {/* The thrown messages can name another user's groups or requests,
              so only the digest (which an operator can grep the logs for)
              is shown here. */}
          {error.digest && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Reference: <code className="font-mono">{error.digest}</code>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-full bg-brand px-4 py-2 text-sm text-on-brand transition-colors hover:bg-brand-hover"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-full border border-black/[.15] px-4 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-white/[.2] dark:hover:bg-zinc-900"
          >
            Back to portal home
          </Link>
        </div>
      </main>
    </div>
  );
}
