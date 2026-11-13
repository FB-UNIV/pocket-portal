"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { getIntegration, saveIntegration } from "@/lib/integrations/store";
import { createJellyfin } from "@/lib/integrations/jellyfin";
import { readJellyfinApiKey } from "@/lib/config";

// Jellyfin's settings (#23). A form is user input: the address must be a
// plain http(s) URL (no credentials in it, never another scheme), and the
// linked app one PocketID has. The key isn't a field: it comes from the
// environment, so it never passes through a browser or the database.

function baseUrlOf(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export async function saveJellyfinAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const baseUrl = baseUrlOf(formData.get("baseUrl"));
  if (!baseUrl) redirect("/admin/integrations?problem=bad_url");

  const linkedClientId = formData.get("linkedClientId");
  const apps = await listAdminCatalogApps(getPocketIdConfig(), getDb());
  if (typeof linkedClientId !== "string" || !apps.some((a) => a.id === linkedClientId)) {
    redirect("/admin/integrations?problem=unknown_app");
  }

  await saveIntegration(
    getDb(),
    { type: "jellyfin", baseUrl, linkedClientId, enabled: formData.get("enabled") === "on" },
    { subject: session.user.id, email: session.user.email ?? undefined },
  );
  revalidatePath("/");
  revalidatePath("/admin/integrations");
  redirect("/admin/integrations?saved=jellyfin");
}

// Reaches Jellyfin with the saved address and the environment's key, and
// says how it went.
export async function testJellyfinAction(): Promise<void> {
  await requireAdmin();
  const apiKey = readJellyfinApiKey();
  if (!apiKey) redirect("/admin/integrations?test=fail&detail=no_key");
  const settings = await getIntegration(getDb(), "jellyfin");
  if (!settings) redirect("/admin/integrations?test=fail&detail=not_set_up");

  const result = await createJellyfin({ baseUrl: settings.baseUrl, apiKey }).testConnection();
  const query = new URLSearchParams({ test: result.ok ? "ok" : "fail", detail: result.detail });
  redirect(`/admin/integrations?${query.toString().replaceAll("+", "%20")}`);
}
