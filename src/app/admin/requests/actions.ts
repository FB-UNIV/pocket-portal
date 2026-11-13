"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig, addUserToGroup } from "@/lib/pocketid/client";
import { listAdminCatalogApps } from "@/lib/catalog/apps";
import { isGrantable } from "@/lib/requests/grantable";
import { writeAuditEvent, type AuditEvent } from "@/lib/audit/log";
import { notifyAccessRequestDecision } from "@/lib/notifications/access-requests";
import { recordAccessRequestEvent, recordGrant } from "@/lib/observability/metrics";
import { withSpan } from "@/lib/observability/tracing";
import {
  getAccessRequestById,
  setAccessRequestStatus,
  type AccessRequestDecision,
} from "@/lib/requests/access-requests";

// Approve or deny a pending request, auditing each transition
//. The guarantee: a request only becomes "approved" once the real
// PocketID grant has succeeded. In order:
//   1. Re-derive requester and group from the stored row, never the form:
//      a server action is a callable RPC.
//   2. Refuse a group that isn't a grantable group of a visible client
//      (isGrantable), so a tampered or stale row can't become a grant.
//   3. Grant in PocketID (idempotent). On failure the request stays pending,
//      the failure is audited, and the error reaches the admin.
//   4. Flip status and write the audit event in one transaction.
//   5. Email the requester, after the response (ADR-0011).
//
// A refusal at step 2 is expected, so it's returned for the row to explain
//. A failed grant at step 3 throws: that's PocketID failing, which the
// error boundary is for.
export type DecideAccessRequestResult =
  | { ok: true }
  | { ok: false; reason: "group_not_grantable" };

// Bound to (id, decision) by the page; `useActionState` then passes the
// previous result and the form, which this action doesn't need.
export async function decideAccessRequestAction(
  id: string,
  decision: AccessRequestDecision,
): Promise<DecideAccessRequestResult> {
  // Outside the span: a redirect to sign-in is control flow, not a failed
  // decision.
  const session = await requireAdmin();
  return withSpan("access_request.decide", { "portal.request.decision": decision }, () =>
    decide(session, id, decision),
  );
}

// Counted (#16) once each outcome is final: a decision when it commits, a
// grant when PocketID answered or the guard refused it.
async function decide(
  session: Awaited<ReturnType<typeof requireAdmin>>,
  id: string,
  decision: AccessRequestDecision,
): Promise<DecideAccessRequestResult> {
  const db = getDb();

  const request = await getAccessRequestById(db, id);
  // Stale click (already decided by another tab, or gone): no-op, just refresh.
  if (!request || request.status !== "pending") {
    revalidatePath("/admin/requests");
    return { ok: true };
  }

  const auditEvent = (action: string, extra?: Record<string, unknown>): AuditEvent => ({
    actorSubject: session.user.id,
    actorEmail: session.user.email ?? undefined,
    action,
    targetType: "access_request",
    targetId: id,
    metadata: {
      requesterSubject: request.requesterSubject,
      pocketIdClientId: request.pocketIdClientId,
      pocketIdGroupId: request.pocketIdGroupId,
      pocketIdGroupName: request.pocketIdGroupName,
      ...extra,
    },
  });

  if (decision === "approved") {
    const apps = await listAdminCatalogApps(getPocketIdConfig(), db);
    if (!isGrantable(apps, request)) {
      recordGrant("refused");
      await writeAuditEvent(db, auditEvent("access_request.grant_rejected"));
      revalidatePath("/admin/requests");
      return { ok: false, reason: "group_not_grantable" };
    }

    try {
      await withSpan("access_request.grant", { "pocketid.group.name": request.pocketIdGroupName }, () =>
        addUserToGroup(getPocketIdConfig(), request.requesterSubject, request.pocketIdGroupId),
      );
      recordGrant("granted");
    } catch (err) {
      recordGrant("failed");
      await writeAuditEvent(db, auditEvent("access_request.grant_failed", { error: String(err) }));
      revalidatePath("/admin/requests");
      throw err;
    }
  }

  await db.transaction(async (tx) => {
    await setAccessRequestStatus(tx, id, decision);
    await writeAuditEvent(tx, auditEvent(`access_request.${decision}`));
  });
  recordAccessRequestEvent(decision);

  // Only now that the decision committed, and after the response
  // (ADR-0011). after() also runs when an action throws, which is why it is
  // scheduled here rather than earlier.
  after(() => notifyAccessRequestDecision(request, decision));

  revalidatePath("/admin/requests");
  return { ok: true };
}
