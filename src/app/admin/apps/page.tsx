import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps, type CatalogApp } from "@/lib/catalog/apps";
import { appProblems } from "@/lib/catalog/health";
import { AppMark } from "@/app/_components/app-mark";
import { getTranslations } from "@/i18n/server";
import { HealthBadges, ShownSwitch, WhoCanUse } from "./app-parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AdminApps");
  return { title: t("title") };
}

const FILTERS = {
  all: { label: "filterAll", keep: () => true },
  shown: { label: "filterShown", keep: (app: CatalogApp) => !app.hidden },
  hidden: { label: "filterHidden", keep: (app: CatalogApp) => app.hidden },
  fix: { label: "filterFix", keep: (app: CatalogApp) => appProblems(app).length > 0 },
} as const;
type Filter = keyof typeof FILTERS;

function filterHref(filter: Filter): string {
  return filter === "all" ? "/admin/apps" : `/admin/apps?show=${filter}`;
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
  const shownCount = apps.filter(FILTERS.shown.keep).length;
  const fixCount = apps.filter(FILTERS.fix.keep).length;

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">{t("intro")}</p>
        <p className="mt-3 text-sm font-semibold tabular-nums">
          {t("summary", { apps: apps.length, shown: shownCount, fix: fixCount })}
        </p>
      </div>

      <nav aria-label={t("filterLabel")}>
        <ul className="flex flex-wrap gap-2">
          {(Object.keys(FILTERS) as Filter[]).map((key) => (
            <li key={key}>
              <Link
                href={filterHref(key)}
                aria-current={key === filter ? "page" : undefined}
                className="chip tabular-nums"
              >
                {t(FILTERS[key].label)} ({apps.filter(FILTERS[key].keep).length})
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {listed.length === 0 ? (
        <div className="card p-6">
          <p className="text-ink-muted">
            {apps.length === 0 ? t("emptyNone") : t("emptyFilter")}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t("columnApp")}</th>
                {/* Narrow screens keep the name and the switch; the status
                    moves under the name, and the rest is on the app's page. */}
                <th scope="col" className="max-md:hidden">
                  {t("columnCategory")}
                </th>
                <th scope="col" className="max-md:hidden">
                  {t("columnWho")}
                </th>
                <th scope="col" className="max-md:hidden">
                  {t("columnStatus")}
                </th>
                <th scope="col">{t("columnShown")}</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((app) => (
                <tr key={app.id}>
                  <td className="md:min-w-64">
                    <div className="flex items-center gap-3">
                      <AppMark name={app.name} iconUrl={app.iconUrl} size="sm" />
                      <div className="min-w-0">
                        <Link
                          href={`/admin/apps/${encodeURIComponent(app.id)}`}
                          className="font-semibold text-ink underline-offset-4 hover:underline"
                        >
                          {app.name}
                        </Link>
                        <p className="line-clamp-1 text-sm text-ink-muted">
                          {app.description || t("noDescription")}
                        </p>
                        <div className="mt-1.5 md:hidden">
                          <HealthBadges app={app} t={t} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap max-md:hidden">
                    {app.category ?? <span className="text-ink-muted">{t("noCategory")}</span>}
                  </td>
                  <td className="max-md:hidden">
                    <WhoCanUse app={app} t={t} />
                  </td>
                  <td className="max-md:hidden">
                    <HealthBadges app={app} t={t} />
                  </td>
                  <td>
                    <ShownSwitch app={app} t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
