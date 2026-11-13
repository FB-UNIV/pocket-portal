import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { newsPosts } from "@/lib/db/schema";
import { writeAuditEvent } from "@/lib/audit/log";
import type { NewsPost, PostInput } from "./posts";

// News posts in Postgres (#22). Visibility is decided here, in SQL, the same
// way lib/news/posts.ts's isVisibleTo says: a post for other groups never
// leaves the database for this person. Every change is audited, with the
// post's title, so History can name it.

export interface Actor {
  subject: string;
  email?: string;
}

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
export async function listPostsFor(db: Db, userGroups: string[], now: Date, limit = 50): Promise<NewsPost[]> {
  // For everyone, or for one of their groups: each group a parameter of
  // its own, so a group name is never part of the SQL text.
  const forEveryone = sql`${newsPosts.audienceGroups} = '[]'::jsonb`;
  const forThem =
    userGroups.length > 0
      ? or(forEveryone, sql`${newsPosts.audienceGroups} ?| array[${sql.join(userGroups.map((g) => sql`${g}`), sql`, `)}]::text[]`)
      : forEveryone;
  return db
    .select()
    .from(newsPosts)
    .where(
      and(lte(newsPosts.publishedAt, now), or(isNull(newsPosts.expiresAt), gt(newsPosts.expiresAt, now)), forThem),
    )
    .orderBy(desc(newsPosts.pinned), desc(newsPosts.publishedAt))
    .limit(limit);
}

// Admins see every post, expired and future ones too.
export async function listAllPosts(db: Db): Promise<NewsPost[]> {
  return db.select().from(newsPosts).orderBy(desc(newsPosts.publishedAt));
}

export async function getPost(db: Db, id: string): Promise<NewsPost | null> {
  const [post] = await db.select().from(newsPosts).where(eq(newsPosts.id, id));
  return post ?? null;
}

const audit = (actor: Actor, action: string, id: string, title: string) => ({
  actorSubject: actor.subject,
  actorEmail: actor.email,
  action,
  targetType: "news_post",
  targetId: id,
  metadata: { title },
});

export async function createPost(db: Db, input: PostInput, actor: Actor): Promise<string> {
  return db.transaction(async (tx) => {
    const [post] = await tx
      .insert(newsPosts)
      .values({ ...input, authorSubject: actor.subject })
      .returning({ id: newsPosts.id });
    await writeAuditEvent(tx, audit(actor, "news.created", post.id, input.title));
    return post.id;
  });
}

export async function updatePost(db: Db, id: string, input: PostInput, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(newsPosts)
      .set({ ...input, updatedAt: sql`now()` })
      .where(eq(newsPosts.id, id))
      .returning({ id: newsPosts.id });
    if (updated.length > 0) await writeAuditEvent(tx, audit(actor, "news.updated", id, input.title));
  });
}

export async function deletePost(db: Db, id: string, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const [removed] = await tx.delete(newsPosts).where(eq(newsPosts.id, id)).returning({ title: newsPosts.title });
    if (removed) await writeAuditEvent(tx, audit(actor, "news.deleted", id, removed.title));
  });
}
/* v8 ignore stop */
