import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { getIntegration } from "@/lib/integrations/store";
import { readJellyfinApiKey } from "@/lib/config";
import { getTranslations } from "@/i18n/server";
import { saveJellyfinAction, testJellyfinAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AdminIntegrations");
  return { title: t("title") };
}

// Allowlists for what comes back in the query (user input).
const PROBLEMS = { bad_url: "problemBadUrl", unknown_app: "problemUnknownApp" } as const;
const TEST_DETAILS = { no_key: "testNoKey", not_set_up: "testNotSetUp" } as const;

// Integrations (#23): Jellyfin first. Where it is, which app people must be
// able to open to see it, on or off, and a connection test. The key is
// only ever named here, never shown or edited: it lives in the environment.
export default async function AdminIntegrationsPage({ searchParams }: PageProps<"/admin/integrations">) {
  await requireAdmin("/admin/integrations");
  const [settings, apps, t, query] = await Promise.all([
    getIntegration(getDb(), "jellyfin"),
    listAdminCatalogApps(getPocketIdConfig(), getDb()),
    getTranslations("AdminIntegrations"),
    searchParams,
  ]);
  const hasKey = Boolean(readJellyfinApiKey());
  const problem = typeof query?.problem === "string" && Object.hasOwn(PROBLEMS, query.problem)
    ? t(PROBLEMS[query.problem as keyof typeof PROBLEMS])
    : null;
  const detail = typeof query?.detail === "string" ? query.detail : "";
  const testWords = Object.hasOwn(TEST_DETAILS, detail) ? t(TEST_DETAILS[detail as keyof typeof TEST_DETAILS]) : detail;

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-7">
      <h1 className="text-4xl font-extrabold tracking-tight text-ink">{t("title")}</h1>

      <section aria-labelledby="jellyfin-h" className="card flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h2 id="jellyfin-h" className="text-lg font-bold">
            Jellyfin
          </h2>
          <p className="text-sm text-ink-muted">{t("jellyfinHint")}</p>
        </div>

        {problem ? (
          <p role="alert" className="rounded-xl border border-bad-line bg-bad px-4 py-3 text-sm font-semibold text-on-bad">
            {problem}
          </p>
        ) : null}
        {query?.saved ? (
          <p role="status" className="badge badge-ok self-start">
            {t("saved")}
          </p>
        ) : null}
        {query?.test === "ok" ? (
          <p role="status" className="badge badge-ok self-start">
            {t("testOk", { detail: testWords })}
          </p>
        ) : query?.test === "fail" ? (
          <p role="status" className="rounded-xl border border-bad-line bg-bad px-4 py-3 text-sm font-semibold text-on-bad">
            {t("testFail", { detail: testWords })}
          </p>
        ) : null}

        <p className={`text-sm font-semibold ${hasKey ? "text-on-ok" : "text-on-tip"}`}>
          {hasKey ? t("keySet") : t("keyMissing")}
        </p>

        <form action={saveJellyfinAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="baseUrl" className="font-semibold">
              {t("baseUrlLabel")}
            </label>
            <input
              id="baseUrl"
              name="baseUrl"
              type="url"
              required
              placeholder="https://jellyfin.example.com"
              defaultValue={settings?.baseUrl}
              className="field max-w-md"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="linkedClientId" className="font-semibold">
              {t("linkedLabel")}
            </label>
            <p className="text-sm text-ink-muted">{t("linkedHint")}</p>
            <select id="linkedClientId" name="linkedClientId" defaultValue={settings?.linkedClientId} className="field max-w-md">
              {apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          </div>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? true} />
            {t("enabledLabel")}
          </label>
          <div>
            <button type="submit" className="btn btn-primary">
              {t("save")}
            </button>
          </div>
        </form>

        {settings ? (
          <form action={testJellyfinAction} className="border-t border-line pt-4">
            <button type="submit" className="btn btn-secondary">
              {t("test")}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
