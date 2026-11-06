import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listUserCatalogApps, type UserCatalogApp } from "@/lib/catalog/apps";
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
// Every notice names its group: an app with two requestable groups otherwise
// shows two bare badges with nothing to tell them apart.
function OutcomeNotice({
  state,
  friendlyName,
}: {
  state: RequestState;
  friendlyName: string;
}) {
  const { label, detail, tone } = {
    pending: {
      label: `Asked to join ${friendlyName}`,
      detail: "Waiting for an admin.",
      tone: "tip",
    },
    settling: {
      label: `Approved for ${friendlyName}`,
      detail:
        "It shows up under “What you can use” within a few minutes, or right away if you sign out and back in.",
      tone: "ok",
    },
    revoked: {
      label: `Access through ${friendlyName} was removed`,
      // Negative, not neutral: a quiet tone made a loss of access read as a
      // benign in-progress state, or as though the app were still granted.
      detail: "You had this before, but the group no longer grants it. You can ask again.",
      tone: "bad",
    },
    denied: {
      label: `Not approved: ${friendlyName}`,
      detail: "You can ask again if things have changed.",
      tone: "bad",
    },
  }[state];

  const toneClass = {
    tip: "border-tip-line bg-tip text-on-tip",
    ok: "border-ok-line bg-ok text-on-ok",
    bad: "border-bad-line bg-bad text-on-bad",
  }[tone];

  return (
    <div className={`flex flex-col gap-1 rounded-2xl border px-4 py-3 ${toneClass}`}>
      <span className="text-[15px] font-bold">{label}</span>
      <p className="text-sm">{detail}</p>
    </div>
  );
}

// Warm tints for apps without a PocketID logo, picked by name so an app
// keeps its colour between visits. Ink on each is >= 7:1.
const TINTS = ["#ECE6FB", "#FBEBD3", "#DFEDF9", "#DCF1E8", "#F8E4DA", "#E8E9EE"];

function AppMark({ name, iconUrl }: { name: string; iconUrl: string | null }) {
  if (iconUrl) {
    return (
      // A plain <img>, as in the site header: next/image would need
      // PocketID's host in remotePatterns. Decorative: the card names the app.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt=""
        width={56}
        height={56}
        className="h-14 w-14 flex-none rounded-2xl border border-line bg-surface object-contain p-2"
      />
    );
  }
  const tint = TINTS[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TINTS.length];
  return (
    <span
      aria-hidden="true"
      style={{ background: tint }}
      className="inline-flex h-14 w-14 flex-none items-center justify-center rounded-2xl text-2xl font-extrabold text-[#1f1b16]"
    >
      {[...name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}

// Leads with what the app is for when PocketID has a description, which is
// what someone who doesn't know the app's name needs; the name is still the
// heading, so screen-reader users can jump from app to app by it.
function AppIntro({ app }: { app: UserCatalogApp }) {
  return (
    <div className="flex items-start gap-4">
      <AppMark name={app.name} iconUrl={app.iconUrl} />
      <div className="flex min-w-0 flex-col gap-1">
        {app.description ? (
          <>
            <h3 className="text-sm font-bold text-ink-muted">{app.name}</h3>
            <p className="text-lg font-bold leading-snug tracking-tight">{app.description}</p>
          </>
        ) : (
          <h3 className="text-lg font-bold leading-snug tracking-tight">{app.name}</h3>
        )}
      </div>
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
  const usable = catalog.filter((app) => app.hasAccess);
  // Requests off: a pure launcher, listing only what can be opened.
  const askable = requestsEnabled ? catalog.filter((app) => !app.hasAccess) : [];

  return (
    <div className="flex flex-1 flex-col">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pt-8 pb-20"
      >
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Apps</h1>
          <p className="max-w-2xl text-lg text-ink-muted">
            {requestsEnabled
              ? "Everything you can open, and what else you can ask for."
              : "The apps you can open."}
          </p>
        </div>

        <aside className="flex max-w-3xl items-start gap-3.5 rounded-2xl bg-tip px-5 py-4 text-on-tip">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-px flex-none">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          <p className="text-[15px] leading-relaxed">
            <strong className="font-bold">New here?</strong> Each card says what
            the app is for. Click one and it opens. You won&rsquo;t need
            another password.
          </p>
        </aside>

        <section aria-labelledby="usable-h" className="flex flex-col gap-5">
          <h2 id="usable-h" className="text-2xl font-bold tracking-tight">
            What you can use
          </h2>
          {usable.length === 0 ? (
            <p className="text-ink-muted">
              {requestsEnabled
                ? "Nothing yet. Ask for something below, and it shows up here once an admin lets you in."
                : "You don’t have access to any apps yet. Ask an administrator."}
            </p>
          ) : (
            <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
              {usable.map((app) => (
                <li key={app.id} className="flex">
                  {/* SC 4.1.2 / 2.4.4: one "Open" per app is ambiguous out
                      of context, so the accessible name carries the app. */}
                  <a
                    href={app.launchUrl}
                    aria-label={`Open ${app.name}`}
                    className="card card-link flex flex-1 flex-col gap-5 p-5 text-ink"
                  >
                    <AppIntro app={app} />
                    <span className="mt-auto flex items-center justify-between border-t border-line pt-3.5 text-sm font-semibold text-ink-muted">
                      Open
                      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 17 17 7M9 7h8v8" />
                      </svg>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {requestsEnabled && askable.length > 0 && (
          <section
            aria-labelledby="ask-h"
            className="flex flex-col gap-5 rounded-[28px] bg-surface-muted p-5 sm:p-7"
          >
            <div className="flex flex-col gap-1.5">
              <h2 id="ask-h" className="text-2xl font-bold tracking-tight">
                More you can ask for
              </h2>
              <p className="text-[15px] text-ink-muted">
                Ask, and an admin will let you in. It moves up to &ldquo;What
                you can use&rdquo; once they do.
              </p>
            </div>
            <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))]">
              {askable.map((app) => (
                <li key={app.id} className="card flex flex-col gap-5 p-5">
                  <AppIntro app={app} />
                  {app.allowedGroups.length === 0 ? (
                    <p className="text-sm text-ink-muted">
                      No group grants access to this app yet.
                    </p>
                  ) : (
                    <div className="mt-auto flex flex-col gap-4">
                      {app.allowedGroups.map((group) => {
                        const outcome = deriveRequestOutcome(
                          myRequests,
                          app.id,
                          group.id,
                          session.user.groups,
                        );

                        return (
                          <div key={group.id} className="flex flex-col gap-3">
                            {outcome && (
                              <OutcomeNotice
                                state={outcome.state}
                                friendlyName={group.friendlyName}
                              />
                            )}

                            {/* Offered only where it can actually succeed.
                                The action re-checks server-side regardless. */}
                            {(!outcome || outcome.canRequest) && (
                              <RequestAccessForm
                                action={requestAccessAction.bind(null, app.id, group.id)}
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
          </section>
        )}
      </main>
    </div>
  );
}
