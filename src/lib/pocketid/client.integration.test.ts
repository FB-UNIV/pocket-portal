import { describe, it, expect, beforeAll } from "vitest";
import {
  getPocketIdConfig,
  checkPocketIdHealth,
  listPocketIdUsers,
  getPocketIdUser,
  listPocketIdGroups,
  getPocketIdUserGroupIds,
  addUserToGroup,
  listAllPages,
  type PocketIdUserGroup,
} from "./client";

// Requires a running PocketID + Postgres test instance:
//   npm run test-env:up
// See docker-compose.test.yml / .env.test for the fixture config
// (STATIC_API_KEY bootstraps an admin account headlessly, no WebAuthn needed).
// Reference: https://pocket-id.org/docs/api

describe("PocketID client (integration)", () => {
  let config: ReturnType<typeof getPocketIdConfig>;

  beforeAll(() => {
    config = getPocketIdConfig();
  });

  it("reports the instance as healthy", async () => {
    await expect(checkPocketIdHealth(config)).resolves.toBe(true);
  });

  it("lists users using the static API key", async () => {
    const users = await listPocketIdUsers(config);

    expect(Array.isArray(users)).toBe(true);
    // STATIC_API_KEY provisions an admin account named "Static API User" under the hood.
    expect(users.some((u) => u.isAdmin && u.username.startsWith("static-api-user"))).toBe(
      true,
    );
  });

  it("rejects requests with an invalid API key", async () => {
    await expect(
      listPocketIdUsers({ ...config, apiKey: "not-a-real-key" }),
    ).rejects.toThrow(/401/);
  });

  it("gets a single user by id, reflecting their admin status", async () => {
    const users = await listPocketIdUsers(config);
    const admin = users.find((u) => u.isAdmin)!;

    const user = await getPocketIdUser(config, admin.id);

    expect(user.id).toBe(admin.id);
    expect(user.isAdmin).toBe(true);
  });

  it("lists user groups", async () => {
    // Unique per run: PocketID enforces unique group names, and this
    // container persists across repeated local test runs (only wiped on
    // `test-env:down`), unlike a fresh container per CI run.
    const groupName = `client-test-group-${crypto.randomUUID()}`;
    const created = await fetch(`${config.baseUrl}/api/user-groups`, {
      method: "POST",
      headers: { "X-API-KEY": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name: groupName, friendlyName: "Client Test Group" }),
    }).then((r) => r.json());

    const groups = await listPocketIdGroups(config);

    expect(groups.some((g) => g.id === created.id && g.name === groupName)).toBe(true);
  });

  it("follows pagination past the first page", async () => {
    // A page size of 2 forces several pages out of a handful of groups, so
    // the multi-page path runs against the real envelope without seeding
    // past PocketID's default page size.
    const suffix = crypto.randomUUID();
    const created = await Promise.all(
      [1, 2, 3].map((n) =>
        fetch(`${config.baseUrl}/api/user-groups`, {
          method: "POST",
          headers: { "X-API-KEY": config.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ name: `page-${n}-${suffix}`, friendlyName: `Page ${n}` }),
        }).then((r) => r.json()),
      ),
    );

    try {
      const firstPage = await fetch(
        `${config.baseUrl}/api/user-groups?pagination%5Blimit%5D=2`,
        { headers: { "X-API-KEY": config.apiKey } },
      ).then((r) => r.json());
      expect(firstPage.pagination.totalPages).toBeGreaterThan(1);

      const groups = await listAllPages<PocketIdUserGroup>(
        config,
        "/api/user-groups",
        "groups",
        2,
      );

      expect(groups).toHaveLength(firstPage.pagination.totalItems);
      expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
      for (const group of created) {
        expect(groups.some((g) => g.id === group.id)).toBe(true);
      }
    } finally {
      await Promise.all(
        created.map((group) =>
          fetch(`${config.baseUrl}/api/user-groups/${group.id}`, {
            method: "DELETE",
            headers: { "X-API-KEY": config.apiKey },
          }),
        ),
      );
    }
  });

  it("addUserToGroup grants a group without clobbering existing memberships, idempotently", async () => {
    const suffix = crypto.randomUUID();
    const createGroup = (name: string) =>
      fetch(`${config.baseUrl}/api/user-groups`, {
        method: "POST",
        headers: { "X-API-KEY": config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ name, friendlyName: name }),
      }).then((r) => r.json());

    const groupA = await createGroup(`grant-a-${suffix}`);
    const groupB = await createGroup(`grant-b-${suffix}`);
    const user = await fetch(`${config.baseUrl}/api/users`, {
      method: "POST",
      headers: { "X-API-KEY": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `grant-user-${suffix}`,
        email: `grant-user-${suffix}@example.test`,
        firstName: "Grant",
        lastName: "Test",
        isAdmin: false,
      }),
    }).then((r) => r.json());

    try {
      // Seed the user into group A, then grant group B via addUserToGroup.
      await addUserToGroup(config, user.id, groupA.id);
      await addUserToGroup(config, user.id, groupB.id);

      const afterGrant = await getPocketIdUserGroupIds(config, user.id);
      expect(afterGrant).toContain(groupA.id); // existing membership preserved
      expect(afterGrant).toContain(groupB.id); // new grant applied

      // Idempotent: re-granting the same group doesn't duplicate or clobber.
      await addUserToGroup(config, user.id, groupB.id);
      const afterRegrant = await getPocketIdUserGroupIds(config, user.id);
      expect(afterRegrant.filter((id) => id === groupB.id)).toHaveLength(1);
      expect(afterRegrant).toContain(groupA.id);
    } finally {
      await fetch(`${config.baseUrl}/api/users/${user.id}`, {
        method: "DELETE",
        headers: { "X-API-KEY": config.apiKey },
      });
    }
  });
});
