"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig, getPocketIdUserGroups } from "@/lib/pocketid/client";
import { listUserCatalogApps } from "@/lib/catalog/apps";
import {
  createAccessRequest,
  listUserAccessRequests,
  reopenAccessRequest,
} from "@/lib/requests/access-requests";
import { deriveRequestOutcome } from "@/lib/requests/request-outcome";
import { countRecentRequestEvents, writeAuditEvent } from "@/lib/audit/log";
import { notifyNewAccessRequest } from "@/lib/notifications/access-requests";
import { readAccessRequestReason, readAccessRequestsEnabled } from "@/lib/config";

// Cap on the requester's optional justification. The textarea sets the
// same limit client-side, but this is the real guard: a server action is a
// callable RPC endpoint, so a tampered submission that skips the browser
// gets rejected here rather than writing an unbounded blob to the DB.
const MAX_MESSAGE_LENGTH = 500;

// Each request emails every PocketID admin, so a user can't file
// without bound. Counted in Postgres from the audit trail, never in
// memory, so it holds across replicas. Two concurrent submits can pass one
// over the limit; the unique index still stops duplicates.
const REQUESTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

// Expected, recoverable outcomes come back as values so the form can explain
// them inline; only genuine faults (PocketID or the DB failing) throw
// and reach the error boundary. A reason is a code, never text naming a group
// or request: the client maps it to fixed copy, so nothing here can leak what
// the boundary deliberately hides (see src/app/error.tsx).
export type RequestAccessResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_allowed"
        | "already_granted"
        | "already_active"
        | "message_too_long"
        | "reason_required"
        | "requests_disabled"
        | "rate_limited";
    };

