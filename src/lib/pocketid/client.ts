import { readPocketIdApi } from "@/lib/config";

// PocketID API client. Reference: https://pocket-id.org/docs/api
// Stateless by design: config is read on every call, no module-level
// singleton/cache (see .claude/rules/pocketid-api.md).

export interface PocketIdConfig {
  baseUrl: string;
  apiKey: string;
}

export function getPocketIdConfig(): PocketIdConfig {
  return readPocketIdApi();
}

/* v8 ignore start -- exercised by the integration suite (real container), not unit mocks */
export async function checkPocketIdHealth(config: PocketIdConfig): Promise<boolean> {
  const res = await fetch(`${config.baseUrl}/healthz`);
  return res.status === 204;
}
/* v8 ignore stop */

// Every PocketID list endpoint shares this envelope. Verified live against a
// real instance for /api/users, /api/user-groups and /api/oidc/clients.
interface PocketIdPage<T> {
  data: T[];
  pagination: {
    totalPages: number;
    totalItems: number;
    currentPage: number;
    itemsPerPage: number;
  };
}

// PocketID's largest honoured page size: a bigger pagination[limit] is
// silently capped to this (verified live).
const MAX_PAGE_SIZE = 100;

// Reads every page of a PocketID list endpoint. The default page is 20
// items, and reading only that silently drops the rest, e.g. a 21st OIDC
// client vanishing from the catalog. Stops at `totalPages` rather than at the
// first empty page: verified live, asking for a page past the end returns
// the last page again, so "loop until empty" would never end.
export async function listAllPages<T>(
  config: PocketIdConfig,
  path: string,
  what: string,
  pageSize = MAX_PAGE_SIZE,
): Promise<T[]> {
  const items: T[] = [];
  let totalPages = 1;

  for (let page = 1; page <= totalPages; page++) {
    const query = new URLSearchParams({
      "pagination[page]": String(page),
      "pagination[limit]": String(pageSize),
    });
    const res = await fetch(`${config.baseUrl}${path}?${query}`, {
      headers: { "X-API-KEY": config.apiKey },
    });

    if (!res.ok) {
      throw new Error(`PocketID list ${what} failed: ${res.status} ${res.statusText}`);
    }

    const body: PocketIdPage<T> = await res.json();
    items.push(...body.data);
    totalPages = body.pagination.totalPages;
  }

  return items;
}

export interface PocketIdUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  isAdmin: boolean;
  disabled: boolean;
}

export function listPocketIdUsers(config: PocketIdConfig): Promise<PocketIdUser[]> {
  return listAllPages(config, "/api/users", "users");
}

/* v8 ignore start -- exercised by the integration suite (real container), not unit mocks */
export async function getPocketIdUser(config: PocketIdConfig, id: string): Promise<PocketIdUser> {
  const res = await fetch(`${config.baseUrl}/api/users/${id}`, {
    headers: { "X-API-KEY": config.apiKey },
  });

  if (!res.ok) {
    throw new Error(`PocketID get user failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}
/* v8 ignore stop */

export interface PocketIdUserGroup {
  id: string;
  name: string;
  friendlyName: string;
}

export function listPocketIdGroups(config: PocketIdConfig): Promise<PocketIdUserGroup[]> {
  return listAllPages(config, "/api/user-groups", "groups");
}

export interface PocketIdOidcClient {
  id: string;
  name: string;
  description: string;
  launchURL: string | null;
  hasLogo: boolean;
  isGroupRestricted: boolean;
  allowedUserGroups: PocketIdUserGroup[];
}

// Verified live against a real instance: each client in GET /api/oidc/clients
// already carries
// name/description/launchURL/logo/allowedUserGroups — see
// docs/adr/0007-pocketid-live-catalog.md.
export function listPocketIdOidcClients(
  config: PocketIdConfig,
): Promise<PocketIdOidcClient[]> {
  return listAllPages(config, "/api/oidc/clients", "OIDC clients");
}

/* v8 ignore start -- exercised by the integration suite (real container), not unit mocks */
// A user's current groups, from GET /api/users/{id}'s `userGroups` (verified
// live). Backs addUserToGroup's read-modify-write and the session refresh in
// src/auth.ts, which matches on `name`, as the OIDC groups claim does.
export async function getPocketIdUserGroups(
  config: PocketIdConfig,
  userId: string,
): Promise<PocketIdUserGroup[]> {
  const res = await fetch(`${config.baseUrl}/api/users/${userId}`, {
    headers: { "X-API-KEY": config.apiKey },
  });

  if (!res.ok) {
    throw new Error(`PocketID get user groups failed: ${res.status} ${res.statusText}`);
  }

  const body: { userGroups?: PocketIdUserGroup[] } = await res.json();
  return body.userGroups ?? [];
}

export async function getPocketIdUserGroupIds(
  config: PocketIdConfig,
  userId: string,
): Promise<string[]> {
  const groups = await getPocketIdUserGroups(config, userId);
  return groups.map((group) => group.id);
}
/* v8 ignore stop */

/* v8 ignore start -- exercised by the integration suite (real container), not unit mocks */
// Adds a user to a group. PocketID has no append endpoint, and PUT
// /api/users/{id}/user-groups replaces the whole set (verified live), so this
// reads the current ids, adds the target and PUTs the union. Idempotent.
// Uses the admin API key; narrowing its scope is a tracked follow-up.
export async function addUserToGroup(
  config: PocketIdConfig,
  userId: string,
  groupId: string,
): Promise<void> {
  const current = await getPocketIdUserGroupIds(config, userId);
  const userGroupIds = [...new Set([...current, groupId])];

  const res = await fetch(`${config.baseUrl}/api/users/${userId}/user-groups`, {
    method: "PUT",
    headers: { "X-API-KEY": config.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ userGroupIds }),
  });

  if (!res.ok) {
    throw new Error(`PocketID add user to group failed: ${res.status} ${res.statusText}`);
  }
}
/* v8 ignore stop */
