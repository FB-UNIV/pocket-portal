import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { categoriesOf, MAX_CATEGORY_LENGTH } from "@/lib/catalog/browse";
import { readPocketIdBaseUrl } from "@/lib/config";
import { AppMark } from "@/app/_components/app-mark";
import { setAppCategoryAction } from "../actions";
import { HealthBadges, ShownSwitch, WhoCanUse } from "../app-parts";
import { getTranslations } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AdminApp");
  return { title: t("title") };
}

// One app: what the portal sets (shown, category) next to what PocketID
// owns (name, description, link, groups; ADR-0007), which is read-only here
// and links out to PocketID's own page for the client.
export default async function AdminAppPage({ params }: PageProps<"/admin/apps/[id]">) {
  const { id } = await params;
  await requireAdmin(`/admin/apps/${encodeURIComponent(id)}`);

  const [apps, t, tApps] = await Promise.all([
    listAdminCatalogApps(getPocketIdConfig(), getDb()),
    getTranslations("AdminApp"),
    getTranslations("AdminApps"),
  ]);
  const app = apps.find((a) => a.id === id);
  if (!app) notFound();

  const categories = categoriesOf(apps);
  const baseUrl = readPocketIdBaseUrl();
  const pocketIdUrl = baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}/settings/admin/oidc-clients/${encodeURIComponent(app.id)}`
    : null;

  return (
    <main id="main-content" tabIndex={-1} className="flex max-w-3xl flex-col gap-6">
      <Link
        href="/admin/apps"
        className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-ink-muted underline-offset-4 hover:text-ink hover:underline"
      >
        {t("back")}
      </Link>

      <div className="flex items-center gap-4">
        <AppMark name={app.name} iconUrl={app.iconUrl} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink break-words">{app.name}</h1>
          <HealthBadges app={app} t={tApps} />
        </div>
      </div>

      <section aria-labelledby="set-here" className="card flex flex-col gap-5 p-6">
        <h2 id="set-here" className="text-lg font-bold">
          {t("setHere")}
        </h2>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold">{t("showLabel")}</p>
            <p className="text-sm text-ink-muted">
              {app.hidden ? t("hiddenNote") : app.launchUrl ? t("shownNote") : t("noLinkNote")}
            </p>
          </div>
          <ShownSwitch app={app} t={tApps} />
        </div>

        <form
          action={setAppCategoryAction.bind(null, app.id)}
          className="flex flex-col gap-2 border-t border-line pt-5"
        >
          <label htmlFor="category" className="font-semibold">
            {t("categoryLabel")}
          </label>
          <p id="category-hint" className="text-sm text-ink-muted">
            {t("categoryHint")}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              id="category"
              name="category"
              defaultValue={app.category ?? ""}
              list="category-suggestions"
              maxLength={MAX_CATEGORY_LENGTH}
              placeholder={t("categoryPlaceholder")}
              aria-describedby="category-hint"
              className="field max-w-xs"
            />
            <button type="submit" className="btn btn-primary">
              {t("save")}
            </button>
          </div>
          {/* Offered as suggestions, so "Files" doesn't become "files" on
              the next app. */}
          <datalist id="category-suggestions">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </form>
      </section>

      <section aria-labelledby="from-pocketid" className="card flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="from-pocketid" className="text-lg font-bold">
            {t("fromPocketId")}
          </h2>
          {pocketIdUrl ? (
            <a href={pocketIdUrl} className="btn btn-secondary">
              {t("changeInPocketId")}
            </a>
          ) : null}
        </div>

        <dl className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm font-semibold text-ink-muted">{t("whatFor")}</dt>
          <dd>
            {app.description ? (
              app.description
            ) : (
              <p className="rounded-2xl border border-tip-line bg-tip px-4 py-3 text-sm text-on-tip">
                {t("noDescriptionTip")}
              </p>
            )}
          </dd>

          <dt className="text-sm font-semibold text-ink-muted">{t("opensAt")}</dt>
          <dd>
            {app.launchUrl ? (
              <span className="break-all">{app.launchUrl}</span>
            ) : (
              <p className="rounded-2xl border border-tip-line bg-tip px-4 py-3 text-sm text-on-tip">
                {t("noLinkTip")}
              </p>
            )}
          </dd>

          <dt className="text-sm font-semibold text-ink-muted">{t("whoCanUse")}</dt>
          <dd>
            <WhoCanUse app={app} t={tApps} />
          </dd>
        </dl>
      </section>
    </main>
  );
}
