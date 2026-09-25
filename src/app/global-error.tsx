"use client";

import { useEffect } from "react";

// Catches what error.tsx structurally cannot: a throw in the *root layout*
// itself. error.js wraps pages and nested layouts but not the layout in its
// own segment, and the root layout calls auth() on every route —
// so an unreachable PocketID takes out the layout and would otherwise land
// on Next's built-in 500 page.
//
// This file replaces the document when active, which means globals.css, the
// Geist fonts and the site header are all absent. Hence the inline <style>
// (a stylesheet import would be ignored) and the system font stack.
const STYLES = `
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #171717; --muted: #52525b; --border: rgba(0,0,0,.15); }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0a0a0a; --fg: #ededed; --muted: #a1a1aa; --border: rgba(255,255,255,.2); }
  }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--fg);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
    display: flex; justify-content: center;
  }
  .wrap { width: 100%; max-width: 48rem; padding: 4rem 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }
  h1 { font-size: 1.5rem; line-height: 2rem; font-weight: 600; letter-spacing: -.01em; margin: 0; }
  p { margin: 0; }
  .muted { color: var(--muted); }
  .digest { font-size: .75rem; }
  .actions { display: flex; flex-wrap: wrap; gap: .75rem; }
  .btn, .link {
    border-radius: 9999px; padding: .5rem 1rem; font: inherit; font-size: .875rem;
    cursor: pointer; text-decoration: none; display: inline-block;
  }
  .btn { background: var(--fg); color: var(--bg); border: 0; }
  .link { border: 1px solid var(--border); color: inherit; }
  :focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
`;

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    // global-error must render its own <html>/<body>.
    <html lang="en">
      <body>
        {/* metadata exports aren't supported in a client boundary; React
            hoists this <title> instead. No portal name: that's read on the
            server, and this page renders when the server couldn't. */}
        <title>Something went wrong</title>
        <style>{STYLES}</style>
        <div className="wrap">
          <div role="alert" style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
            <h1>Something went wrong</h1>
            <p className="muted">
              The portal couldn&rsquo;t load. This usually means it can&rsquo;t
              reach PocketID — trying again in a moment is the fastest fix.
            </p>
            {error.digest && (
              <p className="muted digest">
                Reference: <code>{error.digest}</code>
              </p>
            )}
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={() => retry()}>
              Try again
            </button>
            {/* Plain anchor, and the rule is disabled deliberately: this
                boundary has replaced the document, so there is no router
                context for <Link> to soft-navigate with, and a soft
                navigation would re-enter the very layout that just threw.
                A full document load is the recovery. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="link" href="/">
              Back to portal home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
