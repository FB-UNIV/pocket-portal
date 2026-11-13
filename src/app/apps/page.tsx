import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listUserCatalogApps, type UserCatalogApp } from "@/lib/catalog/apps";
import {
  browseHref,
  categoriesOf,
  filterApps,
  readBrowseParams,
  type BrowseParams,
} from "@/lib/catalog/browse";
import { listUserAccessRequests } from "@/lib/requests/access-requests";
import {
  deriveRequestOutcome,
  type RequestState,
} from "@/lib/requests/request-outcome";
import type { AccessRequest } from "@/lib/requests/access-requests";
import { defaultRole } from "@/lib/requests/default-role";
import {
  readAccessRequestReason,
  readAccessRequestsEnabled,
  type AccessRequestReason,
} from "@/lib/config";
import { askForPrerequisiteAction, requestAppAccessAction } from "./actions";
import { RequestAccessForm } from "./request-access-form";
import { formLabels, type AskFormT } from "./form-labels";
import { AppMark } from "@/app/_components/app-mark";
import { getLocale, getTranslations } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Apps");
  return { title: t("title") };
}

type AppsT = Awaited<ReturnType<typeof getTranslations<"Apps">>>;
type AskT = AskFormT;


// One role's status, as a short pill beside the app. Every state but
// "pending" used to be invisible to the requester: an approval or a denial
// just made the form reappear. Plain text, not a live region: it's page
// content on load, not an update arriving mid-visit. The group is named
// only when the app has more than one, where a bare "Waiting" wouldn't say
// which.
function StatusPill({
  state,
  group,
  t,
}: {
  state: RequestState;
  group: string | undefined;
  t: AppsT;
}) {
  const named = { group: group ?? "__none" };
  const { label, tone } = {
    pending: { label: t("statusPending", named), tone: "badge-tip" },
    settling: { label: t("statusSettling", named), tone: "badge-ok" },
    // Negative, not neutral: a quiet tone made a loss of access read as a
    // benign in-progress state, or as though the app were still granted.
    revoked: { label: t("statusRevoked", named), tone: "badge-bad" },
    denied: { label: t("statusDenied", named), tone: "badge-bad" },
  }[state];

  return <span className={`badge ${tone} min-h-8 px-3 text-sm`}>{label}</span>;
}

// The "no results" line, naming whatever was searched for.
function nothingMatches(t: AppsT, { q, category }: { q?: string; category?: string }): string {
  if (q && category) return t("nothingMatchesBoth", { q, category });
  if (q) return t("nothingMatchesQuery", { q });
  if (category) return t("nothingMatchesCategory", { category });
  return t("nothingMatches");
}

// What the app is for first, when PocketID has a description: that's what
// someone who doesn't know the app's name needs. The name is still the
// heading, so screen-reader users can jump from app to app by it.
function AppWords({ app, size }: { app: UserCatalogApp; size: "card" | "row" }) {
  const big =
    size === "card"
      ? "text-xl font-extrabold leading-tight tracking-tight"
      : "text-[17px] font-bold leading-snug";
  return app.description ? (
    <>
      <span className={big}>{app.description}</span>{" "}
      <h3 className="text-sm font-semibold text-ink-muted">{app.name}</h3>
    </>
  ) : (
    <h3 className={big}>{app.name}</h3>
  );
}

// One app to ask for: what it's for, where each role the user asked for
// stands, and an Ask link that opens the request form in place
// (/apps?ask=<id>, so it works without JavaScript). Pending and
// just-approved roles drop out of the form (asking again would be refused);
// declined and removed ones stay, and the link says "Ask again".
// The apps an app needs and the user doesn't have yet (ADR-0012), as one
// phrase: "VPN", "VPN and Wifi". Null when there are none.
function missingPrerequisites(app: UserCatalogApp, locale: string): string | null {
  const missing = app.requires.filter((prerequisite) => !prerequisite.hasAccess);
  if (missing.length === 0) return null;
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(missing.map((p) => p.name));
}

