import Link from "next/link";

// No `metadata` export: Next resolves metadata from layout.js/page.js only,
// so a title set here would be dropped. This page inherits the root layout's
// default title instead.
export default function NotFound() {
  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black">
      <main
        id="main-content"
        tabIndex={-1}
        className="flex w-full max-w-3xl flex-col gap-6 py-16 px-6 sm:px-16 bg-white dark:bg-black"
      >
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Page not found
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          That URL doesn&rsquo;t match anything in this workspace. It may have
          been an app link that changed, or a page you don&rsquo;t have access
          to.
        </p>
        <Link
          href="/"
          className="self-start rounded-full bg-brand px-4 py-2 text-sm text-on-brand transition-colors hover:bg-brand-hover"
        >
          Back to portal home
        </Link>
      </main>
    </div>
  );
}
