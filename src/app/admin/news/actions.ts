"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig, listPocketIdGroups } from "@/lib/pocketid/client";
import { createPost, deletePost, updatePost } from "@/lib/news/store";
import { normalizePostInput } from "@/lib/news/posts";

// News posts (#22): admins only, every field checked (a form is user
// input; the audience must be PocketID's own groups), every change audited
// by lib/news/store. A problem comes back to the form as ?problem=, which
// works without JavaScript.

async function checked(formData: FormData) {
  const groups = await listPocketIdGroups(getPocketIdConfig());
  return normalizePostInput(
    formData,
    groups.map((group) => group.name),
  );
}

function refresh() {
  revalidatePath("/");
  revalidatePath("/news");
  revalidatePath("/admin/news", "layout");
}

export async function createPostAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const input = await checked(formData);
  if (!input.ok) redirect(`/admin/news/new?problem=${input.reason}`);
  const id = await createPost(getDb(), input.value, { subject: session.user.id, email: session.user.email ?? undefined });
  refresh();
  redirect(`/admin/news/${id}?saved=1`);
}

export async function updatePostAction(id: string, formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const back = `/admin/news/${encodeURIComponent(id)}`;
  const input = await checked(formData);
  if (!input.ok) redirect(`${back}?problem=${input.reason}`);
  await updatePost(getDb(), id, input.value, { subject: session.user.id, email: session.user.email ?? undefined });
  refresh();
  redirect(`${back}?saved=1`);
}

export async function deletePostAction(id: string): Promise<void> {
  const session = await requireAdmin();
  await deletePost(getDb(), id, { subject: session.user.id, email: session.user.email ?? undefined });
  refresh();
  redirect("/admin/news");
}
