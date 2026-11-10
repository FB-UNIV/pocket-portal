import type { CatalogApp } from "@/lib/catalog/apps";
import type { getTranslations } from "@/i18n/server";
import { setAppHiddenAction } from "./actions";

// The catalog pages' translator, passed in rather than awaited here: these
// parts render inside list rows, and staying synchronous keeps them (and the
// pages that use them) simple to render and test.
export type AdminAppsT = Awaited<ReturnType<typeof getTranslations<"AdminApps">>>;

// Shown/hidden as an on/off switch. A plain form, so it works before
// hydration; role="switch" with aria-checked tells a screen reader its
// state, and the name says which app it is for.
export function ShownSwitch({
  app,
  t,
}: {
  app: Pick<CatalogApp, "id" | "name" | "hidden">;
  t: AdminAppsT;
}) {
  return (
    <form action={setAppHiddenAction.bind(null, app.id, !app.hidden)} className="flex">
      <button
        type="submit"
        role="switch"
        aria-checked={!app.hidden}
        aria-label={t("showOn", { app: app.name })}
        className="switch"
      />
    </form>
  );
}

// Who PocketID lets in. Group names are fine here: only admins see them.
export function WhoCanUse({
  app,
  t,
}: {
  app: Pick<CatalogApp, "isGroupRestricted" | "allowedGroups">;
  t: AdminAppsT;
}) {
  if (!app.isGroupRestricted) return <span className="text-ink-muted">{t("everyone")}</span>;
  if (app.allowedGroups.length === 0) return <span className="text-ink-muted">{t("nobody")}</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {app.allowedGroups.map((group) => (
        <li key={group.id} className="badge">
          {group.friendlyName || group.name}
        </li>
      ))}
    </ul>
  );
}
