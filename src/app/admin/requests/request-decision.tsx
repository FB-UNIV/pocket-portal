"use client";

import { useActionState } from "react";
import type { DecideAccessRequestResult } from "./actions";

type DecideAction = () => Promise<DecideAccessRequestResult>;

// Fixed copy per reason code, as on the requester side: the action
// returns codes, not text.
const EXPLANATION = {
  group_not_grantable:
    "This group can’t be granted for this app any more: the app is hidden, or the group was removed from it in PocketID. Deny the request instead.",
} as const;

// Approve/Deny for one queued request. A client component only because
// a refused approval has to be explained inline, which takes useActionState;
// the page stays a server component and binds the actions.
//
// `approveAction` is omitted when the page already knows the request can't be
// granted, so the row offers Deny only rather than a button guaranteed to
// fail. The inline explanation still covers a page that went stale.
export function RequestDecision({
  approveAction,
  denyAction,
  requester,
  groupName,
}: {
  approveAction?: DecideAction;
  denyAction: DecideAction;
  requester: string;
  groupName: string;
}) {
  const [, deny, denying] = useActionState(denyAction, null);

  return (
    // Approve then Deny in both DOM and tab order; the explanation, which
    // isn't focusable, takes the full-width row underneath.
    <div className="grid shrink-0 grid-cols-[auto_auto] justify-start gap-2 sm:justify-end">
      {approveAction ? (
        <ApproveForm action={approveAction} label={`Approve ${requester} for ${groupName}`} />
      ) : (
        <p className="col-span-2 max-w-xs text-xs text-zinc-600 sm:text-right dark:text-zinc-400">
          Can’t be approved: the app is hidden, or this group was removed from it in PocketID.
        </p>
      )}
      <form action={deny} className="col-start-2 row-start-1">
        <button
          type="submit"
          disabled={denying}
          aria-label={`Deny ${requester} for ${groupName}`}
          className="rounded-full border border-black/[.15] px-4 py-2 text-sm transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-white/[.2] dark:hover:bg-zinc-900"
        >
          Deny
        </button>
      </form>
    </div>
  );
}

function ApproveForm({ action, label }: { action: DecideAction; label: string }) {
  const [result, approve, approving] = useActionState(action, null);

  return (
    <>
      <form action={approve}>
        <button
          type="submit"
          disabled={approving}
          // A queue of rows all offering "Approve"/"Deny" gives a screen-reader
          // user nothing to tell them apart, and approving performs a real
          // PocketID group grant.
          aria-label={label}
          className="rounded-full bg-brand px-4 py-2 text-sm text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-60"
        >
          Approve
        </button>
      </form>
      {/* Announced, since it answers the admin's own click (SC 4.1.3). Always
          rendered: a region inserted along with its text is often missed. */}
      <p
        role="status"
        className="col-span-2 max-w-xs text-xs text-red-700 sm:text-right dark:text-red-400"
      >
        {result && !result.ok ? EXPLANATION[result.reason] : null}
      </p>
    </>
  );
}
