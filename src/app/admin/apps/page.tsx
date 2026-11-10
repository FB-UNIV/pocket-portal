import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps, type CatalogApp } from "@/lib/catalog/apps";
import { appProblems, type AppProblem } from "@/lib/catalog/health";
import { pocketIdClientUrl } from "./pocketid-url";
import { AppMark } from "@/app/_components/app-mark";
import { getTranslations } from "@/i18n/server";
import { ShownSwitch, WhoCanUse } from "./app-parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AdminApps");
  return { title: t("title") };
}

const FILTERS = {
  all: { label: "filterAll", keep: () => true },
  shown: { label: "filterShown", keep: (app: CatalogApp) => !app.hidden },
  hidden: { label: "filterHidden", keep: (app: CatalogApp) => app.hidden },
} as const;
type Filter = keyof typeof FILTERS;

function filterHref(filter: Filter): string {
  return filter === "all" ? "/admin/apps" : `/admin/apps?show=${filter}`;
}

// What to fix, as one sentence per app.
const FIX_KEYS = {
  both: "fixBoth",
  "no-link": "fixNoLink",
  "no-description": "fixNoDescription",
} as const;

function fixKey(problems: AppProblem[]): (typeof FIX_KEYS)[keyof typeof FIX_KEYS] {
  return FIX_KEYS[problems.length > 1 ? "both" : problems[0]];
}

export default async function AdminAppsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  await requireAdmin("/admin/apps");

  const show = (await searchParams)?.show;
  // A query param is user input: anything unknown shows everything.
  const filter: Filter =
    typeof show === "string" && Object.hasOwn(FILTERS, show) ? (show as Filter) : "all";

  const [apps, t] = await Promise.all([
    listAdminCatalogApps(getPocketIdConfig(), getDb()),
    getTranslations("AdminApps"),
  ]);
  const listed = apps.filter(FILTERS[filter].keep);
  // What people actually see: shown, and with a link to open it by.
  const onAppsPage = apps.filter((app) => !app.hidden && app.launchUrl).length;
  const toFix = apps
    .map((app) => ({ app, problems: appProblems(app) }))
    .filter(({ problems }) => problems.length > 0);

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-ink sm:text-[44px] sm:leading-[1.05]">
            {t("heading")}
          </h1>
          <p className="mt-2 text-lg text-ink-muted tabular-nums">
            {t("summary", { listed: onAppsPage, apps: apps.length })}
          </p>
        </div>
        <nav aria-label={t("filterLabel")}>
          <ul className="flex flex-wrap gap-2">
            {(Object.keys(FILTERS) as Filter[]).map((key) => (
              <li key={key}>
                <Link
                  href={filterHref(key)}
                  aria-current={key === filter ? "page" : undefined}
                  className="chip"
                >
                  {t(FILTERS[key].label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {toFix.length > 0 ? (
        <section
          aria-labelledby="to-fix"
          className="flex flex-col gap-3 rounded-3xl border border-tip-line bg-tip px-5 py-5 text-on-tip sm:px-6"
        >
          <h2 id="to-fix" className="flex items-center gap-2.5 text-lg font-bold">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01" />
              <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            {t("fixHeading", { count: toFix.length })}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {toFix.map(({ app, problems }) => {
              const url = pocketIdClientUrl(app.id);
              return (
                <li key={app.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <p className="text-[15px]">
                    {t(fixKey(problems), { app: app.name })}
                  </p>
                  {url ? (
                    <a
                      href={url}
                      aria-label={t("fixInLabel", { app: app.name })}
                      className="inline-flex min-h-9 items-center gap-1.5 text-sm font-bold text-on-tip underline-offset-4 hover:underline"
                    >
                      {t("fixIn")}
                      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 17 17 7M9 7h8v8" />
                      </svg>
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {listed.length === 0 ? (
        <p className="card p-6 text-ink-muted">
          {apps.length === 0 ? t("emptyNone") : t("emptyFilter")}
        </p>
      ) : (
        <ul aria-label={t("heading")} className="card divide-y divide-line overflow-hidden">
          {listed.map((app) => {
            const state = app.hidden ? "stateHidden" : app.launchUrl ? "stateListed" : "stateNoLink";
            return (
              <li key={app.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 sm:px-6">
                <AppMark name={app.name} iconUrl={app.iconUrl} size="sm" />
                <Link
                  href={`/admin/apps/${encodeURIComponent(app.id)}`}
                  className="group flex min-w-0 flex-[1_1_10rem] flex-col text-ink no-underline"
                >
                  <span className="text-[17px] font-bold underline-offset-4 group-hover:underline">
                    {app.description.trim() || app.name}
                  </span>
                  <span className="text-sm text-ink-muted">
                    {app.name} · {app.category ?? t("otherCategory")}
                  </span>
                </Link>
                <div className="flex-[0_1_14rem]">
                  <WhoCanUse app={app} t={t} />
                </div>
                <div className="flex flex-[1_0_15rem] items-center justify-end gap-3">
                  <span
                    className={`text-sm font-semibold ${
                      state === "stateListed" ? "text-on-ok" : state === "stateNoLink" ? "text-on-tip" : "text-ink-muted"
                    }`}
                  >
                    {t(state)}
                  </span>
                  <ShownSwitch app={app} t={t} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
