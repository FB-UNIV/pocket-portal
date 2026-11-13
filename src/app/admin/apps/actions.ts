"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps, setAppCategory, setAppHidden } from "@/lib/catalog/apps";
import { addDependency, removeDependency } from "@/lib/catalog/dependencies";
import { normalizeCategory } from "@/lib/catalog/browse";

export async function setAppHiddenAction(pocketIdClientId: string, hidden: boolean) {
  await requireAdmin();
  await setAppHidden(getDb(), pocketIdClientId, hidden);
  // "layout" covers each app's own page under it too.
  revalidatePath("/admin/apps", "layout");
}

// The admin list's category field. Blank clears it; anything else is
// normalised (trimmed, at most 40 characters) before it's stored.
export async function setAppCategoryAction(pocketIdClientId: string, formData: FormData) {
  await requireAdmin();
  const raw = formData.get("category");
  await setAppCategory(
    getDb(),
    pocketIdClientId,
    normalizeCategory(typeof raw === "string" ? raw : null),
  );
  // "layout" covers each app's own page under it too.
  revalidatePath("/admin/apps", "layout");
  revalidatePath("/apps");
}

// ADR-0012: an app needs another one (Grafana needs the VPN). Both must be
// PocketID clients: a form is user input, so an id that isn't one is
// refused. Their names go into the audit event, so History can say which
// apps even after they're renamed. A refused link comes back to the app's
// page saying why (`?refused=`), which works without JavaScript.
export async function addAppDependencyAction(pocketIdClientId: string, formData: FormData) {
  const session = await requireAdmin();
  const requires = formData.get("requires");
  if (typeof requires !== "string" || !requires) return;

  const db = getDb();
  const apps = await listAdminCatalogApps(getPocketIdConfig(), db);
  const app = apps.find((a) => a.id === pocketIdClientId);
  const prerequisite = apps.find((a) => a.id === requires);
  const back = `/admin/apps/${encodeURIComponent(pocketIdClientId)}`;
  if (!app || !prerequisite) redirect(`${back}?refused=unknown_app`);

  const result = await addDependency(
    db,
    pocketIdClientId,
    requires,
    { subject: session.user.id, email: session.user.email ?? undefined },
    { appName: app.name, requiresName: prerequisite.name },
  );
  revalidatePath("/admin/apps", "layout");
  revalidatePath("/apps");
  if (!result.ok) redirect(`${back}?refused=${result.reason}`);
}

export async function removeAppDependencyAction(pocketIdClientId: string, requiresId: string) {
  const session = await requireAdmin();
  const db = getDb();
  const apps = await listAdminCatalogApps(getPocketIdConfig(), db);
  await removeDependency(
    db,
    pocketIdClientId,
    requiresId,
    { subject: session.user.id, email: session.user.email ?? undefined },
    {
      appName: apps.find((a) => a.id === pocketIdClientId)?.name,
      requiresName: apps.find((a) => a.id === requiresId)?.name,
    },
  );
  revalidatePath("/admin/apps", "layout");
  revalidatePath("/apps");
}
