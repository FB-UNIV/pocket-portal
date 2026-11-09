import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { listPendingAccessRequests } from "@/lib/requests/access-requests";
import { isGrantable } from "@/lib/requests/grantable";
import { requestContext } from "@/lib/requests/request-context";
import { formatUtcTimestamp } from "@/lib/format/utc-timestamp";
import { readAccessRequestsEnabled } from "@/lib/config";
import { AppMark } from "@/app/_components/app-mark";
import { decideAccessRequestAction } from "./actions";
import { RequestDecision } from "./request-decision";

export const metadata: Metadata = {
  title: "Requests",
};

// "Jellyfin", "Jellyfin and Sonarr", "Jellyfin, Sonarr and Radarr".
function listOf(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function waitingHeading(count: number): string {
  if (count === 0) return "Nobody is waiting";
  return count === 1 ? "1 person is waiting" : `${count} people are waiting`;
}

export default async function AdminRequestsPage() {
  await requireAdmin("/admin/requests");

  const db = getDb();
  // The catalog decides which rows can be approved at all, and says what
  // each one is for. Fetched even for an empty queue to keep this simple;
  // a PocketID outage reaches the error boundary, and approving would fail
  // anyway.
  const [requests, apps] = await Promise.all([
    listPendingAccessRequests(db),
    listAdminCatalogApps(getPocketIdConfig(), db),
  ]);

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink tabular-nums sm:text-4xl">
          {waitingHeading(requests.length)}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-muted">
          People asking for an app they can&rsquo;t open yet. Approving adds
          them to the app&rsquo;s group in PocketID; if that fails, the request
          stays here.
        </p>
        {readAccessRequestsEnabled() ? null : (
          // kept reachable so what was filed before can be drained.
          <p className="mt-3 badge badge-tip">
            New requests are switched off (FEATURE_ACCESS_REQUESTS). You can
            still decide these.
          </p>
        )}
      </div>

      {requests.length === 0 ? (
        <div className="card flex flex-col items-start gap-1 p-6">
          <p className="text-lg font-bold">You&rsquo;re all caught up.</p>
          <p className="text-ink-muted">New requests show up here, and in the menu&rsquo;s count.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {requests.map((request) => {
            const requester = request.requesterEmail ?? request.requesterSubject;
            const { app, groupLabel, opens } = requestContext(apps, request);
            const grantable = isGrantable(apps, request);
            const appName = app?.name ?? groupLabel;

            return (
              <li key={request.id} className="card flex gap-4 p-5 sm:p-6">
                <AppMark name={appName} iconUrl={app?.iconUrl ?? null} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <div>
                    <h2 className="text-lg leading-snug font-semibold break-words">
                      {requester} <span className="font-normal text-ink-muted">asked for</span>{" "}
                      {appName}
                    </h2>
                    {app?.description ? (
                      <p className="text-sm text-ink-muted">{app.description}</p>
                    ) : null}
                  </div>

                  {request.message ? (
                    <blockquote className="max-w-xl rounded-2xl rounded-tl-sm bg-surface-muted px-4 py-3 text-[15px]">
                      {request.message}
                    </blockquote>
                  ) : (
                    <p className="text-sm text-ink-muted italic">No note.</p>
                  )}

                  {grantable ? (
                    <p className="text-sm text-ink-muted">
                      Approving adds them to{" "}
                      <span className="font-semibold text-ink">{groupLabel}</span>
                      {opens.length > 1 ? (
                        <>
                          , which opens <span className="text-ink">{listOf(opens)}</span>
                        </>
                      ) : null}
                      .
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <RequestDecision
                      approveAction={
                        grantable
                          ? decideAccessRequestAction.bind(null, request.id, "approved")
                          : undefined
                      }
                      denyAction={decideAccessRequestAction.bind(null, request.id, "denied")}
                      requester={requester}
                      groupName={request.pocketIdGroupName}
                    />
                    <p className="text-xs text-ink-muted">
                      Asked{" "}
                      <time dateTime={request.createdAt.toISOString()}>
                        {formatUtcTimestamp(request.createdAt)}
                      </time>
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
