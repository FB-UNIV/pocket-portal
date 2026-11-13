import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { auditLog, newsPosts } from "@/lib/db/schema";
import { createPost, deletePost, getPost, listAllPosts, listPostsFor, updatePost } from "./store";
import { addImage, getImage, listImages, setCover } from "./image-store";

// Requires a running test Postgres instance: npm run test-env:up.
describe("news posts (integration)", () => {
  let db: Db;
  const ids: string[] = [];
  // Unique per run, so other rows in the shared test database can't match.
  const group = `group-${randomUUID()}`;
  const ADMIN = { subject: "admin-sub", email: "admin@example.test" };
  const input = (overrides: Partial<Parameters<typeof createPost>[1]> = {}) => ({
    title: "Maintenance tonight",
    body: "Back by 10.",
    pinned: false,
    expiresAt: null,
    audienceGroups: [group],
    ...overrides,
  });

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL environment variable is not set");
    db = createDb(url);
  });
  afterAll(() => db.$client.end());
  afterEach(async () => {
    if (!ids.length) return;
    await db.delete(newsPosts).where(inArray(newsPosts.id, ids));
    await db.delete(auditLog).where(inArray(auditLog.targetId, ids));
    ids.length = 0;
  });

  const create = async (overrides = {}) => {
    const id = await createPost(db, input(overrides), ADMIN);
    ids.push(id);
    return id;
  };

  it("creates a post, audits it, and shows it to its audience only", async () => {
    const id = await create();

    expect((await listPostsFor(db, [group], new Date())).map((p) => p.id)).toContain(id);
    expect((await listPostsFor(db, ["someone-else"], new Date())).map((p) => p.id)).not.toContain(id);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.targetId, id));
    expect(audit).toMatchObject({ actorSubject: "admin-sub", action: "news.created", targetType: "news_post" });
  });

  it("leaves out expired posts, and puts pinned ones first", async () => {
    const expired = await create({ title: "Old", expiresAt: new Date(Date.now() - 1000) });
    const plain = await create({ title: "Plain" });
    const pinned = await create({ title: "Pinned", pinned: true });

    const shown = (await listPostsFor(db, [group], new Date())).map((p) => p.id).filter((id) => ids.includes(id));
    expect(shown).toEqual([pinned, plain]);
    expect(shown).not.toContain(expired);
  });

  it("lists every post for admins, expired included", async () => {
    const expired = await create({ expiresAt: new Date(Date.now() - 1000) });

    expect((await listAllPosts(db)).map((p) => p.id)).toContain(expired);
  });

  it("updates and deletes a post, auditing each", async () => {
    const id = await create();

    await updatePost(db, id, input({ title: "Moved to tomorrow" }), ADMIN);
    expect((await getPost(db, id))?.title).toBe("Moved to tomorrow");

    await deletePost(db, id, ADMIN);
    expect(await getPost(db, id)).toBeNull();
    const actions = (await db.select().from(auditLog).where(eq(auditLog.targetId, id))).map((a) => a.action).sort();
    expect(actions).toEqual(["news.created", "news.deleted", "news.updated"]);
  });

  it("records the post's title with each audit event, for History", async () => {
    const id = await create({ title: "Grafana upgrade" });

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, id), eq(auditLog.action, "news.created")));
    expect(audit.metadata).toMatchObject({ title: "Grafana upgrade" });
  });

  // Pictures (#22): kept with their post's visibility, and gone with it.
  it("stores a post's pictures, sets one as its cover, and deletes them with the post", async () => {
    const id = await create();
    const imageId = await addImage(db, id, "image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));

    const image = await getImage(db, imageId);
    expect(image?.contentType).toBe("image/png");
    expect([...image!.bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(image?.post.audienceGroups).toEqual([group]);

    await setCover(db, id, imageId);
    expect((await getPost(db, id))?.coverImageId).toBe(imageId);

    await deletePost(db, id, ADMIN);
    expect(await getImage(db, imageId)).toBeNull();
  });

  it("won't use another post's picture as a cover", async () => {
    const mine = await create();
    const theirs = await create();
    const theirPicture = await addImage(db, theirs, "image/png", Uint8Array.from([1]));

    await setCover(db, mine, theirPicture);

    expect((await getPost(db, mine))?.coverImageId).toBeNull();
    expect((await listImages(db, theirs)).map((i) => i.id)).toEqual([theirPicture]);
  });
});
