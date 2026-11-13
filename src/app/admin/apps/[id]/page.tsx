import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { categoriesOf, MAX_CATEGORY_LENGTH } from "@/lib/catalog/browse";
import { pocketIdClientUrl } from "../pocketid-url";
import { AppMark } from "@/app/_components/app-mark";
import { addAppDependencyAction, removeAppDependencyAction, setAppCategoryAction } from "../actions";
import { ShownSwitch, WhoCanUse } from "../app-parts";
import { getLocale, getTranslations } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AdminApp");
  return { title: t("title") };
}

// One app: what the portal sets (shown, category) next to what PocketID
// owns (name, description, link, groups; ADR-0007), which is read-only here
// and links out to PocketID's own page for the client.
// Why a link was refused (?refused=, from addAppDependencyAction). An
// allowlist: the query is user input.
const REFUSALS = {
  self: "refusedSelf",
  prerequisite_needs_another: "refusedPrerequisiteNeedsAnother",
  app_is_a_prerequisite: "refusedAppIsAPrerequisite",
  unknown_app: "refusedUnknownApp",
} as const;

export default async function AdminAppPage({ params, searchParams }: PageProps<"/admin/apps/[id]">) {
  const { id } = await params;
  await requireAdmin(`/admin/apps/${encodeURIComponent(id)}`);

  const [apps, t, tApps, locale, query] = await Promise.all([
    listAdminCatalogApps(getPocketIdConfig(), getDb()),
    getTranslations("AdminApp"),
    getTranslations("AdminApps"),
    getLocale(),
    searchParams,
  ]);
  const app = apps.find((a) => a.id === id);
  if (!app) notFound();

  const categories = categoriesOf(apps);
  const pocketIdUrl = pocketIdClientUrl(app.id);

  const listed = !app.hidden && Boolean(app.launchUrl);
  const state = app.hidden ? "stateHidden" : app.launchUrl ? "stateListed" : "stateNoLink";
  const description = app.description.trim();

  // ADR-0012, one level deep: an app other apps need can't need one itself,
  // and it can only need apps that don't need one. Hidden and link-less
  // apps count (a VPN usually is both).
  const neededBy = apps.filter((other) => other.requires.some((r) => r.id === app.id));
  const candidates = apps.filter(
    (other) => other.id !== app.id && other.requires.length === 0 && !app.requires.some((r) => r.id === other.id),
  );
  const refused = typeof query?.refused === "string" && Object.hasOwn(REFUSALS, query.refused)
    ? REFUSALS[query.refused as keyof typeof REFUSALS]
    : null;
  const names = (list: { name: string }[]) =>
    new Intl.ListFormat(locale, { type: "conjunction" }).format(list.map((a) => a.name));

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/apps"
          className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {t("back")}
        </Link>
        <div className="flex items-center gap-4">
          <AppMark name={app.name} iconUrl={app.iconUrl} />
          <h1 className="text-3xl font-extrabold tracking-tight text-ink break-words sm:text-4xl">{app.name}</h1>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_28rem] flex-col gap-6">
          <section aria-labelledby="on-apps-page" className="card flex flex-col gap-5 p-6">
            <h2 id="on-apps-page" className="text-lg font-bold">
              {t("onAppsPage")}
            </h2>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold">{t("showLabel")}</p>
                <p
                  className={`text-sm ${
                    state === "stateListed" ? "text-on-ok" : state === "stateNoLink" ? "text-on-tip" : "text-ink-muted"
                  }`}
                >
                  {t(state)}
                </p>
              </div>
              <ShownSwitch app={app} t={tApps} />
            </div>

            <div className="flex flex-col gap-2.5 border-t border-line pt-5">
              <label htmlFor="category" className="font-semibold">
                {t("categoryLabel")}
              </label>
              <p id="category-hint" className="text-sm text-ink-muted">
                {t("categoryHint")}
              </p>
              {categories.length > 0 ? (
                // One click files it under a heading already in use, so
                // "Files" doesn't become "files" on the next app. Each pick is
                // its own form, so it works before (or without) JavaScript.
                <div role="group" aria-label={t("categoryPicks")} className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <form key={category} action={setAppCategoryAction.bind(null, app.id)}>
                      <input type="hidden" name="category" value={category} />
                      <button
                        type="submit"
                        aria-pressed={category === app.category}
                        className="chip cursor-pointer aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ground"
                      >
                        {category}
                      </button>
                    </form>
                  ))}
                </div>
              ) : null}
              <form action={setAppCategoryAction.bind(null, app.id)} className="flex flex-wrap gap-2">
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
                <datalist id="category-suggestions">
                  {categories.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </form>
            </div>
          </section>

          <section aria-labelledby="needs" className="card flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-1">
              <h2 id="needs" className="text-lg font-bold">
                {t("needsHeading")}
              </h2>
              <p className="text-sm text-ink-muted">{t("needsHint")}</p>
            </div>
            {refused ? (
              <p role="alert" className="rounded-xl border border-bad-line bg-bad px-4 py-3 text-sm font-semibold text-on-bad">
                {t(refused)}
              </p>
            ) : null}
            {neededBy.length > 0 ? (
              <p className="text-[15px]">{t("neededBy", { names: names(neededBy), count: neededBy.length })}</p>
            ) : (
              <>
                {app.requires.length === 0 ? (
                  <p className="text-[15px] text-ink-muted">{t("needsNothing")}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line">
                    {app.requires.map((prerequisite) => (
                      <li key={prerequisite.id} className="flex items-center justify-between gap-4 py-2.5">
                        <span className="font-semibold">{prerequisite.name}</span>
                        <form action={removeAppDependencyAction.bind(null, app.id, prerequisite.id)}>
                          <button
                            type="submit"
                            aria-label={t("needsRemoveApp", { name: prerequisite.name })}
                            className="btn btn-secondary"
                          >
                            {t("needsRemove")}
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                {candidates.length > 0 ? (
                  <form action={addAppDependencyAction.bind(null, app.id)} className="flex flex-wrap items-end gap-2">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="requires" className="text-sm font-semibold">
                        {t("needsAddLabel")}
                      </label>
                      <select id="requires" name="requires" className="field max-w-xs">
                        {candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" className="btn btn-primary">
                      {t("needsAdd")}
                    </button>
                  </form>
                ) : (
                  <p className="text-sm text-ink-muted">{t("needsNoCandidates")}</p>
                )}
              </>
            )}
          </section>

          <section aria-labelledby="in-pocketid" className="card flex flex-col px-6 pt-4 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
              <h2 id="in-pocketid" className="text-lg font-bold">
                {t("inPocketId")}
              </h2>
              {pocketIdUrl ? (
                <a href={pocketIdUrl} className="btn btn-secondary">
                  {t("openInPocketId")}
                </a>
              ) : null}
            </div>
            <ul className="divide-y divide-line">
              <Check ok={Boolean(description)} label={t("whatFor")}>
                {description ? t("quoted", { text: description }) : t("missingDescription")}
              </Check>
              <Check ok={Boolean(app.launchUrl)} label={t("whereOpens")}>
                {app.launchUrl ? <span className="break-all">{app.launchUrl}</span> : t("missingLink")}
              </Check>
              <Check ok label={t("whoCanUse")}>
                <WhoCanUse app={app} t={tApps} />
              </Check>
            </ul>
          </section>
        </div>

        {/* The card as the Apps page draws it, faded while nobody sees it. */}
        <aside aria-labelledby="preview" className="flex flex-[0_1_21rem] flex-col gap-3 max-lg:basis-full lg:sticky lg:top-6">
          <h2 id="preview" className="text-sm font-bold tracking-wide text-ink-muted uppercase">
            {t("preview")}
          </h2>
          <div className={`card flex flex-col gap-4 p-6 ${listed ? "" : "opacity-50"}`}>
            <AppMark name={app.name} iconUrl={app.iconUrl} />
            <div className="flex flex-col gap-1">
              <p className="text-xl leading-tight font-extrabold tracking-tight">{description || app.name}</p>
              {description ? <p className="text-sm font-semibold text-ink-muted">{app.name}</p> : null}
            </div>
          </div>
          <p className="text-sm text-ink-muted">
            {listed
              ? t("previewUnder", { category: app.category ?? tApps("otherCategory") })
              : t("previewOff")}
          </p>
        </aside>
      </div>
    </main>
  );
}

// One line of what PocketID holds: a check when it's there, an exclamation
// mark when it's missing. The words say which; the mark only backs them.
function Check({ ok, label, children }: { ok: boolean; label: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-x-3 gap-y-1 py-4">
      <span
        aria-hidden="true"
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-extrabold ${
          ok ? "bg-ok text-on-ok" : "bg-tip text-on-tip"
        }`}
      >
        {ok ? "✓" : "!"}
      </span>
      <p className="self-center font-semibold">{label}</p>
      <div className={`col-start-2 text-sm ${ok ? "text-ink-muted" : "text-on-tip"}`}>{children}</div>
    </li>
  );
}
