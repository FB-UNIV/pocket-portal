import Link from "next/link";
import { signOut } from "@/auth";
import { getLocale, getTranslations } from "@/i18n/server";
import { LANGUAGE_NAMES, LOCALES } from "@/i18n/locales";
import { setLanguageAction } from "./language-actions";

export type SiteHeaderUser = {
  name?: string | null;
  email?: string | null;
  isAdmin?: boolean;
};

// Pills, not underlined text: 44px tall for touch, and a visible hover
// surface so it reads as something to press.
const navLinkClass =
  "inline-flex min-h-11 items-center rounded-full px-3.5 text-[15px] font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink";

// Persistent portal chrome, rendered by the root layout on every route.
// Before this existed each page was a navigational dead end — you could only
// reach /apps or /admin/* from the home page, and only by going back to it
// (WCAG 2.2 SC 2.4.5 Multiple Ways). It also carries the skip link that
// SC 2.4.1 wants, which has to come before any repeated block of links.
export async function SiteHeader({
  name,
  user,
  logo,
  showAccessRequests = true,
}: {
  // The portal's display name (lib/pocketid/branding.ts getPortalName).
  name: string;
  user: SiteHeaderUser | null;
  // False once requests are switched off and nothing is left to decide.
  showAccessRequests?: boolean;
  // PocketID's logo, when its branding could be read.
  logo?: { light: string; dark: string };
}) {
  const [t, locale] = await Promise.all([getTranslations("Header"), getLocale()]);

  return (
    <header className="bg-ground">
      {/* Visually hidden until focused, so the first Tab on any page offers
          "jump past the nav" rather than walking the whole header. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-ground"
      >
        {t("skipLink")}
      </a>

      {/* Signed out, the page under it is the sign-in page, which is wider
          so its picture can be big: the header lines up with it. */}
      <div
        className={`mx-auto flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 ${
          user ? "max-w-6xl" : "max-w-[1440px]"
        }`}
      >
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2.5 text-lg font-bold tracking-tight text-ink no-underline"
        >
          {logo ? (
            <picture>
              <source media="(prefers-color-scheme: dark)" srcSet={logo.dark} />
              {/* A plain <img>: next/image would need PocketID's host in
                  next.config's remotePatterns, which varies per deployment.
                  Decorative, since the wordmark already names the link. */}
              <img src={logo.light} alt="" width={32} height={32} className="h-8 w-8 rounded-[10px]" />
            </picture>
          ) : (
            // The portal's own mark when PocketID has no logo: a house, since
            // this is where the household's apps live. Decorative.
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-brand text-on-brand"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10.5 12 3l9 7.5" />
                <path d="M5 9.5V21h14V9.5" />
                <path d="M10 21v-6h4v6" />
              </svg>
            </span>
          )}
          {name}
        </Link>

        {user && (
          // Named landmark: a screen reader's landmark list shows "Portal
          // navigation" rather than an anonymous second <nav>.
          <nav aria-label={t("navLabel")}>
            <ul className="flex flex-wrap items-center gap-1">
              <li>
                <Link href="/apps" data-tour="nav-apps" className={navLinkClass}>
                  {t("apps")}
                </Link>
              </li>
              {user.isAdmin && (
                <>
                  <li aria-hidden="true" className="mx-1 h-5 w-px bg-line-strong" />
                  <li>
                    {/* One link: the admin pages carry their own side menu.
                        It opens on the queue while there are requests to
                        decide, else on the catalog. */}
                    <Link
                      href={showAccessRequests ? "/admin/requests" : "/admin/apps"}
                      className={navLinkClass}
                    >
                      {t("admin")}
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </nav>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* One button per other language, each named in its own language
              and marked with it, so a screen reader pronounces "Français"
              as French (WCAG 3.1.2). Shown signed out too: the sign-in page
              is where someone first needs it. */}
          <form action={setLanguageAction} className="flex items-center gap-1">
            {LOCALES.filter((other) => other !== locale).map((other) => (
              <button
                key={other}
                type="submit"
                name="locale"
                value={other}
                lang={other}
                className="btn btn-quiet gap-2"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9s1.3-6.3 3.8-9z" />
                </svg>
                {LANGUAGE_NAMES[other]}
              </button>
            ))}
          </form>

          {user && (
            <form
              data-tour="account"
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button type="submit" className="btn btn-quiet">
                {t("signOut")}
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
