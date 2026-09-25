import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { accessRequests, auditLog } from "@/lib/db/schema";
import { countRecentRequestEvents, listAuditEvents, writeAuditEvent } from "./log";

// Requires a running test Postgres instance: npm run test-env:up
// See docker-compose.test.yml / .env.test. Migrations run once for the
// whole integration suite via vitest.integration.global-setup.ts, not here.

describe("writeAuditEvent (integration)", () => {
  let db: Db;

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    db = createDb(connectionString);
  });

  afterAll(async () => {
    try {
      await db.delete(auditLog).where(eq(auditLog.actorSubject, "test-user-sub"));
    } finally {
      // Close the pool even if cleanup fails, or its sockets keep the test
      // process alive past the run.
      await db.$client.end();
    }
  });

  it("persists an audit event and it can be read back", async () => {
    await writeAuditEvent(db, {
      actorSubject: "test-user-sub",
      actorEmail: "test@example.com",
      action: "login",
      metadata: { method: "oidc" },
    });

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorSubject, "test-user-sub"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorSubject: "test-user-sub",
      actorEmail: "test@example.com",
      action: "login",
      metadata: { method: "oidc" },
    });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("allows optional fields to be omitted", async () => {
    await writeAuditEvent(db, {
      actorSubject: "test-user-sub",
      action: "access_request.created",
      targetType: "group",
      targetId: "homelab-media",
    });

    // Scoped to this suite's actor, matching what afterAll cleans up: the
    // table is shared, so an unscoped query picks up any other
    // access_request.created row -- including one left by clicking through
    // the running app against the same test database.
    const rows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "access_request.created"),
          eq(auditLog.actorSubject, "test-user-sub"),
        ),
      );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].actorEmail).toBeNull();
  });
});

describe("listAuditEvents (integration)", () => {
  let db: Db;
  // The table is shared with every other suite and never cleaned wholesale,
  // so each run filters on an action name only it writes.
  const ACTION = `test.list-audit.${crypto.randomUUID()}`;
  const ACTOR = "test-list-audit-sub";
  let requestId: string;

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    const [request] = await db
      .insert(accessRequests)
      .values({
        requesterSubject: "test-list-audit-requester",
        requesterEmail: "requester@example.test",
        pocketIdClientId: "test-list-audit-client",
        pocketIdGroupId: "test-list-audit-group",
        pocketIdGroupName: "test-list-audit-group",
      })
      .returning();
    requestId = request.id;

    // Five events, all in one statement so they share a created_at: ordering
    // then rests entirely on the id tie-break, the case a timestamp-only
    // cursor gets wrong.
    await db.insert(auditLog).values(
      Array.from({ length: 5 }, (_, i) => ({
        actorSubject: ACTOR,
        action: ACTION,
        targetType: i === 0 ? "access_request" : undefined,
        targetId: i === 0 ? requestId : undefined,
        metadata: { n: i },
      })),
    );
  });

  afterAll(async () => {
    try {
      await db.delete(auditLog).where(eq(auditLog.actorSubject, ACTOR));
      await db.delete(accessRequests).where(eq(accessRequests.id, requestId));
    } finally {
      await db.$client.end();
    }
  });

  it("pages through every event exactly once, newest first", async () => {
    const seen: string[] = [];
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const { entries, nextCursor } = await listAuditEvents(db, { action: ACTION, before, limit: 2 });
      seen.push(...entries.map((e) => e.id));
      if (!nextCursor) break;
      before = nextCursor;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("says there is nothing older on the last page", async () => {
    const { entries, nextCursor } = await listAuditEvents(db, { action: ACTION, limit: 5 });

    expect(entries).toHaveLength(5);
    expect(nextCursor).toBeNull();
  });

  it("joins the requester's email for an access-request event", async () => {
    const { entries } = await listAuditEvents(db, { action: ACTION, limit: 5 });

    const linked = entries.find((e) => e.targetId === requestId);
    expect(linked?.requesterEmail).toBe("requester@example.test");
    expect(entries.filter((e) => e.targetId !== requestId).every((e) => e.requesterEmail === null)).toBe(
      true,
    );
  });

  it("only returns the filtered action", async () => {
    const { entries } = await listAuditEvents(db, { action: ACTION, limit: 50 });

    expect(entries.every((e) => e.action === ACTION)).toBe(true);
  });
});

describe("countRecentRequestEvents (integration)", () => {
  let db: Db;
  const ACTOR = `test-rate-limit-${crypto.randomUUID()}`;

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    const event = (action: string) => ({ actorSubject: ACTOR, action });
    await db.insert(auditLog).values([
      event("access_request.created"),
      event("access_request.reopened"),
      // Not a submission: an admin's decision on the same subject's row.
      event("access_request.approved"),
    ]);
  });

  afterAll(async () => {
    try {
      await db.delete(auditLog).where(eq(auditLog.actorSubject, ACTOR));
    } finally {
      await db.$client.end();
    }
  });

  it("counts the user's submissions, new and reopened, since a time", async () => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    await expect(countRecentRequestEvents(db, ACTOR, hourAgo)).resolves.toBe(2);
  });

  it("ignores older submissions", async () => {
    await expect(countRecentRequestEvents(db, ACTOR, new Date(Date.now() + 60_000))).resolves.toBe(0);
  });
});
