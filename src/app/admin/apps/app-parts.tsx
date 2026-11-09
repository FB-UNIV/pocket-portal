import type { CatalogApp } from "@/lib/catalog/apps";
import { appProblems, PROBLEM_LABELS } from "@/lib/catalog/health";
import { setAppHiddenAction } from "./actions";

// Shown/hidden as an on/off switch. A plain form, so it works before
// hydration; role="switch" with aria-checked tells a screen reader its
// state, and the name says which app it is for.
export function ShownSwitch({ app }: { app: Pick<CatalogApp, "id" | "name" | "hidden"> }) {
  return (
    <form action={setAppHiddenAction.bind(null, app.id, !app.hidden)} className="flex">
      <button
        type="submit"
        role="switch"
        aria-checked={!app.hidden}
        aria-label={`Show ${app.name} on the Apps page`}
        className="switch"
      />
    </form>
  );
}

// Who PocketID lets in. Group names are fine here: only admins see them.
export function WhoCanUse({
  app,
}: {
  app: Pick<CatalogApp, "isGroupRestricted" | "allowedGroups">;
}) {
  if (!app.isGroupRestricted) return <span className="text-ink-muted">Everyone</span>;
  if (app.allowedGroups.length === 0) return <span className="text-ink-muted">Nobody yet</span>;
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

// "Ready", or each thing to fix in PocketID. Text first; colour only backs it.
export function HealthBadges({ app }: { app: Pick<CatalogApp, "launchUrl" | "description"> }) {
  const problems = appProblems(app);
  if (problems.length === 0) return <span className="badge badge-ok">Ready</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {problems.map((problem) => (
        <span key={problem} className="badge badge-tip">
          {PROBLEM_LABELS[problem]}
        </span>
      ))}
    </span>
  );
}
