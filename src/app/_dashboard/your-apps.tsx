import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listUserCatalogApps, type UserCatalogApp } from "@/lib/catalog/apps";
import { readAccessRequestsEnabled } from "@/lib/config";
import { logger } from "@/lib/observability/logger";
import { AppMark } from "@/app/_components/app-mark";

const HEADING_ID = "your-apps-h";

// The section's frame: the same landmark and heading whether it's loading,
// loaded or failed, so the page doesn't jump and screen-reader users find
// "Your apps" in the same place every time.
function Frame({
  action,
  busy,
  children,
}: {
  action?: ReactNode;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={HEADING_ID} aria-busy={busy || undefined} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id={HEADING_ID} className="text-2xl font-bold tracking-tight">
          Your apps
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function YourAppsLoading() {
  return (
    <Frame busy>
      <p className="text-ink-muted">Loading your apps…</p>
    </Frame>
  );
}

// Quick launchers for the apps the user can already open. Browsing, search
// and asking for more stay on /apps; this is the "get straight to it" view.
//
// Rendered inside its own <Suspense> on the dashboard, and it catches its
// own load failure: a slow or failing PocketID costs this one section, not
// the whole page (#20).
export async function YourApps({ userGroups }: { userGroups: string[] }) {
  const requestsEnabled = readAccessRequestsEnabled();

  let apps: UserCatalogApp[];
  try {
    apps = await listUserCatalogApps(getPocketIdConfig(), getDb(), userGroups);
  } catch (err) {
    logger.error({ err }, "Dashboard: Your apps failed to load");
    return (
      <Frame>
        <div className="flex flex-col items-start gap-2 rounded-2xl border border-bad-line bg-bad px-5 py-4 text-on-bad">
          <p className="text-[15px] font-bold">We couldn’t load your apps just now.</p>
          <p className="text-sm">
            It’s usually brief. Your apps themselves still work.{" "}
            <Link href="/" className="font-semibold underline underline-offset-4">
              Try again
            </Link>
          </p>
        </div>
      </Frame>
    );
  }

  const usable = apps.filter((app) => app.hasAccess);

  if (usable.length === 0) {
    return (
      <Frame>
        <div className="card flex flex-col items-start gap-3 p-6">
          <p className="text-[17px] font-bold">You don’t have any apps yet.</p>
          {requestsEnabled ? (
            <>
              <p className="text-[15px] text-ink-muted">
                See what’s available, and ask for what you need. An admin lets you in.
              </p>
              <Link href="/apps" className="btn btn-primary">
                Ask for an app
              </Link>
            </>
          ) : (
            <p className="text-[15px] text-ink-muted">Ask an administrator to give you access.</p>
          )}
        </div>
      </Frame>
    );
  }

  return (
    <Frame
      action={
        <Link href="/apps" className="text-[15px] font-semibold text-ink underline underline-offset-4">
          {requestsEnabled ? "See all apps, or ask for more" : "See all apps"}
        </Link>
      }
    >
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))]">
        {usable.map((app) => (
          <li key={app.id} className="flex">
            {/* The accessible name carries the app, as on /apps: a list of
                bare "Open"s is ambiguous out of context (SC 2.4.4). The
                description stays visible, since people here may not know
                the app by its name. */}
            <a
              href={app.launchUrl}
              aria-label={`Open ${app.name}`}
              className="card card-link flex flex-1 items-center gap-3.5 p-4 text-ink"
            >
              <AppMark name={app.name} iconUrl={app.iconUrl} size="sm" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[17px] font-bold tracking-tight">{app.name}</span>
                {app.description && (
                  <span className="line-clamp-2 text-sm text-ink-muted">{app.description}</span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Frame>
  );
}
