"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { setAppCategory, setAppHidden } from "@/lib/catalog/apps";
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
