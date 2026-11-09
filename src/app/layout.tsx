import type { Metadata } from "next";
import { Figtree, Geist_Mono } from "next/font/google";
import { auth } from "@/auth";
import { brandStyleSheet, getPocketIdBranding, getPortalName } from "@/lib/pocketid/branding";
import { readAccessRequestsEnabled } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { hasPendingAccessRequests } from "@/lib/requests/access-requests";
import { showAccessRequestsLink } from "@/lib/requests/queue-link";
import { SiteHeader } from "./_components/site-header";
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
  const name = await getPortalName();
  return {
    title: {
      default: name,
      template: `%s · ${name}`,
    },
    description:
      "A digital workspace portal: reach the apps you have access to, and request the ones you don't.",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [session, branding, name] = await Promise.all([
    auth(),
    getPocketIdBranding(),
    getPortalName(),
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
      lang="en"
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
        {children}
      </body>
    </html>
  );
}
