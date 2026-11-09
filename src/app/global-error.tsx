"use client";

import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, negotiateLocale, type Locale } from "@/i18n/locales";
import { MESSAGES } from "@/i18n/messages";

// Catches what error.tsx structurally cannot: a throw in the *root layout*
// itself. error.js wraps pages and nested layouts but not the layout in its
// own segment, and the root layout calls auth() on every route —
// so an unreachable PocketID takes out the layout and would otherwise land
// on Next's built-in 500 page.
//
// This file replaces the document when active, which means globals.css, the
// portal font and the site header are all absent. Hence the inline <style>
// (a stylesheet import would be ignored) and the system font stack.
const STYLES = `
  :root { color-scheme: light dark; --bg: #fbf8f3; --fg: #1f1b16; --muted: #5e554b; --border: rgba(31,27,22,.18); --brand: #b4461f; --on-brand: #ffffff; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16130f; --fg: #f3ede4; --muted: #bdb2a4; --border: rgba(255,255,255,.2); --brand: #e8865f; --on-brand: #1f1b16; }
  }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--fg);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
    display: flex; justify-content: center;
  }
  .wrap { width: 100%; max-width: 48rem; padding: 4rem 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }
  h1 { font-size: 1.875rem; line-height: 2.25rem; font-weight: 800; letter-spacing: -.01em; margin: 0; }
  p { margin: 0; }
  .muted { color: var(--muted); }
  .digest { font-size: .75rem; }
  .actions { display: flex; flex-wrap: wrap; gap: .75rem; }
  .btn, .link {
    border-radius: 9999px; padding: 0 1.125rem; min-height: 44px; box-sizing: border-box; font: inherit; font-size: .9375rem; font-weight: 600;
    cursor: pointer; text-decoration: none; display: inline-flex; align-items: center;
  }
  .btn { background: var(--brand); color: var(--on-brand); border: 0; }
  .link { border: 1px solid var(--border); color: inherit; }
  :focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
`;

// The browser's languages don't change while this page is up.
const noSubscription = () => () => {};
const browserLocale = (): Locale =>
  negotiateLocale(navigator.languages.join(",")) ?? DEFAULT_LOCALE;

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // This replaces the root layout, so nothing here knows the request's
  // language: English on the server, the browser's language once it runs
  // there.
  const locale = useSyncExternalStore(noSubscription, browserLocale, () => DEFAULT_LOCALE);
  const t = MESSAGES[locale].Error;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    // global-error must render its own <html>/<body>.
    <html lang={locale}>
      <body>
        {/* metadata exports aren't supported in a client boundary; React
            hoists this <title> instead. No portal name: that's read on the
            server, and this page renders when the server couldn't. */}
        <title>{t.title}</title>
        <style>{STYLES}</style>
        <div className="wrap">
          <div role="alert" style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
            <h1>{t.title}</h1>
            <p className="muted">{t.globalBody}</p>
            {error.digest && (
              <p className="muted digest">
                {t.reference} <code>{error.digest}</code>
              </p>
            )}
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={() => retry()}>
              {t.retry}
            </button>
            {/* Plain anchor, and the rule is disabled deliberately: this
                boundary has replaced the document, so there is no router
                context for <Link> to soft-navigate with, and a soft
                navigation would re-enter the very layout that just threw.
                A full document load is the recovery. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="link" href="/">
              {t.home}
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
