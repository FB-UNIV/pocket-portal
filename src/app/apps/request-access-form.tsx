"use client";

import { useActionState } from "react";
import type { RequestAccessResult } from "./actions";
import type { AccessRequestReason } from "@/lib/config";

// Mirrors MAX_MESSAGE_LENGTH in ./actions, which is the real guard: a
// "use server" module can only export async functions, so the number is
// repeated here rather than imported.
const MAX_REASON_LENGTH = 500;

type Reason = Extract<RequestAccessResult, { ok: false }>["reason"];

// Fixed copy per reason code. The action deliberately returns codes, not
// text, so what the requester sees here is only ever about their own request.
function explain(reason: Reason, friendlyName: string): string {
  switch (reason) {
    case "already_active":
      return "You already have a pending or approved request for this group. Reload the page to see where it stands.";
    case "already_granted":
      return `You already have access through ${friendlyName}. Reload the page to see it.`;
    case "not_allowed":
      return `${friendlyName} can’t be requested for this app any more. Reload the page to see what’s available.`;
    case "message_too_long":
      return `Keep your reason to ${MAX_REASON_LENGTH} characters or fewer.`;
    case "reason_required":
      return `Add a reason for requesting ${friendlyName}.`;
    case "requests_disabled":
      return "Access requests aren’t being taken at the moment. Reload the page.";
    case "rate_limited":
      return "You’ve sent a lot of requests in the last hour. Try again later.";
  }
}

// One request form per (app, group). A client component only because an
// action's result has to be rendered inline, which takes useActionState; the
// page around it stays a server component and binds the action for us.
export function RequestAccessForm({
  action,
  fieldId,
  friendlyName,
  reason,
}: {
  action: (
    previous: RequestAccessResult | null,
    formData: FormData,
  ) => Promise<RequestAccessResult>;
  fieldId: string;
  friendlyName: string;
  // ACCESS_REQUEST_REASON; the action enforces it independently.
  reason: AccessRequestReason;
}) {
  const [result, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      {reason === "off" ? null : (
        <>
          <label htmlFor={fieldId} className="text-sm font-semibold text-ink-muted">
            Reason for requesting {friendlyName} {reason === "required" ? "(required)" : "(optional)"}
          </label>
          <textarea
            id={fieldId}
            name="message"
            rows={3}
            maxLength={MAX_REASON_LENGTH}
            required={reason === "required"}
            placeholder="Why do you need access? This is shown to the admin reviewing your request."
            className="field"
          />
        </>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary self-start"
      >
        Request access via {friendlyName}
      </button>
      {/* Unlike the outcome notices, this is an update arriving mid-visit in
          response to the user's own action, so it is announced (SC 4.1.3).
          The region is always rendered: one inserted along with its text is
          often not announced. */}
      <p role="status" className="text-sm font-semibold text-on-bad">
        {result && !result.ok ? explain(result.reason, friendlyName) : null}
      </p>
    </form>
  );
}
