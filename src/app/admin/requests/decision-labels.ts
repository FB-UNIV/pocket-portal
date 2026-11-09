import type { translatorFor } from "@/i18n/translate";
import type { RequestDecisionLabels } from "./request-decision";

export type AdminRequestsT = ReturnType<typeof translatorFor<"AdminRequests">>;

// One queued request's Approve/Decline words, naming who and which group, in
// the translator's language. Built by the page (a server component).
export function decisionLabels(
  t: AdminRequestsT,
  requester: string,
  group: string,
): RequestDecisionLabels {
  return {
    approve: t("approve"),
    decline: t("decline"),
    approveName: t("approveLabel", { requester, group }),
    declineName: t("declineLabel", { requester, group }),
    cantApprove: t("cantApprove"),
    refusals: { group_not_grantable: t("notGrantable") },
  };
}
