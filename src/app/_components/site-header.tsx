import Link from "next/link";
import { signOut } from "@/auth";

export type SiteHeaderUser = {
  name?: string | null;
  email?: string | null;
  isAdmin?: boolean;
};

const navLinkClass =
  "underline-offset-4 hover:underline focus-visible:underline text-zinc-700 dark:text-zinc-300";

// Persistent portal chrome, rendered by the root layout on every route.
// Before this existed each page was a navigational dead end — you could only
// reach /apps or /admin/* from the home page, and only by going back to it
// (WCAG 2.2 SC 2.4.5 Multiple Ways). It also carries the skip link that
// SC 2.4.1 wants, which has to come before any repeated block of links.
export function SiteHeader({
  name,
  user,
  logo,
  showAccessRequests = true,
  showAuditLog = true,
}: {
  // The portal's display name (lib/pocketid/branding.ts getPortalName).
  name: string;
  user: SiteHeaderUser | null;
  // False once requests are switched off and nothing is left to decide.
  showAccessRequests?: boolean;
  // False while FEATURE_AUDIT_LOG_PAGE is off.
  showAuditLog?: boolean;
  // PocketID's logo, when its branding could be read.
  logo?: { light: string; dark: string };
}) {
  return (
    <header className="border-b border-black/[.08] bg-white dark:border-white/[.145] dark:bg-black">
      {/* Visually hidden until focused, so the first Tab on any page offers
          "jump past the nav" rather than walking the whole header. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-foreground focus:px-4 focus:py-2 focus:text-background"
      >
        Skip to main content
      </a>

      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight text-black underline-offset-4 hover:underline dark:text-zinc-50"
        >
          {logo ? (
            <picture>
              <source media="(prefers-color-scheme: dark)" srcSet={logo.dark} />
              {/* A plain <img>: next/image would need PocketID's host in
                  next.config's remotePatterns, which varies per deployment.
                  Decorative, since the wordmark already names the link. */}
              <img src={logo.light} alt="" width={24} height={24} className="h-6 w-6" />
            </picture>
          ) : null}
          {name}
        </Link>

        {user && (
          <>
            {/* Named landmark: a screen reader's landmark list shows "Portal
                navigation" rather than an anonymous second <nav>. */}
            <nav aria-label="Portal">
              <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <li>
                  <Link href="/my-access" className={navLinkClass}>
                    My Access
                  </Link>
                </li>
                <li>
                  <Link href="/apps" className={navLinkClass}>
                    Apps
                  </Link>
                </li>
                {user.isAdmin && (
                  <>
                    <li>
                      <Link href="/admin/apps" className={navLinkClass}>
                        App Catalog
                      </Link>
                    </li>
                    {showAccessRequests && (
                      <li>
                        <Link href="/admin/requests" className={navLinkClass}>
                          Access Requests
                        </Link>
                      </li>
                    )}
                    {showAuditLog && (
                      <li>
                        <Link href="/admin/audit" className={navLinkClass}>
                          Audit Log
                        </Link>
                      </li>
                    )}
                  </>
                )}
              </ul>
            </nav>

            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button
                type="submit"
                className="rounded-full border border-black/[.15] px-3 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:border-white/[.2] dark:hover:bg-zinc-900"
              >
                Sign out
              </button>
            </form>
          </>
        )}
      </div>
    </header>
  );
}
