"use client";

import { useActionState } from "react";
import type { DecideAccessRequestResult } from "./actions";

type DecideAction = () => Promise<DecideAccessRequestResult>;

type Refusal = Extract<DecideAccessRequestResult, { ok: false }>["reason"];

// Every word the row shows, already in the page's language (the page is a
// server component and translates them). As on the requester side, the
// action returns codes, not text, so refusals are fixed copy per code.
export interface RequestDecisionLabels {
  approve: string;
  decline: string;
  // Accessible names, naming who and what (see ApproveForm).
  approveName: string;
  declineName: string;
  cantApprove: string;
  refusals: Record<Refusal, string>;
}

// Approve/Decline for one queued request. A client component only because
// a refused approval has to be explained inline, which takes useActionState;
// the page stays a server component and binds the actions.
//
// `approveAction` is omitted when the page already knows the request can't be
// granted, so the row offers Decline only rather than a button guaranteed to
// fail. The inline explanation still covers a page that went stale.
export function RequestDecision({
  approveAction,
  denyAction,
  labels,
}: {
  approveAction?: DecideAction;
  denyAction: DecideAction;
  labels: RequestDecisionLabels;
}) {
  const [, deny, denying] = useActionState(denyAction, null);

  return (
    // Approve then Decline in both DOM and tab order; the explanation, which
    // isn't focusable, takes the full-width row underneath.
    <div className="grid shrink-0 grid-cols-[auto_auto] justify-start gap-2">
      {approveAction ? (
        <ApproveForm action={approveAction} labels={labels} />
      ) : (
        <p className="col-span-2 max-w-sm text-sm text-ink-muted">{labels.cantApprove}</p>
      )}
      <form action={deny} className="col-start-2 row-start-1">
        <button
          type="submit"
          disabled={denying}
          aria-label={labels.declineName}
          className="btn btn-secondary"
        >
          {labels.decline}
        </button>
      </form>
    </div>
  );
}

function ApproveForm({ action, labels }: { action: DecideAction; labels: RequestDecisionLabels }) {
  const [result, approve, approving] = useActionState(action, null);

  return (
    <>
      <form action={approve}>
        <button
          type="submit"
          disabled={approving}
          // A queue of rows all offering "Approve"/"Decline" gives a screen-reader
          // user nothing to tell them apart, and approving performs a real
          // PocketID group grant.
          aria-label={labels.approveName}
          className="btn btn-primary"
        >
          {labels.approve}
        </button>
      </form>
      {/* Announced, since it answers the admin's own click (SC 4.1.3). Always
          rendered: a region inserted along with its text is often missed. */}
      <p role="status" className="col-span-2 max-w-sm text-sm text-on-bad">
        {result && !result.ok ? labels.refusals[result.reason] : null}
      </p>
    </>
  );
}
