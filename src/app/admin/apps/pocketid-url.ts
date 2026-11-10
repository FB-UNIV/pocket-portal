import { readPocketIdBaseUrl } from "@/lib/config";

// Where an app (an OIDC client) is edited in PocketID's own admin UI, for the
// "Fix in PocketID" / "Change in PocketID" links. Null without a base URL.
export function pocketIdClientUrl(clientId: string): string | null {
  const baseUrl = readPocketIdBaseUrl();
  return baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}/settings/admin/oidc-clients/${encodeURIComponent(clientId)}`
    : null;
}