function AskRow({
  app,
  locale,
  myRequests,
  userGroups,
  reason,
  browse,
  t,
  tForm,
}: {
  app: UserCatalogApp;
  locale: string;
  myRequests: AccessRequest[];
  userGroups: string[];
  reason: AccessRequestReason;
  browse: BrowseParams;
  t: AppsT;
  tForm: AskT;
}) {
  const roles = app.allowedGroups.map((group) => ({
    group,
    outcome: deriveRequestOutcome(myRequests, app.id, group.id, userGroups),
  }));
  const open = roles.filter(({ outcome }) => !outcome || outcome.canRequest).map(({ group }) => group);
  const preselected = defaultRole(open);
  const again = roles.some(({ outcome }) => outcome?.canRequest);
  const named = app.allowedGroups.length > 1;
  const asking = browse.ask === app.id && preselected;

  return (
    <li className="flex flex-col gap-4 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <AppMark name={app.name} iconUrl={app.iconUrl} size="sm" />
        <div className="flex min-w-0 flex-[1_1_14rem] flex-col">
          <AppWords app={app} size="row" />
          {/* What else it takes to use it, so nobody is surprised once
              they're in (ADR-0012). */}
          {missingPrerequisites(app, locale) ? (
            <p className="mt-1 text-sm text-on-tip">{t("alsoNeeds", { names: missingPrerequisites(app, locale)! })}</p>
          ) : null}
        </div>
        {roles.map(({ group, outcome }) =>
          outcome ? (
            <StatusPill
              key={group.id}
              state={outcome.state}
              group={named ? group.friendlyName : undefined}
              t={t}
            />
          ) : null,
        )}
        {app.allowedGroups.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("noGroup")}</p>
        ) : null}
        {/* Offered only where it can actually succeed. The action re-checks
            server-side regardless. The name carries the app (SC 2.4.4). */}
        {preselected && !asking ? (
          <Link
            href={browseHref({ ...browse, ask: app.id })}
            scroll={false}
            aria-label={again ? t("askAgainApp", { name: app.name }) : t("askApp", { name: app.name })}
            className="btn btn-secondary"
          >
            {again ? t("askAgain") : t("ask")}
          </Link>
        ) : null}
      </div>
      {asking ? (
        <div className="rounded-[18px] bg-surface-muted p-4 sm:ml-14">
          <RequestAccessForm
            action={requestAppAccessAction.bind(null, app.id)}
            appId={app.id}
            roles={open.map(({ id, friendlyName }) => ({ id, friendlyName }))}
            defaultRoleId={preselected.id}
            reason={reason}
            labels={formLabels(tForm, app.name, reason)}
            cancelHref={browseHref({ ...browse, ask: undefined })}
          />
        </div>
      ) : null}
    </li>
  );
}

