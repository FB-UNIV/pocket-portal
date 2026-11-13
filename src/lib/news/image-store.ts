import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { newsImages, newsPosts } from "@/lib/db/schema";
import type { NewsPost } from "./posts";

// News pictures in Postgres (#22). Bytes arrive already checked and
// stripped (lib/news/images.ts); this only stores and finds them.

export interface StoredImage {
  contentType: string;
  bytes: Buffer;
  // What decides who may see it: the post's own visibility.
  post: Pick<NewsPost, "publishedAt" | "expiresAt" | "audienceGroups">;
}

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
export async function addImage(db: Db, postId: string, contentType: string, bytes: Uint8Array): Promise<string> {
  const [image] = await db
    .insert(newsImages)
    .values({ postId, contentType, bytes: Buffer.from(bytes) })
    .returning({ id: newsImages.id });
  return image.id;
}

export async function getImage(db: Db, id: string): Promise<StoredImage | null> {
  const [row] = await db
    .select({
      contentType: newsImages.contentType,
      bytes: newsImages.bytes,
      publishedAt: newsPosts.publishedAt,
      expiresAt: newsPosts.expiresAt,
      audienceGroups: newsPosts.audienceGroups,
    })
    .from(newsImages)
    .innerJoin(newsPosts, eq(newsImages.postId, newsPosts.id))
    .where(eq(newsImages.id, id));
  if (!row) return null;
  const { contentType, bytes, ...post } = row;
  return { contentType, bytes, post };
}

// A post's pictures, newest first, without their bytes.
export async function listImages(db: Db, postId: string): Promise<{ id: string; contentType: string }[]> {
  return db
    .select({ id: newsImages.id, contentType: newsImages.contentType })
    .from(newsImages)
    .where(eq(newsImages.postId, postId))
    .orderBy(desc(newsImages.createdAt));
}

// Only a picture of this post (the cover is cleared by its foreign key).
export async function deleteImage(db: Db, postId: string, imageId: string): Promise<void> {
  await db.delete(newsImages).where(and(eq(newsImages.id, imageId), eq(newsImages.postId, postId)));
}

// The cover must be one of the post's own pictures; null clears it.
export async function setCover(db: Db, postId: string, imageId: string | null): Promise<void> {
  if (imageId) {
    const [own] = await db
      .select({ id: newsImages.id })
      .from(newsImages)
      .where(and(eq(newsImages.id, imageId), eq(newsImages.postId, postId)));
    if (!own) return;
  }
  await db.update(newsPosts).set({ coverImageId: imageId }).where(eq(newsPosts.id, postId));
}
/* v8 ignore stop */
