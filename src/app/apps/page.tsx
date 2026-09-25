import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listUserCatalogApps } from "@/lib/catalog/apps";
import { listUserAccessRequests } from "@/lib/requests/access-requests";
import {
  deriveRequestOutcome,
  type RequestState,
} from "@/lib/requests/request-outcome";
import { readAccessRequestReason, readAccessRequestsEnabled } from "@/lib/config";
import { requestAccessAction } from "./actions";
import { RequestAccessForm } from "./request-access-form";

export const metadata: Metadata = {
  title: "Apps",
};

// What the requester is told about one client+group pairing. Every state but
// "pending" was previously invisible to them: an approval or a denial just
// made the form reappear, indistinguishable from never having asked.
//
// Plain static text rather than a live region — this is page content on load,
// not an update arriving mid-visit, so announcing it would talk over the user.
function OutcomeNotice({
  state,
  friendlyName,
}: {
  state: RequestState;
  friendlyName: string;
}) {
  const { label, detail, tone } = {
    pending: {
      label: `Pending: ${friendlyName}`,
      detail: null,
      tone: "neutral",
    },
    settling: {
      label: `Approved: ${friendlyName}`,
      detail:
        "Access may take a few minutes to appear here. Signing out and back in applies it immediately.",
      tone: "good",
    },
    revoked: {
      label: `Access removed: ${friendlyName}`,
      detail:
        "This was approved before, but the group is no longer granted. You can ask again.",
      // Negative, not neutral: sharing "pending"'s quiet grey made a loss of
      // access read as a benign in-progress state, or as though the app were
      // still granted.
      tone: "bad",
    },
    denied: {
      label: `Denied: ${friendlyName}`,
      detail: "You can request again if your reason has changed.",
      tone: "bad",
    },
  }[state];

  return (
    <div className="flex flex-col gap-1">
      <span
        className={`self-start rounded-full border px-4 py-2 text-sm font-medium ${
          tone === "good"
            ? "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100"
            : tone === "bad"
              ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
              : "border-black/[.15] text-zinc-600 dark:border-white/[.2] dark:text-zinc-400"
        }`}
      >
        {label}
      </span>
      {detail && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">{detail}</p>
      )}
    </div>
  );
}

export default async function AppsPage() {
  const session = await requireUser("/apps");
  const requestsEnabled = readAccessRequestsEnabled();
  const reasonMode = readAccessRequestReason();

  const db = getDb();
  const [catalog, myRequests] = await Promise.all([
    listUserCatalogApps(getPocketIdConfig(), db, session.user.groups),
    listUserAccessRequests(db, session.user.id),
  ]);
  // Requests off: a pure launcher, listing only what can be opened.
  const apps = requestsEnabled ? catalog : catalog.filter((app) => app.hasAccess);

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black">
      <main
        id="main-content"
        tabIndex={-1}
        className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6 sm:px-16 bg-white dark:bg-black"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Apps
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {requestsEnabled ? (
              <>
                Browse everything available in this workspace. Apps you don&rsquo;t
                have access to yet can be requested below.
              </>
            ) : (
              "The apps you can open in this workspace."
            )}
          </p>
        </div>

        {apps.length === 0 && !requestsEnabled ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You don&rsquo;t have access to any apps yet. Ask an administrator.
          </p>
        ) : null}

        <ul className="flex flex-col gap-3">
          {apps.map((app) => (
            <li
              key={app.id}
              className="flex flex-col gap-3 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]"
            >
              <div>
                {/* A heading, not a <p>: this is the card's name, and it is how
                    a screen-reader user jumps from app to app. */}
                <h2 className="font-medium">{app.name}</h2>
                {app.description && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{app.description}</p>
                )}
              </div>

              {app.hasAccess ? (
                <a
                  href={app.launchUrl}
                  aria-label={`Open ${app.name}`}
                  className="self-start rounded-full bg-brand px-4 py-2 text-sm text-on-brand"
                >
                  Open
                </a>
              ) : app.allowedGroups.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  No group grants access to this app yet.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {app.allowedGroups.map((group) => {
                    // Every notice names its group: an app with two requestable
                    // groups otherwise shows two bare badges with nothing to
                    // tell them apart.
                    const outcome = deriveRequestOutcome(
                      myRequests,
                      app.id,
                      group.id,
                      session.user.groups,
                    );

                    return (
                      <div key={group.id} className="flex flex-col gap-2">
                        {outcome && (
                          <OutcomeNotice
                            state={outcome.state}
                            friendlyName={group.friendlyName}
                          />
                        )}

                        {/* Offered only where it can actually succeed. The
                            action re-checks server-side regardless. */}
                        {(!outcome || outcome.canRequest) && (
                          <RequestAccessForm
                            action={requestAccessAction.bind(
                              null,
                              app.id,
                              group.id,
                            )}
                            fieldId={`message-${app.id}-${group.id}`}
                            friendlyName={group.friendlyName}
                            reason={reasonMode}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
