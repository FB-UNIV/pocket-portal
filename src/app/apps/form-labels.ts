import type { translatorFor } from "@/i18n/translate";
import type { AccessRequestReason } from "@/lib/config";
import { MAX_REASON_LENGTH } from "./limits";
import type { RequestAccessFormLabels } from "./request-access-form";

export type AskFormT = ReturnType<typeof translatorFor<"AskForm">>;

// The request form's words for one app (its button names the app), in the
// translator's language. Built by the page, a server component, so the form
// itself ships no messages to the browser.
export function formLabels(
  t: AskFormT,
  appName: string,
  reason: AccessRequestReason,
): RequestAccessFormLabels {
  return {
    role: t("role"),
    reason: t("reasonLabel", { required: reason === "required" ? "yes" : "no" }),
    reasonPlaceholder: t("reasonPlaceholder"),
    submit: t("submit"),
    submitName: t("submitLabel", { app: appName }),
    cancel: t("cancel"),
    refusals: {
      already_active: t("already_active"),
      already_granted: t("already_granted"),
      not_allowed: t("not_allowed"),
      message_too_long: t("message_too_long", { max: MAX_REASON_LENGTH }),
      reason_required: t("reason_required"),
      requests_disabled: t("requests_disabled"),
      rate_limited: t("rate_limited"),
    },
  };
}
