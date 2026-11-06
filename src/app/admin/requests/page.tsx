import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { listPendingAccessRequests } from "@/lib/requests/access-requests";
import { isGrantable } from "@/lib/requests/grantable";
import { formatUtcTimestamp } from "@/lib/format/utc-timestamp";
import { readAccessRequestsEnabled } from "@/lib/config";
import { decideAccessRequestAction } from "./actions";
import { RequestDecision } from "./request-decision";

export const metadata: Metadata = {
  title: "Access Requests",
};

export default async function AdminRequestsPage() {
  await requireAdmin("/admin/requests");

  const db = getDb();
  // The catalog decides which rows can be approved at all. Fetched even
  // for an empty queue to keep this simple; like /admin/apps, a PocketID
  // outage reaches the error boundary, and approving would fail anyway.
  const [requests, apps] = await Promise.all([
    listPendingAccessRequests(db),
    listAdminCatalogApps(getPocketIdConfig(), db),
  ]);

  return (
    <div className="flex flex-col flex-1 items-center">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pt-8 pb-20"
      >
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-ink">
            Access Requests (Admin)
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Users who asked for access to an app they can&rsquo;t reach yet.
            Approving grants the PocketID group membership and records the
            decision; a grant that fails leaves the request pending.
          </p>
          {readAccessRequestsEnabled() ? null : (
            // kept reachable so what was filed before can be drained.
            <p className="mt-2 text-sm text-ink-muted">
              New requests are switched off (<code>FEATURE_ACCESS_REQUESTS</code>). You can
              still decide the ones already here.
            </p>
          )}
        </div>

        {requests.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No pending access requests.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((request) => {
              const requester = request.requesterEmail ?? request.requesterSubject;

              return (
                <li
                  key={request.id}
                  className="flex flex-col gap-3 card p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex flex-col gap-1">
                    <h2 className="font-medium">{requester}</h2>
                    <p className="text-sm text-ink-muted">
                      Requesting access to{" "}
                      <span className="font-medium text-ink">
                        {request.pocketIdGroupName}
                      </span>
                    </p>
                    {request.message ? (
                      <p className="mt-1 border-l-2 border-line pl-3 text-sm text-ink-muted">
                        {request.message}
                      </p>
                    ) : (
                      // zinc-400 on white is 2.56:1 and zinc-500 on black is
                      // 4.35:1 — both under SC 1.4.3's 4.5:1 for body text.
                      <p className="mt-1 text-sm italic text-ink-muted">
                        No message provided.
                      </p>
                    )}
                    <p className="mt-1 text-xs text-ink-muted">
                      Requested{" "}
                      <time dateTime={request.createdAt.toISOString()}>
                        {formatUtcTimestamp(request.createdAt)}
                      </time>
                    </p>
                  </div>

                  <RequestDecision
                    approveAction={
                      isGrantable(apps, request)
                        ? decideAccessRequestAction.bind(null, request.id, "approved")
                        : undefined
                    }
                    denyAction={decideAccessRequestAction.bind(null, request.id, "denied")}
                    requester={requester}
                    groupName={request.pocketIdGroupName}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
