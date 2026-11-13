import { withSpan } from "@/lib/observability/tracing";
import { recordIntegrationCall } from "@/lib/observability/metrics";
import type { MediaItem, MediaServerIntegration } from "./types";

// Jellyfin (#23), read with a server-wide API key, through its REST API
// directly rather than @jellyfin/sdk (which brings axios): a handful of
// endpoints, checked against Jellyfin's OpenAPI spec (api.jellyfin.org):
//
//   GET /System/Info/Public           no auth: ServerName, Version, Id
//   GET /Items?sortBy=DateCreated…    Authorization header (the API key)
//   GET /Items/{id}/Images/Primary    no auth; maxHeight, quality
//
// Every request: the admin-set base URL and a fixed path, redirects
// refused (never followed somewhere else), a timeout, a span and a metric.

// Jellyfin ids: a UUID, with or without its dashes.
export function isItemId(id: string): boolean {
  return /^[0-9a-f]{32}$/i.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

const POSTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_POSTER_BYTES = 2 * 1024 * 1024;

interface JellyfinItem {
  Id: string;
  Name: string;
  Type: string;
  SeriesName?: string;
  ProductionYear?: number;
  ServerId?: string;
  ImageTags?: Record<string, string>;
}

export interface JellyfinOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export function createJellyfin({
  baseUrl,
  apiKey,
  fetch: fetchImpl = (url, init) => fetch(url, init),
  timeoutMs = 3000,
}: JellyfinOptions): MediaServerIntegration {
  const base = baseUrl.replace(/\/+$/, "");

  const call = (operation: string, path: string, init: { auth?: boolean } = {}) =>
    withSpan(`integration.jellyfin.${operation}`, { "integration.type": "jellyfin" }, async () => {
      const start = performance.now();
      let outcome = "error";
      try {
        const res = await fetchImpl(`${base}${path}`, {
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
          // The Authorization scheme Jellyfin's spec names
          // ("CustomAuthentication", header "Authorization").
          headers: init.auth ? { Authorization: `MediaBrowser Token="${apiKey}"` } : {},
        });
        outcome = `${Math.floor(res.status / 100)}xx`;
        return res;
      } finally {
        recordIntegrationCall("jellyfin", operation, outcome, (performance.now() - start) / 1000);
      }
    });

  const json = async <T>(operation: string, path: string, auth = false): Promise<T> => {
    const res = await call(operation, path, { auth });
    if (!res.ok) throw new Error(`Jellyfin ${operation} answered ${res.status}`);
    return (await res.json()) as T;
  };

  const status = async () => {
    const info = await json<{ ServerName?: string; Version?: string; Id?: string }>("status", "/System/Info/Public");
    return { name: info.ServerName ?? "Jellyfin", version: info.Version ?? "", serverId: info.Id ?? "" };
  };

  return {
    type: "jellyfin",
    status,

    async recentlyAdded(limit: number): Promise<MediaItem[]> {
      const query = new URLSearchParams({ sortOrder: "Descending", recursive: "true", limit: String(limit) });
      query.append("sortBy", "DateCreated");
      query.append("includeItemTypes", "Movie");
      query.append("includeItemTypes", "Episode");
      const body = await json<{ Items?: JellyfinItem[] }>("recently_added", `/Items?${query}`, true);
      return (body.Items ?? [])
        .filter((item) => isItemId(item.Id))
        .map((item) => ({
          id: item.Id,
          title: item.Name,
          subtitle: item.Type === "Episode" ? (item.SeriesName ?? "") : item.ProductionYear ? String(item.ProductionYear) : "",
          hasPoster: Boolean(item.ImageTags?.Primary),
          serverId: item.ServerId ?? "",
        }));
    },

    async poster(itemId: string) {
      if (!isItemId(itemId)) return null;
      const res = await call("poster", `/Items/${itemId}/Images/Primary?maxHeight=360&quality=85`);
      const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!res.ok || !POSTER_TYPES.has(contentType)) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return bytes.length > MAX_POSTER_BYTES ? null : { contentType, bytes };
    },

    itemUrl(item: { id: string; serverId: string }) {
      const query = new URLSearchParams({ id: item.id, serverId: item.serverId });
      return `${base}/web/#/details?${query}`;
    },

    // Reachable (public info), and the key accepted (an authenticated read).
    async testConnection() {
      try {
        const info = await status();
        const res = await call("test", "/Items?limit=1", { auth: true });
        if (res.status === 401 || res.status === 403) return { ok: false, detail: `Jellyfin refused the key (${res.status})` };
        if (!res.ok) return { ok: false, detail: `Jellyfin answered ${res.status}` };
        return { ok: true, detail: `${info.name} ${info.version}`.trim() };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : "Jellyfin didn't answer" };
      }
    },
  };
}
