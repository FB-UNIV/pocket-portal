"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/db/client";
import { dismissChecklist, setItemTicked } from "@/lib/onboarding/store";
import { SELF_TICKED_ITEMS } from "@/lib/onboarding/checklist";

// The welcome checklist's buttons (#21), for the signed-in person only.

// Only items the person does outside the portal can be ticked by hand;
// the rest follow real state, and a form (a callable endpoint) can't
// override that.
export async function tickChecklistItemAction(item: string, ticked: boolean): Promise<void> {
  const session = await requireUser();
  if (!(SELF_TICKED_ITEMS as readonly string[]).includes(item)) return;
  await setItemTicked(getDb(), session.user.id, item, ticked);
  revalidatePath("/");
}

export async function dismissChecklistAction(): Promise<void> {
  const session = await requireUser();
  await dismissChecklist(getDb(), session.user.id);
  revalidatePath("/");
}
