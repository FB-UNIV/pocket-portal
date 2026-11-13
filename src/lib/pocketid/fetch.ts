import { recordPocketIdCall } from "@/lib/observability/metrics";

// Every PocketID API call the portal makes, as a pattern rather than a URL:
// the metric label (#16) must never carry a user id, and a closed set keeps
// the number of series bounded. Add a pattern here before calling a new
// endpoint. Not here: OIDC sign-in calls (next-auth's), and the public
// branding read, which goes through Next's data cache, so most of its
// "calls" never reach PocketID and would skew the latency. Both still show
// up in traces through fetch instrumentation.
export type PocketIdEndpoint =
  | "GET /healthz"
  | "GET /api/users"
  | "GET /api/users/{id}"
  | "PUT /api/users/{id}/user-groups"
  | "GET /api/user-groups"
  | "GET /api/oidc/clients";

export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

// fetch(), timed and recorded as portal_pocketid_request_duration_seconds
// by endpoint and outcome: a status class, or "error" when no answer came
// back (refused, reset, DNS, timeout). The trace span comes from fetch
// instrumentation already.
export async function pocketIdFetch(
  endpoint: PocketIdEndpoint,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const start = performance.now();
  let outcome = "error";
  try {
    const res = await fetch(url, init);
    outcome = statusClass(res.status);
    return res;
  } finally {
    recordPocketIdCall(endpoint, outcome, (performance.now() - start) / 1000);
  }
}
