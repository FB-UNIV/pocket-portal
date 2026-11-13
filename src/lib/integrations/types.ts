// The integration contract (#23, ADR-0013), modelled on Homarr's
// (an integration, capability interfaces, a connection test) and written
// for this portal: no Homarr code is copied. Every call runs on the
// server, with a timeout; nothing reaches the browser but what an
// integration chooses to show.

export interface ConnectionTest {
  ok: boolean;
  // Words for the admin: "Home 10.10.7", or why it failed.
  detail: string;
}

export interface Integration {
  type: string;
  testConnection(): Promise<ConnectionTest>;
}

export interface MediaItem {
  id: string;
  title: string;
  // An episode's series, or a film's year.
  subtitle: string;
  hasPoster: boolean;
  serverId: string;
}

// A media server: what's new, its status, posters, and links into it.
export interface MediaServerIntegration extends Integration {
  status(): Promise<{ name: string; version: string; serverId: string }>;
  recentlyAdded(limit: number): Promise<MediaItem[]>;
  poster(itemId: string): Promise<{ contentType: string; bytes: Uint8Array } | null>;
  itemUrl(item: { id: string; serverId: string }): string;
}

// What an admin sets for an integration (lib/integrations/store). The key
// isn't here: it comes from the environment (JELLYFIN_API_KEY).
export interface IntegrationSettings {
  type: "jellyfin";
  baseUrl: string;
  // The PocketID client people must be able to open to see it.
  linkedClientId: string;
  enabled: boolean;
}
