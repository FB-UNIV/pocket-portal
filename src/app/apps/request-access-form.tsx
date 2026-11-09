"use client";

import { useActionState } from "react";
import type { RequestAccessResult } from "./actions";
import type { AccessRequestReason } from "@/lib/config";
import { MAX_REASON_LENGTH } from "./limits";

export type RequestRefusal = Extract<RequestAccessResult, { ok: false }>["reason"];

// Every word the form shows, already in the page's language: the page is a
// server component and translates them, so no messages ship to the browser.
export interface RequestAccessFormLabels {
  role: string;
  reason: string;
  reasonPlaceholder: string;
  submit: string;
  // The submit button's accessible name, naming the app.
  submitName: string;
  // Fixed copy per refusal code. The action deliberately returns codes, not
  // text, so what the requester sees is only ever about their own request.
  refusals: Record<RequestRefusal, string>;
}

export interface RoleOption {
  id: string;
  friendlyName: string;
}

// One request form per app. The role is a field: a picker when the app
// offers more than one, preselected to the everyday one (see
// lib/requests/default-role.ts), and a hidden field when there's only one,
// since a choice of one is just noise. A client component only because an
// action's result has to be rendered inline, which takes useActionState.
export function RequestAccessForm({
  action,
  appId,
  roles,
  defaultRoleId,
  reason,
  labels,
}: {
  action: (
    previous: RequestAccessResult | null,
    formData: FormData,
  ) => Promise<RequestAccessResult>;
  appId: string;
  // Only the roles that can be asked for right now; never empty.
  roles: RoleOption[];
  defaultRoleId: string;
  // ACCESS_REQUEST_REASON; the action enforces it independently.
  reason: AccessRequestReason;
  labels: RequestAccessFormLabels;
}) {
  const [result, formAction, pending] = useActionState(action, null);
  const roleId = `role-${appId}`;
  const reasonId = `reason-${appId}`;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {roles.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={roleId} className="text-sm font-semibold text-ink-muted">
            {labels.role}
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
            {labels.reason}
          </label>
          <textarea
            id={reasonId}
            name="message"
            rows={2}
            maxLength={MAX_REASON_LENGTH}
            required={reason === "required"}
            placeholder={labels.reasonPlaceholder}
            className="field"
          />
        </div>
      )}

      {/* SC 2.5.3: the accessible name starts with the visible text, and
          names the app so a list of identical buttons can be told apart. */}
      <button
        type="submit"
        disabled={pending}
        aria-label={labels.submitName}
        className="btn btn-primary self-start"
      >
        {labels.submit}
      </button>
      {/* Unlike the outcome notices, this is an update arriving mid-visit in
          response to the user's own action, so it is announced (SC 4.1.3).
          The region is always rendered: one inserted along with its text is
          often not announced. */}
      <p role="status" className="text-sm font-semibold text-on-bad">
        {result && !result.ok ? labels.refusals[result.reason] : null}
      </p>
    </form>
  );
}
