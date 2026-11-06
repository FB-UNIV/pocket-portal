import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { setAppHiddenAction } from "./actions";

export const metadata: Metadata = {
  title: "App Catalog",
};

export default async function AdminAppsPage() {
  await requireAdmin("/admin/apps");

  const apps = await listAdminCatalogApps(getPocketIdConfig(), getDb());

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
            This list is your PocketID OIDC clients — add, rename, or regroup an
            app in PocketID itself. Here you only control whether it&rsquo;s shown to
            users browsing the catalog.
          </p>
        </div>

        <ul className="flex flex-col gap-3">
          {apps.map((app) => (
            <li
              key={app.id}
              className="flex flex-col items-start justify-between gap-4 card p-4 sm:flex-row sm:items-center"
            >
              <div>
                <h2 className="font-medium">{app.name}</h2>
                {app.description && (
                  <p className="text-sm text-ink-muted">{app.description}</p>
                )}
                {!app.launchUrl && (
                  // amber-600 on white is 3.19:1 — below the 4.5:1 that SC
                  // 1.4.3 wants for text this size. amber-700 is 5.02:1.
                  <p className="text-xs text-on-tip">
                    No http(s) launch URL set in PocketID — won&rsquo;t be browsable even if shown.
                  </p>
                )}
              </div>
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
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
