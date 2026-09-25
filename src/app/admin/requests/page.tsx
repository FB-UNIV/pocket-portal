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
  await requireAdmin();

  const db = getDb();
  // The catalog decides which rows can be approved at all. Fetched even
  // for an empty queue to keep this simple; like /admin/apps, a PocketID
  // outage reaches the error boundary, and approving would fail anyway.
  const [requests, apps] = await Promise.all([
    listPendingAccessRequests(db),
    listAdminCatalogApps(getPocketIdConfig(), db),
  ]);

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black">
      <main
        id="main-content"
        tabIndex={-1}
        className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6 sm:px-16 bg-white dark:bg-black"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Access Requests (Admin)
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Users who asked for access to an app they can&rsquo;t reach yet.
            Approving grants the PocketID group membership and records the
            decision; a grant that fails leaves the request pending.
          </p>
          {readAccessRequestsEnabled() ? null : (
            // kept reachable so what was filed before can be drained.
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              New requests are switched off (<code>FEATURE_ACCESS_REQUESTS</code>). You can
              still decide the ones already here.
            </p>
          )}
        </div>

        {requests.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No pending access requests.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((request) => {
              const requester = request.requesterEmail ?? request.requesterSubject;

              return (
                <li
                  key={request.id}
                  className="flex flex-col gap-3 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145] sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex flex-col gap-1">
                    <h2 className="font-medium">{requester}</h2>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      Requesting access to{" "}
                      <span className="font-medium text-black dark:text-zinc-50">
                        {request.pocketIdGroupName}
                      </span>
                    </p>
                    {request.message ? (
                      <p className="mt-1 border-l-2 border-black/[.1] pl-3 text-sm text-zinc-700 dark:border-white/[.15] dark:text-zinc-300">
                        {request.message}
                      </p>
                    ) : (
                      // zinc-400 on white is 2.56:1 and zinc-500 on black is
                      // 4.35:1 — both under SC 1.4.3's 4.5:1 for body text.
                      <p className="mt-1 text-sm italic text-zinc-600 dark:text-zinc-400">
                        No message provided.
                      </p>
                    )}
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
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
