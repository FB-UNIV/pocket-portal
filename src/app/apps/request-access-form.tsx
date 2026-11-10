"use client";

import { useActionState } from "react";
import Link from "next/link";
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
  // The link that closes the form again.
  cancel: string;
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
  cancelHref,
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
  // Where Cancel goes: the same /apps view, form closed. None, no Cancel.
  cancelHref?: string;
}) {
  const [result, formAction, pending] = useActionState(action, null);
  const roleId = `role-${appId}`;
  const reasonId = `reason-${appId}`;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {roles.length > 1 ? (
          <div className="flex flex-[0_1_14rem] flex-col gap-1.5">
            <label htmlFor={roleId} className="text-sm font-semibold text-ink-muted">
              {labels.role}
            </label>
            {/* The form only exists once someone pressed Ask, so its first
                field takes the focus they'd otherwise have to find. */}
            <select id={roleId} name="group" defaultValue={defaultRoleId} autoFocus className="field">
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
          <div className="flex flex-[1_1_16rem] flex-col gap-1.5">
            <label htmlFor={reasonId} className="text-sm font-semibold text-ink-muted">
              {labels.reason}
            </label>
            <textarea
              id={reasonId}
              name="message"
              rows={2}
              maxLength={MAX_REASON_LENGTH}
              required={reason === "required"}
              autoFocus={roles.length <= 1}
              placeholder={labels.reasonPlaceholder}
              className="field"
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* SC 2.5.3: the accessible name starts with the visible text, and
            names the app so a list of identical buttons can be told apart. */}
        <button
          type="submit"
          disabled={pending}
          // Nothing to fill in: the button itself is where they land.
          autoFocus={roles.length <= 1 && reason === "off"}
          aria-label={labels.submitName}
          className="btn btn-primary"
        >
          {labels.submit}
        </button>
        {cancelHref ? (
          <Link href={cancelHref} scroll={false} className="btn btn-quiet">
            {labels.cancel}
          </Link>
        ) : null}
      </div>
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
