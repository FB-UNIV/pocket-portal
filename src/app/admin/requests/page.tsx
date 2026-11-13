import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { pocketIdDisplayNames } from "@/lib/pocketid/display-names";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { listPendingAccessRequests } from "@/lib/requests/access-requests";
import { isGrantable } from "@/lib/requests/grantable";
import { requestContext } from "@/lib/requests/request-context";
import { utcDayParts } from "@/lib/format/utc-timestamp";
import { readAccessRequestsEnabled } from "@/lib/config";
import { AppMark } from "@/app/_components/app-mark";
import { approveTogetherFormAction, decideAccessRequestAction } from "./actions";
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
  const config = getPocketIdConfig();
  // The catalog decides which rows can be approved at all, and says what
  // each one is for. Fetched even for an empty queue to keep this simple;
  // a PocketID outage reaches the error boundary, and approving would fail
  // anyway.
  const [requests, apps, t, locale] = await Promise.all([
    listPendingAccessRequests(db),
    listAdminCatalogApps(config, db),
    getTranslations("AdminRequests"),
    getLocale(),
  ]);
  const names = requests.length > 0 ? await pocketIdDisplayNames(config) : new Map<string, string>();
  const now = new Date();

  // Requests filed together (#19) read together: each prerequisite right
  // after the app that needs it, and that app offers to approve them all.
  const pendingIds = new Set(requests.map((r) => r.id));
  const childrenOf = new Map<string, typeof requests>();
  for (const r of requests) {
    if (r.parentRequestId && pendingIds.has(r.parentRequestId)) {
      childrenOf.set(r.parentRequestId, [...(childrenOf.get(r.parentRequestId) ?? []), r]);
    }
  }
  const ordered = requests
    .filter((r) => !(r.parentRequestId && pendingIds.has(r.parentRequestId)))
    .flatMap((r) => [r, ...(childrenOf.get(r.id) ?? [])]);
  const byId = new Map(requests.map((r) => [r.id, r]));

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-7">
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight text-ink tabular-nums sm:text-[44px] sm:leading-[1.05]">
          {t("waiting", { count: requests.length })}
        </h1>
        {readAccessRequestsEnabled() ? null : (
          // kept reachable so what was filed before can be drained.
          <p className="mt-3 badge badge-tip">{t("switchedOff")}</p>
        )}
      </div>

      {requests.length === 0 ? (
        <p className="card p-6 text-ink-muted">{t("caughtUpDetail")}</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {ordered.map((request) => {
            const requester =
              names.get(request.requesterSubject) ??
              request.requesterEmail ??
              request.requesterSubject;
            const { app, groupLabel, opens } = requestContext(apps, request);
            const grantable = isGrantable(apps, request);
            const appName = app?.name ?? groupLabel;
            const when = utcDayParts(request.createdAt, now, locale);
            const parent = request.parentRequestId ? byId.get(request.parentRequestId) : undefined;
            const parentApp = parent ? requestContext(apps, parent).app : null;
            const children = childrenOf.get(request.id) ?? [];
            // Offered only when every one of them could be granted.
            const together =
              children.length > 0 && grantable && children.every((child) => isGrantable(apps, child));

            return (
              <li key={request.id} className="flex flex-wrap items-start gap-x-5 gap-y-4 px-5 py-5 sm:px-6">
                <AppMark name={appName} iconUrl={app?.iconUrl ?? null} size="sm" />
                <div className="flex min-w-0 flex-[1_1_22rem] flex-col gap-2.5">
                  <div>
                    <h2 className="text-lg leading-snug font-bold break-words sm:text-[19px]">
                      {t.rich("wants", {
                        requester,
                        app: appName,
                        muted: (chunks) => <span className="font-normal text-ink-muted">{chunks}</span>,
                      })}
                    </h2>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-ink-muted">
                      {app?.description ? (
                        <>
                          <span>{app.description}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      ) : null}
                      {grantable ? (
                        <>
                          {/* What approving hands out: one group often opens
                              more than the app that was asked for. */}
                          <span>
                            {t.rich(opens.length > 1 ? "joinsOpens" : "joins", {
                              group: groupLabel,
                              apps: listOf(opens, t("and")),
                              strong: (chunks) => <span className="font-semibold text-ink">{chunks}</span>,
                              list: (chunks) => <span className="text-ink">{chunks}</span>,
                            })}
                          </span>
                          <span aria-hidden="true">·</span>
                        </>
                      ) : null}
                      <time dateTime={request.createdAt.toISOString()}>
                        {when.day === "today"
                          ? t("askedToday", when)
                          : when.day === "yesterday"
                            ? t("askedYesterday", when)
                            : t("askedOn", when)}
                      </time>
                    </p>
                  </div>

                  {parent ? (
                    <p className="text-sm font-semibold text-on-tip">
                      {t("askedTogether", { app: parentApp?.name ?? parent.pocketIdGroupName })}
                    </p>
                  ) : null}

                  {request.message ? (
                    <blockquote className="max-w-xl self-start rounded-2xl rounded-tl-sm bg-surface-muted px-4 py-2.5 text-[15px]">
                      {t("note", { note: request.message })}
                    </blockquote>
                  ) : null}
                </div>

                <div className="flex flex-col items-end gap-2 self-center">
                  {together ? (
                    <form action={approveTogetherFormAction.bind(null, request.id)}>
                      <button
                        type="submit"
                        aria-label={t("approveTogetherFor", { count: children.length + 1, requester })}
                        className="btn btn-primary"
                      >
                        {t("approveTogether", { count: children.length + 1 })}
                      </button>
                    </form>
                  ) : null}
                  <RequestDecision
                    approveAction={
                      grantable ? decideAccessRequestAction.bind(null, request.id, "approved") : undefined
                    }
                    denyAction={decideAccessRequestAction.bind(null, request.id, "denied")}
                    labels={decisionLabels(t, requester, request.pocketIdGroupName)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
