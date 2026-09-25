"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { setAppHidden } from "@/lib/catalog/apps";

export async function setAppHiddenAction(pocketIdClientId: string, hidden: boolean) {
  await requireAdmin();
  await setAppHidden(getDb(), pocketIdClientId, hidden);
  revalidatePath("/admin/apps");
}
