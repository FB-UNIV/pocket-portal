"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig, listPocketIdGroups } from "@/lib/pocketid/client";
import { createPost, deletePost, updatePost } from "@/lib/news/store";
import { normalizePostInput } from "@/lib/news/posts";
import { addImage, deleteImage, setCover } from "@/lib/news/image-store";
import { MAX_IMAGE_BYTES, checkImage } from "@/lib/news/images";

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

// A picture for a post (#22), checked here whatever the browser said: the
// type from its bytes (PNG, JPEG, WebP, GIF; never SVG), at most 5 MB, and
// stripped of metadata (GPS, camera) before it's stored. The server action
// body limit (next.config.ts) is set just above, for the form's overhead.
export async function uploadImageAction(postId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const back = `/admin/news/${encodeURIComponent(postId)}`;
  const file = formData.get("picture");
  if (!(file instanceof File) || file.size === 0) redirect(`${back}?problem=no_picture`);
  if (file.size > MAX_IMAGE_BYTES) redirect(`${back}?problem=too_big`);

  const image = checkImage(new Uint8Array(await file.arrayBuffer()));
  if (!image.ok) redirect(`${back}?problem=${image.reason}`);
  await addImage(getDb(), postId, image.contentType, image.bytes);
  refresh();
  redirect(`${back}?picture=added`);
}

export async function setCoverAction(postId: string, imageId: string | null): Promise<void> {
  await requireAdmin();
  await setCover(getDb(), postId, imageId);
  refresh();
}

export async function deleteImageAction(postId: string, imageId: string): Promise<void> {
  await requireAdmin();
  await deleteImage(getDb(), postId, imageId);
  refresh();
}