export default async function AppsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const session = await requireUser("/apps");
  const requestsEnabled = readAccessRequestsEnabled();
  const reasonMode = readAccessRequestReason();

  const db = getDb();
  const [catalog, myRequests, t, tForm, locale] = await Promise.all([
    listUserCatalogApps(getPocketIdConfig(), db, session.user.groups),
    listUserAccessRequests(db, session.user.id),
    getTranslations("Apps"),
    getTranslations("AskForm"),
    getLocale(),
  ]);
  // Requests off: a pure launcher, listing only what can be opened.
  const visible = requestsEnabled ? catalog : catalog.filter((app) => app.hasAccess);
  const categories = categoriesOf(visible);

  // ?q=…&category=…&ask=… (see lib/catalog/browse.ts). A category no
  // visible app has any more, say from an old bookmark, filters nothing out.
  const params = readBrowseParams(await searchParams);
  const browse: BrowseParams = {
    q: params.q,
    category: params.category && categories.includes(params.category) ? params.category : undefined,
    ask: params.ask,
  };
  const filtering = Boolean(browse.q || browse.category);
  const shown = filterApps(visible, browse);
  const usable = shown.filter((app) => app.hasAccess);
  const askable = shown.filter((app) => !app.hasAccess);

  return (
    <div className="flex flex-1 flex-col">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 pt-8 pb-20"
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">{t("title")}</h1>
            {visible.length > 0 && (
              // A plain GET form: works without JavaScript, and the result is
              // a URL that can be bookmarked or sent to someone. Enter submits.
              <form role="search" action="/apps" className="flex w-full sm:w-auto sm:flex-[0_1_26rem]">
                <label htmlFor="app-search" className="sr-only">
                  {t("searchLabel")}
                </label>
                <span className="relative flex-1">
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute top-1/2 left-4.5 -translate-y-1/2 text-ink-muted">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    id="app-search"
                    type="search"
                    name="q"
                    defaultValue={browse.q ?? ""}
                    placeholder={t("searchPlaceholder")}
                    className="field min-h-13 rounded-full pl-12.5 text-base"
                  />
                </span>
                {browse.category && <input type="hidden" name="category" value={browse.category} />}
              </form>
            )}
          </div>

          {categories.length > 0 && (
            <nav aria-label={t("categoriesLabel")}>
              <ul className="flex flex-wrap gap-2">
                {[undefined, ...categories].map((category) => (
                  <li key={category ?? ""}>
                    <Link
                      href={browseHref({ q: browse.q, category })}
                      aria-current={browse.category === category ? "page" : undefined}
                      className="chip"
                    >
                      {category ?? t("everything")}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {filtering && (
            <p className="text-[15px] text-ink-muted">
              {shown.length === 0
                ? nothingMatches(t, browse)
                : t("found", { count: shown.length })}{" "}
              <Link href="/apps" className="font-semibold text-ink underline underline-offset-4">
                {t("showEverything")}
              </Link>
            </p>
          )}
        </div>

        {(!filtering || usable.length > 0) && (
          <section aria-labelledby="usable-h" className="flex flex-col gap-5">
            <h2 id="usable-h" className="text-2xl font-bold tracking-tight">
              {t("usableHeading")}
            </h2>
            {usable.length === 0 ? (
              <p className="text-ink-muted">
                {requestsEnabled ? t("usableEmptyAsk") : t("usableEmptyAdmin")}
              </p>
            ) : (
              <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))]">
                {usable.map((app) => (
                  <li key={app.id} className="flex flex-col gap-2">
                    {/* The card's own words are its accessible name (what
                        the app is for, then its name): it says where the
                        link goes (SC 2.4.4) and contains everything the
                        card shows (SC 2.5.3, label in name). */}
                    <a
                      href={app.launchUrl}
                      className="card card-link relative flex flex-1 flex-col gap-4 rounded-3xl p-6 text-ink"
                    >
                      <AppMark name={app.name} iconUrl={app.iconUrl} />
                      <span className="flex flex-col gap-1 pr-6">
                        <AppWords app={app} size="card" />
                      </span>

                      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="absolute top-6 right-6 text-ink-muted">
                        <path d="M7 17 17 7M9 7h8v8" />
                      </svg>
                    </a>
                    {/* Below the card, not in it, so the link's name stays the
                        app's own words. The portal informs, it doesn't
                        enforce (ADR-0012): the card still opens the app. */}
                    {missingPrerequisites(app, locale) ? (
                      <div className="flex flex-col gap-2 px-2">
                        <p className="text-sm font-semibold text-on-tip">
                          {t("needsMissing", { names: missingPrerequisites(app, locale)! })}
                        </p>
                        {/* Ask for it right here (#19): its everyday role, no
                            reason, so not when a reason is required. */}
                        {app.requires
                          .filter((prerequisite) => !prerequisite.hasAccess)
                          .map((prerequisite) => {
                            const asked = myRequests.some(
                              (r) => r.pocketIdClientId === prerequisite.id && r.status === "pending",
                            );
                            const role = defaultRole(prerequisite.allowedGroups);
                            if (asked) {
                              return (
                                <p key={prerequisite.id} className="text-sm text-ink-muted">
                                  {t("askedFor", { name: prerequisite.name })}
                                </p>
                              );
                            }
                            if (!requestsEnabled || reasonMode === "required" || !role) return null;
                            return (
                              <form key={prerequisite.id} action={askForPrerequisiteAction.bind(null, prerequisite.id, role.id)}>
                                <button type="submit" className="btn btn-secondary">
                                  {t("askFor", { name: prerequisite.name })}
                                </button>
                              </form>
                            );
                          })}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {requestsEnabled && askable.length > 0 && (
          <section aria-labelledby="ask-h" className="flex flex-col gap-4">
            <h2 id="ask-h" className="text-2xl font-bold tracking-tight">
              {t("askHeading")}
            </h2>
            <ul className="card divide-y divide-line overflow-hidden rounded-3xl">
              {askable.map((app) => (
                <AskRow
                  key={app.id}
                  app={app}
                  locale={locale}
                  myRequests={myRequests}
                  userGroups={session.user.groups}
                  reason={reasonMode}
                  browse={browse}
                  t={t}
                  tForm={tForm}
                />
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
