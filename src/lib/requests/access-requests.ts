import { and, asc, eq, sql } from "drizzle-orm";
import type { Db, DbTx } from "@/lib/db/client";
import { accessRequests } from "@/lib/db/schema";

export interface AccessRequest {
  id: string;
  requesterSubject: string;
  requesterEmail: string | null;
  pocketIdClientId: string;
  pocketIdGroupId: string;
  pocketIdGroupName: string;
  message: string | null;
  status: string;
  createdAt: Date;
  // When an admin approved/denied it; null while pending, and null for rows
  // written before migration 0007. Lets the portal tell a grant that is still
  // reaching the user's session from one that was later revoked.
  decidedAt: Date | null;
}

export interface CreateAccessRequestInput {
  requesterSubject: string;
  requesterEmail?: string | null;
  pocketIdClientId: string;
  pocketIdGroupId: string;
  pocketIdGroupName: string;
  message?: string | null;
}

// A request's terminal states. "pending" is the initial state; the admin
// dashboard moves a request to one of these. Kept as a union rather
// than a DB enum for the reason noted on the schema's `status` column.
export type AccessRequestDecision = "approved" | "denied";

/* v8 ignore start -- exercised by the integration suite (real Postgres), not unit mocks */
// ADR-0002. Idempotent: while a request for the same requester+client+group
// is active (pending or approved), a second submission returns the existing
// row rather than a duplicate. The partial unique index in schema.ts is what
// guarantees it, including for concurrent submissions (a double click, a
// second tab, a race with an approval), which requestAccessAction's own
// check can't do atomically. The existing row's message wins over a
// re-submission's.
export async function createAccessRequest(
  db: Db,
  input: CreateAccessRequestInput,
): Promise<AccessRequest> {
  await db
    .insert(accessRequests)
    .values({
      requesterSubject: input.requesterSubject,
      requesterEmail: input.requesterEmail ?? null,
      pocketIdClientId: input.pocketIdClientId,
      pocketIdGroupId: input.pocketIdGroupId,
      pocketIdGroupName: input.pocketIdGroupName,
      message: input.message ?? null,
    })
    .onConflictDoNothing({
      target: [
        accessRequests.requesterSubject,
        accessRequests.pocketIdClientId,
        accessRequests.pocketIdGroupId,
      ],
      where: sql`${accessRequests.status} != 'denied'`,
    });

  const [request] = await db
    .select()
    .from(accessRequests)
    .where(
      and(
        eq(accessRequests.requesterSubject, input.requesterSubject),
        eq(accessRequests.pocketIdClientId, input.pocketIdClientId),
        eq(accessRequests.pocketIdGroupId, input.pocketIdGroupId),
        sql`${accessRequests.status} != 'denied'`,
      ),
    );

  return request;
}


export async function listUserAccessRequests(
  db: Db,
  requesterSubject: string,
): Promise<AccessRequest[]> {
  return db.select().from(accessRequests).where(eq(accessRequests.requesterSubject, requesterSubject));
}

// The admin approval dashboard's queue: every request still awaiting a
// decision, oldest first so the longest-waiting requester surfaces at the
// top. Not scoped to a requester — an admin reviews everyone's pending
// requests.
export async function listPendingAccessRequests(db: Db): Promise<AccessRequest[]> {
  return db
    .select()
    .from(accessRequests)
    .where(eq(accessRequests.status, "pending"))
    .orderBy(asc(accessRequests.createdAt));
}

// Whether anything awaits a decision, for the admin nav link while requests
// are switched off. One indexed row at most, rather than the queue.
export async function hasPendingAccessRequests(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: accessRequests.id })
    .from(accessRequests)
    .where(eq(accessRequests.status, "pending"))
    .limit(1);
  return row !== undefined;
}

// Fetches a single request by id (the admin approval path re-derives the
// grant target — requester + group — from the stored row rather than trusting
// a form field, mirroring requestAccessAction's server-side re-validation).
export async function getAccessRequestById(
  db: Db,
  id: string,
): Promise<AccessRequest | undefined> {
  const [request] = await db.select().from(accessRequests).where(eq(accessRequests.id, id));
  return request;
}

// Puts an approved request back in the queue, for a grant later
// removed in PocketID. A new request can't be filed instead: the partial
// unique index covers every non-denied row, so the insert would hand back
// this same stale row. Reopening keeps one row per requester+client+group.
//
// Only an `approved` row moves; `decidedAt` is cleared, and the requester's
// new reason and email replace the old ones, since that's what the admin
// should now read. Returns whether a row moved: a concurrent second
// submission matches nothing, and the caller then logs no transition.
export async function reopenAccessRequest(
  db: Db | DbTx,
  id: string,
  { message, requesterEmail }: { message: string | null; requesterEmail: string | null },
): Promise<boolean> {
  const reopened = await db
    .update(accessRequests)
    .set({ status: "pending", decidedAt: null, message, requesterEmail })
    .where(and(eq(accessRequests.id, id), eq(accessRequests.status, "approved")))
    .returning({ id: accessRequests.id });

  return reopened.length > 0;
}

// Records an admin's decision. Only a `pending` row moves, so a stale
// click from a second tab can't overwrite a decision already made. Stamps
// `decidedAt`, which tells a settling approval from a revoked one.
//
// State only: the PocketID grant is decideAccessRequestAction's job, and it
// calls this only after the grant succeeded, in the audit write's
// transaction, so the row never claims access that wasn't given.
export async function setAccessRequestStatus(
  db: Db | DbTx,
  id: string,
  status: AccessRequestDecision,
): Promise<void> {
  await db
    .update(accessRequests)
    .set({ status, decidedAt: new Date() })
    .where(and(eq(accessRequests.id, id), eq(accessRequests.status, "pending")));
}
/* v8 ignore stop */
