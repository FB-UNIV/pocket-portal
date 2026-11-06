import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { categoriesOf, MAX_CATEGORY_LENGTH } from "@/lib/catalog/browse";
import { setAppCategoryAction, setAppHiddenAction } from "./actions";

export const metadata: Metadata = {
  title: "App Catalog",
};

export default async function AdminAppsPage() {
  await requireAdmin("/admin/apps");

  const apps = await listAdminCatalogApps(getPocketIdConfig(), getDb());
  // Offered as suggestions, so "Files" doesn't become "files" on the next app.
  const categories = categoriesOf(apps);

  return (
    <div className="flex flex-col flex-1 items-center">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pt-8 pb-20"
      >
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-ink">
            App Catalog (Admin)
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            This list is your PocketID OIDC clients — add, rename, describe or
            regroup an app in PocketID itself. Here you control whether
            it&rsquo;s shown to users, and which category it&rsquo;s filed under
            on the Apps page. Write descriptions in PocketID as what the app is
            for (&ldquo;Watch films and series&rdquo;): that&rsquo;s the
            headline users see.
          </p>
        </div>

        <datalist id="category-suggestions">
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>

        <ul className="flex flex-col gap-3">
          {apps.map((app) => (
            <li
              key={app.id}
              className="card flex flex-col items-start justify-between gap-4 p-5 lg:flex-row lg:items-center"
            >
              <div className="min-w-0">
                <h2 className="font-medium">{app.name}</h2>
                {app.description && (
                  <p className="text-sm text-ink-muted">{app.description}</p>
                )}
                {!app.launchUrl && (
                  <p className="text-xs font-semibold text-on-tip">
                    No http(s) launch URL set in PocketID — won&rsquo;t be
                    browsable even if shown.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <form
                  action={setAppCategoryAction.bind(null, app.id)}
                  className="flex items-end gap-2"
                >
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
                    {/* The visible label stays short; the accessible name says
                      which app's category this is. */}
                    Category
                    <input
                      name="category"
                      defaultValue={app.category ?? ""}
                      list="category-suggestions"
                      maxLength={MAX_CATEGORY_LENGTH}
                      placeholder="e.g. Watch & listen"
                      aria-label={`Category for ${app.name}`}
                      className="field w-52 font-normal"
                    />
                  </label>
                  <button
                    type="submit"
                    aria-label={`Save category for ${app.name}`}
                    className="btn btn-secondary"
                  >
                    Save
                  </button>
                </form>
                <form
                  action={setAppHiddenAction.bind(null, app.id, !app.hidden)}
                >
                  <button
                    type="submit"
                    // Every row's button reads "Show"/"Hide"; the accessible
                    // name says which app, the visible label stays short.
                    aria-label={`${app.hidden ? "Show" : "Hide"} ${app.name}`}
                    className="btn btn-secondary"
                  >
                    {app.hidden ? "Show" : "Hide"}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