// Bound to (clientId, groupId) by the page; `useActionState` then passes the
// previous result and the submitted form. Both are optional so the action
// stays directly callable in tests without a form.
export async function requestAccessAction(
  pocketIdClientId: string,
  pocketIdGroupId: string,
  _previous?: RequestAccessResult | null,
  formData?: FormData,
): Promise<RequestAccessResult> {
  const session = await requireUser();

  // the page hides the form when these are off, but this action is a
  // callable endpoint regardless, so it enforces them itself.
  if (!readAccessRequestsEnabled()) {
    return { ok: false, reason: "requests_disabled" };
  }
  const reasonMode = readAccessRequestReason();

  const recent = await countRecentRequestEvents(
    getDb(),
    session.user.id,
    new Date(Date.now() - HOUR_MS),
  );
  if (recent >= REQUESTS_PER_HOUR) {
    return { ok: false, reason: "rate_limited" };
  }

  const rawMessage = formData?.get("message");
  const trimmed =
    reasonMode !== "off" && typeof rawMessage === "string" ? rawMessage.trim() : "";
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, reason: "message_too_long" };
  }
  if (reasonMode === "required" && trimmed.length === 0) {
    return { ok: false, reason: "reason_required" };
  }
  const message = trimmed.length > 0 ? trimmed : null;

  // Re-derive the user's own catalog instead of trusting the submitted
  // (clientId, groupId): this row can become a real grant, and a server
  // action is a callable RPC. The group's display name comes from the same
  // lookup, since the admin decides on it.
  const apps = await listUserCatalogApps(getPocketIdConfig(), getDb(), session.user.groups);
  const app = apps.find((a) => a.id === pocketIdClientId);
  const group = app?.allowedGroups.find((g) => g.id === pocketIdGroupId);

  if (!app || !group) {
    return { ok: false, reason: "not_allowed" };
  }

  // Refuse a request for access the user already holds. The UI
  // already hides the request form once the client-level `hasAccess` flips
  // true, but that's client-wide (true once ANY allowed group matches) and
  // depends on the session's groups being fresh — this is the
  // server-side guard that stands on its own regardless, checked against
  // this specific group.
  if (session.user.groups.includes(group.name)) {
    return { ok: false, reason: "already_granted" };
  }

  const db = getDb();

  // Refuse a second request while one is still pending or genuinely in
  // effect, using the same derivation the page renders from so the
  // form and the guard can never disagree. A denied request is intentionally
  // re-requestable — the pending-unique DB index (see createAccessRequest)
  // already covers the concurrent double-submit case, this covers the
  // "already decided" case that index doesn't.
  const myRequests = await listUserAccessRequests(db, session.user.id);
  const outcome = deriveRequestOutcome(
    myRequests,
    pocketIdClientId,
    pocketIdGroupId,
    session.user.groups,
  );

  if (outcome && !outcome.canRequest) {
    return { ok: false, reason: "already_active" };
  }

  // An approved grant that PocketID no longer honours: the row must be
  // reopened rather than re-inserted, since the partial unique index covers
  // every non-denied row and a fresh insert would just hand back this same
  // stale one.
  if (outcome?.state === "revoked") {
    // "revoked" is inferred from the session's groups, which can be stale for
    // longer than GRANT_SETTLE_MS: a failed refresh (claims-refresh.ts) keeps
    // the old groups, so a long PocketID outage makes a live grant look
    // revoked. Reopening on that basis would undo an admin's approval, so
    // ask PocketID first; a failed lookup aborts before anything is written.
    const liveGroups = await getPocketIdUserGroups(getPocketIdConfig(), session.user.id);
    if (liveGroups.some((live) => live.name === group.name)) {
      return { ok: false, reason: "already_granted" };
    }

    // Status and audit move together, as they do on the approve/deny side:
    // this transition puts a real group grant back in front of an admin, so
    // the log must not claim a reopen that did not commit. A second
    // concurrent submission finds the row already pending, updates nothing,
    // and writes nothing.
    const reopened = await db.transaction(async (tx) => {
      const changed = await reopenAccessRequest(tx, outcome.requestId, {
        message,
        requesterEmail: session.user.email ?? null,
      });
      if (!changed) return false;

      await writeAuditEvent(tx, {
        actorSubject: session.user.id,
        actorEmail: session.user.email ?? undefined,
        action: "access_request.reopened",
        targetType: "access_request",
        targetId: outcome.requestId,
        metadata: { pocketIdClientId, pocketIdGroupId, pocketIdGroupName: group.name },
      });
      return true;
    });

    // Back in the queue, so admins hear about it as they would a new one
    //. Scheduled only once the reopen committed; see ADR-0009.
    if (reopened) {
      after(() =>
        notifyNewAccessRequest({
          id: outcome.requestId,
          requesterSubject: session.user.id,
          requesterEmail: session.user.email ?? null,
          pocketIdGroupName: group.name,
          message,
        }),
      );
    }

    revalidatePath("/apps");
    // The request is back in the admin queue, so that page's cached render
    // is stale too -- without this an admin sees "No pending access
    // requests" until a hard reload.
    revalidatePath("/admin/requests");
    return { ok: true };
  }

  const request = await createAccessRequest(db, {
    requesterSubject: session.user.id,
    requesterEmail: session.user.email ?? null,
    pocketIdClientId,
    pocketIdGroupId,
    pocketIdGroupName: group.name,
    message,
  });

  // Audit the lifecycle start. Best-effort ordering: the request is what
  // matters, the audit trails it — the approve/deny side ties status + audit
  // into one transaction where the coupling is security-relevant.
  await writeAuditEvent(db, {
    actorSubject: session.user.id,
    actorEmail: session.user.email ?? undefined,
    action: "access_request.created",
    targetType: "access_request",
    targetId: request.id,
    metadata: { pocketIdClientId, pocketIdGroupId, pocketIdGroupName: group.name },
  });

  // After the response (ADR-0009): the request is already filed, so a
  // slow or broken mail server must not hold up or fail this action.
  after(() =>
    notifyNewAccessRequest({
      id: request.id,
      requesterSubject: session.user.id,
      requesterEmail: session.user.email ?? null,
      pocketIdGroupName: group.name,
      message,
    }),
  );

  revalidatePath("/apps");
  revalidatePath("/admin/requests");
  return { ok: true };
}
