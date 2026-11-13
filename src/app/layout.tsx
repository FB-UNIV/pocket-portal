import type { Metadata } from "next";
import { Figtree, Geist_Mono } from "next/font/google";
import { auth } from "@/auth";
import { brandStyleSheet, getPocketIdBranding, getPortalName } from "@/lib/pocketid/branding";
import { readAccessRequestsEnabled, readWebVitalsEnabled } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { hasPendingAccessRequests } from "@/lib/requests/access-requests";
import { showAccessRequestsLink } from "@/lib/requests/queue-link";
import { getLocale, getTranslations } from "@/i18n/server";
import { IntlProvider } from "@/i18n/client-provider";
import { MESSAGES } from "@/i18n/messages";
import { SiteHeader } from "./_components/site-header";
import { WebVitals } from "./_components/web-vitals";
import "./globals.css";

// Figtree: friendly and very legible at small sizes, for an audience that
// mostly isn't technical (docs/DESIGN.md). Self-hosted by next/font, so the
// CSP's font-src 'self' still holds.
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// `title.template` applies to child segments only, so app/page.tsx (the same
// segment as this layout) takes `title.default` and every other route sets a
// plain `title` that gets suffixed — WCAG 2.2 SC 2.4.2 Page Titled.
export async function generateMetadata(): Promise<Metadata> {
  const [name, t] = await Promise.all([getPortalName(), getTranslations("Metadata")]);
  return {
    title: {
      default: name,
      template: `%s · ${name}`,
    },
    description: t("description"),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [session, branding, name, locale] = await Promise.all([
    auth(),
    getPocketIdBranding(),
    getPortalName(),
    getLocale(),
  ]);
  // Only an admin sees the link, so only an admin's render ever asks the DB,
  // and only while requests are off.
  const showAccessRequests = session?.user?.isAdmin
    ? await showAccessRequestsLink(readAccessRequestsEnabled(), () =>
        hasPendingAccessRequests(getDb()),
      )
    : false;

  // PocketID's accent, as the tokens globals.css defaults, with a lighter
  // variant for the dark theme. Validated and re-serialised as hex by
  // brandColors, never PocketID's raw string. See ADR-0010.
  const brandCss = branding?.colors ? brandStyleSheet(branding.colors) : null;

  return (
    <html
      // The page's language, so screen readers pronounce it right and
      // browsers don't offer to translate French as if it were English
      // (WCAG 3.1.1).
      lang={locale}
      className={`${figtree.variable} ${geistMono.variable} h-full antialiased`}
    >
      {brandCss ? (
        <head>
          <style>{brandCss}</style>
        </head>
      ) : null}
      <body className="min-h-full flex flex-col bg-ground text-ink">
        <SiteHeader
          name={name}
          user={session?.user ?? null}
          logo={branding?.logo}
          showAccessRequests={showAccessRequests}
        />
        {/* Client components read their words from here: error.tsx can't
            be handed them as props. Only its namespace is sent. */}
        <IntlProvider locale={locale} messages={{ Error: MESSAGES[locale].Error }}>
          {children}
        </IntlProvider>
        {/* Only while Web Vitals are on (they need METRICS_TOKEN): otherwise
            no script and nothing to beacon to. */}
        {readWebVitalsEnabled() ? <WebVitals /> : null}
      </body>
    </html>
  );
}
