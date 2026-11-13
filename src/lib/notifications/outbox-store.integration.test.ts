import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { notificationOutbox } from "@/lib/db/schema";
import { createOutboxStore } from "./outbox-store";

// Requires a running test Postgres instance: npm run test-env:up
// (migrations run once via vitest.integration.global-setup.ts).

describe("notification outbox store (integration)", () => {
  let db: Db;
  let other: Db;
  const requestIds: string[] = [];

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL environment variable is not set");
    db = createDb(url);
    // A second pool, standing in for a second replica.
    other = createDb(url);
  });

  afterAll(async () => {
    await db.$client.end();
    await other.$client.end();
  });

  afterEach(async () => {
    if (requestIds.length) {
      await db.delete(notificationOutbox).where(inArray(notificationOutbox.requestId, requestIds));
      requestIds.length = 0;
    }
  });

  async function queue(count = 1) {
    const requestId: string = randomUUID();
    requestIds.push(requestId);
    await createOutboxStore(db).enqueue(
      Array.from({ length: count }, (_, i) => ({
        kind: "new_request" as const,
        requestId,
        toEmail: `admin${i}@example.test`,
        subject: "New request",
        body: "Body\n",
        pocketIdGroupName: "engineering",
      })),
    );
    return requestId;
  }

  const mine = <T extends { requestId: string }>(rows: T[], requestId: string) =>
    rows.filter((r) => r.requestId === requestId);

  it("claims a queued email once, counting the attempt, and leases it", async () => {
    const requestId = await queue();
    const store = createOutboxStore(db);

    const first = mine(await store.claimDue(10, 60), requestId);
    const again = mine(await store.claimDue(10, 60), requestId);

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ toEmail: "admin0@example.test", attempts: 1, pocketIdGroupName: "engineering" });
    expect(again).toEqual([]);
  });

  // FOR UPDATE SKIP LOCKED: two replicas claiming at the same moment never
  // get the same row.
  it("never hands the same email to two replicas", async () => {
    const requestId = await queue(20);

    const [a, b] = await Promise.all([
      createOutboxStore(db).claimDue(20, 60),
      createOutboxStore(other).claimDue(20, 60),
    ]);
    const ids = [...mine(a, requestId), ...mine(b, requestId)].map((r) => r.id);

    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  // A replica that died mid-send: its lease runs out, and the email is
  // claimed again.
  it("reclaims an email whose lease has run out", async () => {
    const requestId = await queue();
    const store = createOutboxStore(db);
    await store.claimDue(10, 60);

    await db
      .update(notificationOutbox)
      .set({ lockedUntil: sql`now() - interval '1 second'` })
      .where(inArray(notificationOutbox.requestId, [requestId]));

    const reclaimed = mine(await store.claimDue(10, 60), requestId);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].attempts).toBe(2);
  });

  it("holds a retry until it's due", async () => {
    const requestId = await queue();
    const store = createOutboxStore(db);
    const [claimed] = mine(await store.claimDue(10, 60), requestId);

    await store.markRetry(claimed.id, new Date(Date.now() + 60_000), "421 try later");
    expect(mine(await store.claimDue(10, 60), requestId)).toEqual([]);

    await store.markRetry(claimed.id, new Date(Date.now() - 1000), "421 try later");
    expect(mine(await store.claimDue(10, 60), requestId)).toHaveLength(1);
  });

  it("never claims a sent or failed email again", async () => {
    const sentId = await queue();
    const failedId = await queue();
    const store = createOutboxStore(db);
    for (const row of await store.claimDue(10, 60)) {
      if (row.requestId === sentId) await store.markSent(row.id);
      if (row.requestId === failedId) await store.markFailed(row.id, "550");
    }
    await db
      .update(notificationOutbox)
      .set({ lockedUntil: null, nextAttemptAt: sql`now() - interval '1 second'` })
      .where(inArray(notificationOutbox.requestId, [sentId, failedId]));

    const claimed = await store.claimDue(10, 60);
    expect([...mine(claimed, sentId), ...mine(claimed, failedId)]).toEqual([]);
  });

  // It holds addresses and request messages: no longer than needed.
  it("prunes sent emails after 7 days and failed ones after 30", async () => {
    const oldSent = await queue();
    const recentSent = await queue();
    const oldFailed = await queue();
    const store = createOutboxStore(db);
    for (const row of await store.claimDue(10, 60)) {
      if ([oldSent, recentSent].includes(row.requestId)) await store.markSent(row.id);
      if (row.requestId === oldFailed) await store.markFailed(row.id, "550");
    }
    await db
      .update(notificationOutbox)
      .set({ updatedAt: sql`now() - interval '8 days'` })
      .where(inArray(notificationOutbox.requestId, [oldSent]));
    await db
      .update(notificationOutbox)
      .set({ updatedAt: sql`now() - interval '31 days'` })
      .where(inArray(notificationOutbox.requestId, [oldFailed]));

    await store.prune();

    const left = await db
      .select({ requestId: notificationOutbox.requestId })
      .from(notificationOutbox)
      .where(inArray(notificationOutbox.requestId, [oldSent, recentSent, oldFailed]));
    expect(left.map((r) => r.requestId)).toEqual([recentSent]);
  });
});
