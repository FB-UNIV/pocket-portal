import Link from "next/link";

// No `metadata` export: Next resolves metadata from layout.js/page.js only,
// so a title set here would be dropped. This page inherits the root layout's
// default title instead.
export default function NotFound() {
  return (
    <div className="flex flex-col flex-1 items-center">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pt-8 pb-20"
      >
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-ink">
          Page not found
        </h1>
        <p className="text-ink-muted">
          That URL doesn&rsquo;t match anything in this workspace. It may have
          been an app link that changed, or a page you don&rsquo;t have access
          to.
        </p>
        <Link
          href="/"
          className="self-start btn btn-primary"
        >
          Back to portal home
        </Link>
      </main>
    </div>
  );
}
