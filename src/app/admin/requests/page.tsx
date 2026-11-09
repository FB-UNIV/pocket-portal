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
import { decisionLabels } from "./decision-labels";
import { getLocale, getTranslations } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AdminRequests");
  return { title: t("title") };
}

// "Jellyfin", "Jellyfin and Sonarr", "Jellyfin, Sonarr and Radarr" (or
// "et" in French). Not Intl.ListFormat: its English adds a serial comma,
// and its output follows the container's CLDR data.
function listOf(names: string[], and: string): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${and} ${names.at(-1)}`;
}

export default async function AdminRequestsPage() {
  await requireAdmin("/admin/requests");

  const db = getDb();
  // The catalog decides which rows can be approved at all, and says what
  // each one is for. Fetched even for an empty queue to keep this simple;
  // a PocketID outage reaches the error boundary, and approving would fail
  // anyway.
  const [requests, apps, t, locale] = await Promise.all([
    listPendingAccessRequests(db),
    listAdminCatalogApps(getPocketIdConfig(), db),
    getTranslations("AdminRequests"),
    getLocale(),
  ]);

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink tabular-nums sm:text-4xl">
          {t("waiting", { count: requests.length })}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-muted">{t("intro")}</p>
        {readAccessRequestsEnabled() ? null : (
          // kept reachable so what was filed before can be drained.
          <p className="mt-3 badge badge-tip">{t("switchedOff")}</p>
        )}
      </div>

      {requests.length === 0 ? (
        <div className="card flex flex-col items-start gap-1 p-6">
          <p className="text-lg font-bold">{t("caughtUp")}</p>
          <p className="text-ink-muted">{t("caughtUpDetail")}</p>
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
                      {t.rich("askedFor", {
                        requester,
                        app: appName,
                        muted: (chunks) => <span className="font-normal text-ink-muted">{chunks}</span>,
                      })}
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
                    <p className="text-sm text-ink-muted italic">{t("noNote")}</p>
                  )}

                  {grantable ? (
                    <p className="text-sm text-ink-muted">
                      {/* The group stands out; the apps it opens, a little. */}
                      {t.rich(opens.length > 1 ? "approvingAddsOpens" : "approvingAdds", {
                        group: groupLabel,
                        apps: listOf(opens, t("and")),
                        strong: (chunks) => <span className="font-semibold text-ink">{chunks}</span>,
                        list: (chunks) => <span className="text-ink">{chunks}</span>,
                      })}
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
                      labels={decisionLabels(t, requester, request.pocketIdGroupName)}
                    />
                    <p className="text-xs text-ink-muted">
                      {t("asked")}{" "}
                      <time dateTime={request.createdAt.toISOString()}>
                        {formatUtcTimestamp(request.createdAt, locale)}
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
