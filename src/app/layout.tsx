import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { CSSProperties } from "react";
import { auth } from "@/auth";
import { getPocketIdBranding, getPortalName } from "@/lib/pocketid/branding";
import { readAccessRequestsEnabled, readAuditLogPageEnabled } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { hasPendingAccessRequests } from "@/lib/requests/access-requests";
import { showAccessRequestsLink } from "@/lib/requests/queue-link";
import { SiteHeader } from "./_components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
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

  // PocketID's accent, as the tokens globals.css defaults. Validated and
  // re-serialised as hex by brandColors, never PocketID's raw string.
  const brandStyle = branding?.colors
    ? ({
        "--brand": branding.colors.brand,
        "--on-brand": branding.colors.onBrand,
        "--brand-hover": branding.colors.brandHover,
      } as CSSProperties)
    : undefined;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={brandStyle}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-black">
        <SiteHeader
          name={name}
          user={session?.user ?? null}
          logo={branding?.logo}
          showAccessRequests={showAccessRequests}
          showAuditLog={readAuditLogPageEnabled()}
        />
        {children}
      </body>
    </html>
  );
}
