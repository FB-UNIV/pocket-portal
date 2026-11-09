"use client";

import { useActionState } from "react";
import type { RequestAccessResult } from "./actions";
import type { AccessRequestReason } from "@/lib/config";

// Mirrors MAX_MESSAGE_LENGTH in ./actions, which is the real guard: a
// "use server" module can only export async functions, so the number is
// repeated here rather than imported.
const MAX_REASON_LENGTH = 500;

type Reason = Extract<RequestAccessResult, { ok: false }>["reason"];

export interface RoleOption {
  id: string;
  friendlyName: string;
}

// Fixed copy per reason code. The action deliberately returns codes, not
// text, so what the requester sees here is only ever about their own request.
function explain(reason: Reason): string {
  switch (reason) {
    case "already_active":
      return "You’ve already asked for this role. Reload the page to see where it stands.";
    case "already_granted":
      return "You already have this role. Reload the page to see it.";
    case "not_allowed":
      return "That role can’t be requested for this app any more. Reload the page to see what’s available.";
    case "message_too_long":
      return `Keep your reason to ${MAX_REASON_LENGTH} characters or fewer.`;
    case "reason_required":
      return "Add a reason, so the admin knows why you need it.";
    case "requests_disabled":
      return "Access requests aren’t being taken at the moment. Reload the page.";
    case "rate_limited":
      return "You’ve sent a lot of requests in the last hour. Try again later.";
  }
}

// One request form per app. The role is a field: a picker when the app
// offers more than one, preselected to the everyday one (see
// lib/requests/default-role.ts), and a hidden field when there's only one,
// since a choice of one is just noise. A client component only because an
// action's result has to be rendered inline, which takes useActionState.
export function RequestAccessForm({
  action,
  appId,
  appName,
  roles,
  defaultRoleId,
  reason,
}: {
  action: (
    previous: RequestAccessResult | null,
    formData: FormData,
  ) => Promise<RequestAccessResult>;
  appId: string;
  appName: string;
  // Only the roles that can be asked for right now; never empty.
  roles: RoleOption[];
  defaultRoleId: string;
  // ACCESS_REQUEST_REASON; the action enforces it independently.
  reason: AccessRequestReason;
}) {
  const [result, formAction, pending] = useActionState(action, null);
  const roleId = `role-${appId}`;
  const reasonId = `reason-${appId}`;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {roles.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={roleId} className="text-sm font-semibold text-ink-muted">
            Role
          </label>
          <select id={roleId} name="group" defaultValue={defaultRoleId} className="field">
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.friendlyName}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="group" value={roles[0].id} />
      )}

      {reason === "off" ? null : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={reasonId} className="text-sm font-semibold text-ink-muted">
            Why do you need it? {reason === "required" ? "(required)" : "(optional)"}
          </label>
          <textarea
            id={reasonId}
            name="message"
            rows={2}
            maxLength={MAX_REASON_LENGTH}
            required={reason === "required"}
            placeholder="The admin sees this when they decide."
            className="field"
          />
        </div>
      )}

      {/* SC 2.5.3: the accessible name starts with the visible text, and
          names the app so a list of identical buttons can be told apart. */}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Ask for access to ${appName}`}
        className="btn btn-primary self-start"
      >
        Ask for access
      </button>
      {/* Unlike the outcome notices, this is an update arriving mid-visit in
          response to the user's own action, so it is announced (SC 4.1.3).
          The region is always rendered: one inserted along with its text is
          often not announced. */}
      <p role="status" className="text-sm font-semibold text-on-bad">
        {result && !result.ok ? explain(result.reason) : null}
      </p>
    </form>
  );
}
