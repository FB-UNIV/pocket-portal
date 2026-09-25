#!/usr/bin/env node
// Seeds the test PocketID (docker-compose.test.yml) with a small catalog, so
// e2e and manual testing see real data: OIDC clients (apps) with launch URLs
// and group restrictions, the groups they gate on, an e2e user whose groups
// make some apps "Open" and others "Request access", and an admin.
//
// Run by `npm run test-env:up`, after pocketid-provision-oidc-client.mjs.
// Idempotent: fixed client IDs and lookup by name, so re-runs converge.
//
// Endpoints, verified against a live v2 container (PocketID's API reference
// renders client-side, so they were probed):
//   POST /api/user-groups                              { name, friendlyName }
//   POST /api/oidc/clients                             { id, name, callbackURLs, ... }
//   PUT  /api/oidc/clients/{id}                        { ..., isGroupRestricted, launchURL }
//   PUT  /api/oidc/clients/{id}/allowed-user-groups    { userGroupIds }
//   POST /api/users                                    { username, email, isAdmin, ... }
//   PUT  /api/users/{id}/user-groups                   { userGroupIds }  (replaces the set)
// Setting allowedUserGroups does not set isGroupRestricted; a restricted app
// needs both.
import { readFileSync } from "node:fs";

// Group technical names matter: PocketID's OIDC `groups` claim carries the
// group `name` (not friendlyName/id), which is what the portal matches access
// on — see src/lib/catalog/access.ts.
const GROUPS = [
  { name: "media", friendlyName: "Media" },
  { name: "engineering", friendlyName: "Engineering" },
];

// The users e2e logs in as (via a one-time token, see e2e/helpers/auth.ts).
// `e2e-user` is a member of `media` only: has access to the open + media-gated
// apps below, and must "request access" to the engineering-gated one.
// `e2e-admin` reaches /admin (the portal reads PocketID's isAdmin), so the
// accessibility checks can cover those pages too.
const SEED_USERS = [
  {
    username: "e2e-user",
    email: "e2e-user@example.test",
    firstName: "E2E",
    lastName: "User",
    isAdmin: false,
    groups: ["media"],
  },
  {
    username: "e2e-admin",
    email: "e2e-admin@example.test",
    firstName: "E2E",
    lastName: "Admin",
    isAdmin: true,
    groups: [],
  },
];

// Fixed UUIDs (…01xx) so re-runs are idempotent and don't collide with the
// portal's own login client (…0001). Each is a browsable app (has a launchURL).
const CLIENTS = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    name: "Immich (seed)",
    description: "Self-hosted photo library",
    launchURL: "https://immich.example.test",
    isGroupRestricted: false,
    allowedGroups: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    name: "Sonarr (seed)",
    description: "TV series management",
    launchURL: "https://sonarr.example.test",
    isGroupRestricted: true,
    allowedGroups: ["media"],
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    name: "Grafana (seed)",
    description: "Metrics dashboards",
    launchURL: "https://grafana.example.test",
    isGroupRestricted: true,
    allowedGroups: ["engineering"],
  },
];

function loadEnvTest() {
  const env = {};
  for (const line of readFileSync(".env.test", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

async function main() {
  const env = loadEnvTest();
  const baseUrl = env.POCKETID_BASE_URL;
  const apiKey = env.POCKETID_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("POCKETID_BASE_URL / POCKETID_API_KEY missing from .env.test");
  }

  async function api(path, init = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    return res;
  }

  async function apiOrThrow(path, init, what) {
    const res = await api(path, init);
    if (!res.ok) {
      throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
    }
    return res;
  }

  // --- groups (create by name if missing) ---
  const existingGroups = (await (await apiOrThrow("/api/user-groups", {}, "list groups")).json()).data;
  const groupIdByName = new Map(existingGroups.map((g) => [g.name, g.id]));
  for (const group of GROUPS) {
    if (groupIdByName.has(group.name)) continue;
    const created = await apiOrThrow(
      "/api/user-groups",
      { method: "POST", body: JSON.stringify(group) },
      `create group ${group.name}`,
    );
    groupIdByName.set(group.name, (await created.json()).id);
    console.log(`Created group "${group.name}"`);
  }

  // --- seed users (create by username if missing) + memberships ---
  const users = (await (await apiOrThrow("/api/users", {}, "list users")).json()).data;
  for (const seed of SEED_USERS) {
    let user = users.find((u) => u.username === seed.username);
    if (!user) {
      const created = await apiOrThrow(
        "/api/users",
        {
          method: "POST",
          body: JSON.stringify({
            username: seed.username,
            email: seed.email,
            firstName: seed.firstName,
            lastName: seed.lastName,
            isAdmin: seed.isAdmin,
          }),
        },
        `create user ${seed.username}`,
      );
      user = await created.json();
      console.log(`Created user "${seed.username}" (${user.id})`);
    }
    await apiOrThrow(
      `/api/users/${user.id}/user-groups`,
      { method: "PUT", body: JSON.stringify({ userGroupIds: seed.groups.map((n) => groupIdByName.get(n)) }) },
      `set memberships for ${seed.username}`,
    );
  }

  // --- clients (converge to desired state) ---
  for (const client of CLIENTS) {
    const existing = await api(`/api/oidc/clients/${client.id}`);
    if (existing.status === 404) {
      await apiOrThrow(
        "/api/oidc/clients",
        {
          method: "POST",
          body: JSON.stringify({
            id: client.id,
            name: client.name,
            callbackURLs: [`${client.launchURL}/callback`],
            logoutCallbackURLs: [client.launchURL],
            pkceEnabled: true,
            isPublic: false,
          }),
        },
        `create client ${client.name}`,
      );
      console.log(`Created client "${client.name}"`);
    } else if (!existing.ok) {
      throw new Error(`look up client ${client.name} failed: ${existing.status} ${await existing.text()}`);
    }

    // PUT the full desired state so re-runs converge (launchURL + the
    // group-restriction flag, which allowed-user-groups alone does not set).
    await apiOrThrow(
      `/api/oidc/clients/${client.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: client.name,
          description: client.description,
          callbackURLs: [`${client.launchURL}/callback`],
          logoutCallbackURLs: [client.launchURL],
          pkceEnabled: true,
          isPublic: false,
          isGroupRestricted: client.isGroupRestricted,
          launchURL: client.launchURL,
        }),
      },
      `update client ${client.name}`,
    );
    await apiOrThrow(
      `/api/oidc/clients/${client.id}/allowed-user-groups`,
      { method: "PUT", body: JSON.stringify({ userGroupIds: client.allowedGroups.map((n) => groupIdByName.get(n)) }) },
      `set allowed groups for ${client.name}`,
    );
  }

  console.log(
    `Seeded catalog: ${CLIENTS.length} apps, ${GROUPS.length} groups, users ${SEED_USERS.map((u) => `"${u.username}" in [${u.groups.join(", ")}]`).join(", ")}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
