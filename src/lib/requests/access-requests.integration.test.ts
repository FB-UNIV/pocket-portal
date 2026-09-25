import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { accessRequests } from "@/lib/db/schema";
import {
  createAccessRequest,
  getAccessRequestById,
  reopenAccessRequest,
  hasPendingAccessRequests,
  listPendingAccessRequests,
  listUserAccessRequests,
  setAccessRequestStatus,
} from "./access-requests";

// Requires a running test Postgres instance: npm run test-env:up
// Migrations run once for the whole integration suite via
// vitest.integration.global-setup.ts, not here.

describe("access requests (integration)", () => {
  let db: Db;

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    db = createDb(connectionString);
  });


  // Close the pool, or its open sockets keep the test process alive past
  // the run ("something prevents ... from exiting").
  afterAll(() => db.$client.end());
  afterEach(async () => {
    await db.delete(accessRequests).where(eq(accessRequests.requesterSubject, "test-user-sub"));
  });

  it("creates a pending access request", async () => {
    const request = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      requesterEmail: "test@example.com",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    expect(request.status).toBe("pending");
    expect(request.pocketIdGroupName).toBe("engineering");

    const rows = await db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.requesterSubject, "test-user-sub"));
    expect(rows).toHaveLength(1);
  });

  it("allows requesterEmail to be omitted", async () => {
    const request = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    expect(request.requesterEmail).toBeNull();
  });

  it("persists an optional message and returns it", async () => {
    const request = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
      message: "I need this to triage on-call alerts.",
    });

    expect(request.message).toBe("I need this to triage on-call alerts.");
  });

  it("defaults message to null when omitted", async () => {
    const request = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    expect(request.message).toBeNull();
  });

  it("is idempotent: a second request for the same requester+client+group returns the existing pending row", async () => {
    const first = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    const second = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    expect(second.id).toBe(first.id);

    const rows = await db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.requesterSubject, "test-user-sub"));
    expect(rows).toHaveLength(1);
  });

  it("stays idempotent under truly concurrent submissions (no TOCTOU race)", async () => {
    const [first, second] = await Promise.all([
      createAccessRequest(db, {
        requesterSubject: "test-user-sub",
        pocketIdClientId: "test-client-id",
        pocketIdGroupId: "test-group-id",
        pocketIdGroupName: "engineering",
      }),
      createAccessRequest(db, {
        requesterSubject: "test-user-sub",
        pocketIdClientId: "test-client-id",
        pocketIdGroupId: "test-group-id",
        pocketIdGroupName: "engineering",
      }),
    ]);

    expect(first.id).toBe(second.id);

    const rows = await db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.requesterSubject, "test-user-sub"));
    expect(rows).toHaveLength(1);
  });

  it("is idempotent against an already-approved request — no duplicate pending row (race fix)", async () => {
    const first = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });
    await setAccessRequestStatus(db, first.id, "approved");

    // A re-submission racing (or simply following) the approval must not
    // create a second row: the DB's active-request unique index covers
    // "pending or approved," not just "pending," so this ON CONFLICT DO
    // NOTHING falls back to returning the existing approved row.
    const second = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    expect(second.id).toBe(first.id);
    expect(second.status).toBe("approved");

    const rows = await db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.requesterSubject, "test-user-sub"));
    expect(rows).toHaveLength(1);
  });

  it("stays idempotent when a submission races an admin's approval of the existing row", async () => {
    const first = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    const [, second] = await Promise.all([
      setAccessRequestStatus(db, first.id, "approved"),
      createAccessRequest(db, {
        requesterSubject: "test-user-sub",
        pocketIdClientId: "test-client-id",
        pocketIdGroupId: "test-group-id",
        pocketIdGroupName: "engineering",
      }),
    ]);

    expect(second.id).toBe(first.id);

    const rows = await db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.requesterSubject, "test-user-sub"));
    expect(rows).toHaveLength(1);
  });

  it("allows a new pending request for a different group from the same requester", async () => {
    await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });
    await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "another-group-id",
      pocketIdGroupName: "media",
    });

    const rows = await db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.requesterSubject, "test-user-sub"));
    expect(rows).toHaveLength(2);
  });

  // decided_at backs the portal's "is this grant still settling, or was it
  // revoked?" question, so it has to actually land in Postgres.
  it("stamps decided_at when a decision is recorded, and leaves it null while pending", async () => {
    const request = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });
    expect(request.decidedAt).toBeNull();

    await setAccessRequestStatus(db, request.id, "approved");

    const decided = await getAccessRequestById(db, request.id);
    expect(decided?.status).toBe("approved");
    expect(decided?.decidedAt).toBeInstanceOf(Date);
  });

  // the partial unique index covers every non-denied row, so a user whose
  // grant was revoked cannot simply insert a second request — the existing row
  // has to go back in the queue instead.
  it("reopens an approved request in place rather than creating a second row", async () => {
    const request = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });
    await setAccessRequestStatus(db, request.id, "approved");

    const didReopen = await reopenAccessRequest(db, request.id, {
      message: "I still need this for the on-call dashboards.",
      requesterEmail: "new@example.com",
    });

    expect(didReopen).toBe(true);
    const reopened = await getAccessRequestById(db, request.id);
    expect(reopened?.status).toBe("pending");
    expect(reopened?.decidedAt).toBeNull();
    // The card the user re-submitted from carries a reason field, so the
    // admin has to see what they just wrote, not the original message.
    expect(reopened?.message).toBe("I still need this for the on-call dashboards.");
    expect(reopened?.requesterEmail).toBe("new@example.com");

    const rows = await db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.requesterSubject, "test-user-sub"));
    expect(rows).toHaveLength(1);
  });

  it("refuses to reopen a request that was denied, or is already pending", async () => {
    const denied = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });
    await setAccessRequestStatus(db, denied.id, "denied");

    const didReopen = await reopenAccessRequest(db, denied.id, {
      message: null,
      requesterEmail: null,
    });

    expect(didReopen).toBe(false);
    expect((await getAccessRequestById(db, denied.id))?.status).toBe("denied");
  });

  // Two submissions racing -- a double click, a duplicate tab. The first
  // reopens; the second must report that it changed nothing, so the caller
  // does not log a transition that never happened.
  it("reports no reopen when the row has already been put back in the queue", async () => {
    const request = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });
    await setAccessRequestStatus(db, request.id, "approved");

    const first = await reopenAccessRequest(db, request.id, {
      message: "first",
      requesterEmail: null,
    });
    const second = await reopenAccessRequest(db, request.id, {
      message: "second",
      requesterEmail: null,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    // The loser must not overwrite the winner's justification either.
    expect((await getAccessRequestById(db, request.id))?.message).toBe("first");
  });

  it("listUserAccessRequests returns only the given requester's requests", async () => {
    await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    const requests = await listUserAccessRequests(db, "test-user-sub");

    expect(requests).toHaveLength(1);
    expect(requests[0].pocketIdClientId).toBe("test-client-id");

    const otherUsersRequests = await listUserAccessRequests(db, "someone-else-sub");
    expect(otherUsersRequests).toHaveLength(0);
  });

  // The table is shared with other suites, so only "there is one" can be
  // asserted reliably: this suite's own pending row guarantees it.
  it("hasPendingAccessRequests sees a pending request", async () => {
    await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    await expect(hasPendingAccessRequests(db)).resolves.toBe(true);
  });

  it("listPendingAccessRequests returns only pending rows, oldest first", async () => {
    const older = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });
    const newer = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "another-group-id",
      pocketIdGroupName: "media",
    });

    // Decide one of them: it should drop out of the pending queue.
    await setAccessRequestStatus(db, newer.id, "denied");

    const pending = await listPendingAccessRequests(db);
    const forOurRequester = pending.filter((r) => r.requesterSubject === "test-user-sub");

    expect(forOurRequester.map((r) => r.id)).toEqual([older.id]);
  });

  it("getAccessRequestById returns the row (grant target) or undefined", async () => {
    const created = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    const found = await getAccessRequestById(db, created.id);
    expect(found?.requesterSubject).toBe("test-user-sub");
    expect(found?.pocketIdGroupId).toBe("test-group-id");

    const missing = await getAccessRequestById(db, "00000000-0000-4000-8000-000000000000");
    expect(missing).toBeUndefined();
  });

  it("setAccessRequestStatus flips a pending request to approved", async () => {
    const request = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    await setAccessRequestStatus(db, request.id, "approved");

    const [row] = await db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.id, request.id));
    expect(row.status).toBe("approved");
  });

  it("setAccessRequestStatus is a no-op on an already-decided request (no re-flip)", async () => {
    const request = await createAccessRequest(db, {
      requesterSubject: "test-user-sub",
      pocketIdClientId: "test-client-id",
      pocketIdGroupId: "test-group-id",
      pocketIdGroupName: "engineering",
    });

    await setAccessRequestStatus(db, request.id, "approved");
    // A stale "deny" click from a second admin tab must not overwrite the
    // already-recorded decision.
    await setAccessRequestStatus(db, request.id, "denied");

    const [row] = await db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.id, request.id));
    expect(row.status).toBe("approved");
  });
});
