import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { auditLog, newsPosts } from "@/lib/db/schema";
import { createPost, deletePost, getPost, listAllPosts, listPostsFor, updatePost } from "./store";

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
});
